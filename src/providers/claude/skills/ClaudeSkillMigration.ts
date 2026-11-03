import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { parseYaml } from 'obsidian';

import { parseAgentSkillMarkdown, serializeAgentSkillMarkdown } from '@/core/skills/AgentSkillCodec';
import type { SkillMigrationCandidate, SkillMigrationDirectory, SkillMigrationFile, SkillMigrationService } from '@/core/skills/SkillMigration';
import type {
  ManagedFolderContents,
  ManagedFolderSymlinkEntry,
  VaultFileAdapter,
} from '@/core/storage/VaultFileAdapter';
import { extractFirstParagraph, parseSlashCommandContent } from '@/utils/slashCommand';

export class ClaudeSkillMigration implements SkillMigrationService {
  constructor(private readonly files: VaultFileAdapter) {}

  async preview(): Promise<SkillMigrationCandidate[]> {
    const result: SkillMigrationCandidate[] = [];
    for (const root of ['.claude/skills', '.claude/commands']) {
      if (!await this.files.verifyManagedPath(root, { expectedType: 'folder', allowMissing: true })) continue;
      const visit = async (folder: string): Promise<void> => {
        const listing = await this.listFolder(folder);
        for (const entry of [
          ...listing.files,
          ...listing.folders,
          ...listing.symlinks.map(link => link.path),
        ]) {
          if (path.posix.dirname(entry) !== folder) throw new Error('Invalid directory listing');
        }
        for (const link of listing.symlinks) {
          if (
            root === '.claude/skills'
            && link.targetInsideVault
            && link.target.startsWith('.agents/skills/')
            && !link.broken
          ) {
            continue;
          }
          result.push(this.inspectSymlink(link, root));
        }
        if (root.endsWith('skills') && folder !== root) {
          const skill = `${folder}/SKILL.md`;
          const extras = [...listing.files.filter(file => file !== skill), ...listing.folders].sort();
          result.push(await this.inspect(skill, path.posix.basename(folder), extras));
          return;
        }
        for (const file of listing.files.filter(f => f.endsWith('.md'))) {
          const relative = path.posix.relative(root, file).slice(0, -'.md'.length);
          const name = relative.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
          result.push(await this.inspect(
            file,
            name,
            [],
            name === path.posix.basename(relative) ? undefined : relative,
          ));
        }
        for (const child of listing.folders) await visit(child);
      };
      await visit(root);
    }
    const names = new Map<string, number>();
    for (const candidate of result) names.set(candidate.name, (names.get(candidate.name) ?? 0) + 1);
    for (const candidate of result) {
      if ((names.get(candidate.name) ?? 0) < 2) continue;
      candidate.blocked = true;
      if (!candidate.warnings.includes('duplicateName')) candidate.warnings.push('duplicateName');
    }
    return result.sort((a, b) => a.source.localeCompare(b.source));
  }

  private async listFolder(folder: string): Promise<ManagedFolderContents> {
    if (typeof this.files.listManagedFolderContents === 'function') {
      return this.files.listManagedFolderContents(folder);
    }
    return { ...(await this.files.listManagedFolder(folder)), symlinks: [] };
  }

  private inspectSymlink(link: ManagedFolderSymlinkEntry, root: string): SkillMigrationCandidate {
    const relative = path.posix.relative(root, link.path).replace(/\.md$/, '');
    const rawName = root.endsWith('skills') ? path.posix.basename(link.path) : relative;
    const name = rawName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return {
      source: link.path,
      name,
      linkTarget: link.target,
      warnings: [link.broken ? 'brokenSymlink' : 'symlink'],
      blocked: true,
      extraFiles: [],
      revision: createHash('sha256')
        .update(JSON.stringify([link.target, link.broken]))
        .digest('hex'),
    };
  }

