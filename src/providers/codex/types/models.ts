export type CodexModel = string;

export const CODEX_SPARK_MODEL: CodexModel = 'gpt-5.3-codex-spark';

export function formatCodexModelLabel(name: string): string {
  const match = name.match(/^gpt-(\d[^-\s]*)(?:-(\S+))?$/i);
  if (!match) {
    return name;
  }

  const [, version, suffix] = match;
  const words = suffix?.split('-').filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)) ?? [];
  return [`GPT-${version}`, ...words].join(' ');
}
