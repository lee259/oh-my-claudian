export interface SkillMigrationCandidate {
  source: string;
  name: string;
  description?: string;
  markdown?: string;
  revision: string;
  warnings: string[];
  frontmatterFields?: string[];
  syntaxMarkers?: string[];
  nonPortablePaths?: string[];
  renamedFrom?: string;
  linkTarget?: string;
  blocked: boolean;
  extraFiles: string[];
}

export interface SkillMigrationFile {
  path: string;
  content: ArrayBuffer;
  mode?: number;
}

export interface SkillMigrationDirectory {
  path: string;
  mode?: number;
}

export interface SkillMigrationService {
  preview(): Promise<SkillMigrationCandidate[]>;
  prepare(candidate: SkillMigrationCandidate): Promise<{ name: string; markdown: string; files: SkillMigrationFile[]; directories: SkillMigrationDirectory[]; rootMode?: number }>;
}