  private async inspect(source: string, name: string, extraFiles: string[], renamedFrom?: string): Promise<SkillMigrationCandidate> {
    const warnings: string[] = [];
    let frontmatterFields: string[] = [];
    let syntaxMarkers: string[] = [];
    let nonPortablePaths: string[] = [];
    let description: string | undefined;
    let markdown: string | undefined;
    const conflict = await this.files.exists(`.agents/skills/${name}`);
    let blocked = conflict;
    let revision = '';
    try {
      const snapshot = await this.snapshot(source);
      const raw = snapshot.raw;
      revision = snapshot.revision;
      extraFiles = [...snapshot.directories.map(directory => directory.path), ...snapshot.files.map(file => file.path)]
        .map(relative => `${path.posix.dirname(source)}/${relative}`).sort();
      const paths = [...snapshot.directories.map(directory => directory.path), ...snapshot.files.map(file => file.path)];
      const seenPaths = new Set<string>();
      nonPortablePaths = paths.filter(relative => {
        const folded = relative.toLowerCase();
        const duplicate = seenPaths.has(folded);
        seenPaths.add(folded);
        return duplicate || relative.split('/').some(segment => /[<>:"\\|?*]/.test(segment)
          || [...segment].some(character => character.charCodeAt(0) < 32)
          || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
      });
      if (nonPortablePaths.length) { blocked = true; warnings.push('nonPortablePaths'); }
      markdown = this.convert(source, name, raw);
      const parsed = parseAgentSkillMarkdown(markdown, name);
      description = parsed.description;
      if (!parseSlashCommandContent(raw).description) warnings.push('generatedDescription');
      frontmatterFields = Object.keys(parsed.frontmatter).filter(key => !['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(key));
      if (frontmatterFields.length) warnings.push('frontmatter');
      syntaxMarkers = [...new Set(parsed.instructions.match(/\$ARGUMENTS|\$\d+|!`|@[^\s`]+/g) ?? [])];
      if (syntaxMarkers.length) warnings.push('syntax');
    } catch {
      blocked = true;
      warnings.push('invalid');
    }
    if (extraFiles.length) warnings.push('extraFiles');
    if (conflict) warnings.push('conflict');
    return { source, name, description, markdown, extraFiles, warnings, frontmatterFields, syntaxMarkers, nonPortablePaths, renamedFrom, blocked, revision };
  }

  private async snapshot(source: string): Promise<{ raw: string; files: SkillMigrationFile[]; directories: SkillMigrationDirectory[]; rootMode?: number; revision: string }> {
    const raw = await this.files.readManagedFile(source);
    const files: SkillMigrationFile[] = [];
    const directories: SkillMigrationDirectory[] = [];
    let rootMode: number | undefined;
    if (source.startsWith('.claude/skills/')) {
      const root = path.posix.dirname(source);
      rootMode = await this.files.getManagedMode(root, 'folder');
      const walk = async (folder: string): Promise<void> => {
        const listing = await this.files.listManagedFolder(folder);
        for (const entry of [...listing.files, ...listing.folders]) {
          if (path.posix.dirname(entry) !== folder) throw new Error('Invalid directory listing');
        }
        for (const file of listing.files.filter(item => item !== source).sort()) {
          const content = await this.files.readManagedBinaryFile(file);
          const mode = await this.files.getManagedFileMode(file);
          files.push({ path: file.slice(root.length + 1), content, ...(mode === undefined ? {} : { mode }) });
        }
        for (const child of listing.folders.sort()) {
          const mode = await this.files.getManagedMode(child, 'folder');
          directories.push({ path: child.slice(root.length + 1), ...(mode === undefined ? {} : { mode }) });
          await walk(child);
        }
      };
      await walk(root);
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const hash = createHash('sha256').update(JSON.stringify(raw));
    hash.update(JSON.stringify(rootMode ?? null));
    hash.update(JSON.stringify(directories));
    for (const file of files) {
      hash.update(JSON.stringify(file.path));
      hash.update(JSON.stringify(file.mode ?? null));
      hash.update(createHash('sha256').update(Buffer.from(file.content)).digest('hex'));
    }
    return { raw, files, directories, rootMode, revision: hash.digest('hex') };
  }

  private convert(source: string, name: string, raw: string): string {
    if (source.startsWith('.claude/skills/')) {
      const match = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
      if (!match) throw new Error('Invalid frontmatter');
      const metadata: unknown = parseYaml(match[1]);
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid frontmatter');
      const fields = metadata as Record<string, unknown>;
      if (fields.name !== undefined && typeof fields.description === 'string' && fields.description.trim()) return raw;
      if (fields.name !== undefined && fields.name !== name) throw new Error('Skill name does not match its folder');
      const description = typeof fields.description === 'string' && fields.description.trim()
        ? fields.description : (extractFirstParagraph(match[2]) ?? '').slice(0, 1024);
      return serializeAgentSkillMarkdown(fields, { name, description, instructions: match[2] });
    }
    const command = parseSlashCommandContent(raw);
    const match = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match && /^\uFEFF?---\r?\n/.test(raw)) throw new Error('Invalid frontmatter');
    const metadata: unknown = match ? parseYaml(match[1]) : {};
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid frontmatter');
    const description = command.description ?? (extractFirstParagraph(command.promptContent) ?? '').slice(0, 1024);
    return serializeAgentSkillMarkdown(metadata as Record<string, unknown>, { name, description, instructions: command.promptContent });
  }

  async prepare(candidate: SkillMigrationCandidate): Promise<{ name: string; markdown: string; files: SkillMigrationFile[]; directories: SkillMigrationDirectory[]; rootMode?: number }> {
    const current = (await this.preview()).find(item => item.source === candidate.source);
    if (!current || current.blocked || current.revision !== candidate.revision || candidate.blocked) throw new Error('Migration preview is stale or blocked');
    const snapshot = await this.snapshot(current.source);
    if (snapshot.revision !== current.revision) throw new Error('Migration source changed');
    return { name: current.name, markdown: this.convert(current.source, current.name, snapshot.raw), files: snapshot.files, directories: snapshot.directories, rootMode: snapshot.rootMode };
  }
}
