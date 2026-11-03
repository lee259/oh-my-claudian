import { Notice } from 'obsidian';
import { useState } from 'preact/hooks';

import type { SkillMigrationCandidate, SkillMigrationDirectory, SkillMigrationFile, SkillMigrationService } from '@/core/skills/SkillMigration';
import { t } from '@/i18n/i18n';

interface Props {
  getService: () => Promise<SkillMigrationService>;
  onCopy: (name: string, markdown: string, files: SkillMigrationFile[], directories: SkillMigrationDirectory[], rootMode?: number) => Promise<void>;
}

export function SkillMigrationView({ getService, onCopy }: Props) {
  const [items, setItems] = useState<SkillMigrationCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<SkillMigrationCandidate | null>(null);
  const failureNotice = (error: unknown): Notice => new Notice(t('settings.skillMigration.failedWithReason', {
    message: error instanceof Error ? error.message : String(error),
  }));
  const refresh = async (afterCopy = false) => {
    setBusy(true);
    try { setItems(await (await getService()).preview()); setPending(null); }
    catch (error) {
      setItems(null);
      setPending(null);
      if (afterCopy) new Notice(t('settings.agentSkills.savedRefreshFailed'));
      else failureNotice(error);
    }
    finally { setBusy(false); }
  };
  const confirmCopy = async (item: SkillMigrationCandidate) => {
    setBusy(true);
    try {
      const prepared = await (await getService()).prepare(item);
      await onCopy(prepared.name, prepared.markdown, prepared.files, prepared.directories, prepared.rootMode);
      setPending(null);
      await refresh(true);
    } catch (error) {
      failureNotice(error);
      setBusy(false);
    }
  };
  const renderItem = (item: SkillMigrationCandidate) => <div
    className={`claudian-skill-migration-item${item.blocked ? ' claudian-skill-migration-item--blocked' : ''}`}
    key={item.source}
  >
    <p className="claudian-skill-migration-path"><code>{item.source}</code> → <code>{item.name}</code></p>
    {item.description && <p className="claudian-skill-migration-description">{item.description}</p>}
    {item.renamedFrom && <p className="claudian-skill-migration-warning">{t('settings.skillMigration.warnings.renamed', { name: item.renamedFrom })}</p>}
    {item.linkTarget && <p className="claudian-skill-migration-description"><code>{item.linkTarget}</code></p>}
    {item.markdown && <details><summary>{t('settings.skillMigration.previewContent')}</summary><pre>{item.markdown}</pre></details>}
    {item.warnings.map(warning => <p className={warning === 'extraFiles' || warning === 'generatedDescription' ? 'claudian-skill-migration-description' : 'claudian-skill-migration-warning'} key={warning}>{t(`settings.skillMigration.warnings.${warning}` as 'settings.skillMigration.warnings.invalid')}</p>)}
    {item.frontmatterFields?.length ? <p><code>{item.frontmatterFields.join(', ')}</code></p> : null}
    {item.syntaxMarkers?.length ? <p><code>{item.syntaxMarkers.join(', ')}</code></p> : null}
    {item.nonPortablePaths?.length ? <p><code>{item.nonPortablePaths.join(', ')}</code></p> : null}
    {item.extraFiles.length > 0 && <ul className="claudian-skill-migration-files">{item.extraFiles.map(file => <li key={file}><code>{file}</code></li>)}</ul>}
    {!item.blocked && <button className="claudian-skill-migration-button" disabled={busy} onClick={() => setPending(item)}>{t('settings.skillMigration.copy')}</button>}
    {pending?.source === item.source && <div className="claudian-skill-migration-confirm" role="region" aria-label={t('settings.skillMigration.confirmTitle')}>
      <p>{t('settings.skillMigration.confirmDesc', { source: item.source, name: item.name })}</p>
      <button className="claudian-skill-migration-button" disabled={busy} onClick={() => { void confirmCopy(item); }}>{t('common.confirm')}</button>
      <button className="claudian-skill-migration-button" disabled={busy} onClick={() => setPending(null)}>{t('common.cancel')}</button>
    </div>}
  </div>;
  const actionable = items?.filter(item => !item.blocked) ?? [];
  const blocked = items?.filter(item => item.blocked) ?? [];
  return <section className="claudian-skill-migration">
    <h3 className="claudian-skill-migration-title">{t('settings.skillMigration.title')}</h3>
    <p className="claudian-skill-migration-description">{t('settings.skillMigration.desc')}</p>
    <button className="claudian-skill-migration-button" disabled={busy} onClick={() => { void refresh(); }}>{t('settings.skillMigration.preview')}</button>
    {items && items.length === 0 && <p>{t('settings.skillMigration.empty')}</p>}
    {actionable.map(renderItem)}
    {blocked.length > 0 && <details className="claudian-skill-migration-blocked">
      <summary>{t('settings.skillMigration.blockedCount', { count: blocked.length })}</summary>
      {blocked.map(renderItem)}
    </details>}
  </section>;
}
