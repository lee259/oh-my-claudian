import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { CLAUDIAN_STORAGE_PATH } from '../../../core/bootstrap/storagePaths';
import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
import { expandHomePath } from '../../../utils/path';
import {
  OPENCODE_BUILD_MODE_ID,
  OPENCODE_PLAN_MODE_ID,
  OPENCODE_SAFE_MODE_ID,
  OPENCODE_YOLO_MODE_ID,
} from '../modes';
import { resolveOpencodeDatabasePath } from './OpencodePaths';

export interface OpencodeLaunchArtifacts {
  configPath: string;
  configContent: string;
  databasePath: string | null;
  launchKey: string;
  systemPromptPath: string;
}

export interface OpencodeManagedAgentConfig {
  definition?: Record<string, unknown>;
  id: string;
}

export type OpencodeSystemPrompt =
  | {
      readonly kind: 'none';
    }
  | {
      readonly kind: 'default';
      readonly settings: SystemPromptSettings;
    }
  | {
      readonly kind: 'explicit';
      readonly key: string;
      readonly text: string;
    };

const DEFAULT_OPENCODE_MANAGED_AGENT_CONFIGS: readonly OpencodeManagedAgentConfig[] = [
  { id: OPENCODE_BUILD_MODE_ID },
  {
    definition: {
      mode: 'primary',
      permission: {
        plan_enter: 'allow',
        question: 'allow',
      },
    },
    id: OPENCODE_YOLO_MODE_ID,
  },
  {
    definition: {
      mode: 'primary',
      permission: {
        plan_enter: 'allow',
        question: 'allow',
        bash: 'ask',
        edit: 'ask',
      },
    },
    id: OPENCODE_SAFE_MODE_ID,
  },
  { id: OPENCODE_PLAN_MODE_ID },
];

export interface PrepareOpencodeLaunchArtifactsParams {
  artifactsSubdir?: string;
  defaultAgentId?: string;
  managedAgents?: readonly OpencodeManagedAgentConfig[];
  runtimeEnv: NodeJS.ProcessEnv;
  systemPrompt: OpencodeSystemPrompt;
  userName?: string;
  workspaceRoot: string;
}

export async function prepareOpencodeLaunchArtifacts(
  params: PrepareOpencodeLaunchArtifactsParams,
): Promise<OpencodeLaunchArtifacts> {
  const artifactsDir = path.join(
    params.workspaceRoot,
    CLAUDIAN_STORAGE_PATH,
    params.artifactsSubdir ?? 'opencode',
  );
  const systemPromptPath = path.join(artifactsDir, 'system.md');
  const configPath = path.join(artifactsDir, 'config.json');
  const systemPrompt = resolveSystemPrompt(params.systemPrompt);
  const systemPromptPathForConfig = systemPrompt ? systemPromptPath : undefined;
  const promptKey = resolveSystemPromptKey(params.systemPrompt);
  const baseConfig = await loadOpencodeBaseConfig(
    params.runtimeEnv.OPENCODE_CONFIG,
    params.workspaceRoot,
  );
  const configContent = `${JSON.stringify(
    buildOpencodeManagedConfig(
      baseConfig,
      systemPromptPathForConfig,
      params.userName
        ?? (params.systemPrompt.kind === 'default'
          ? params.systemPrompt.settings.userName
          : undefined),
      params.managedAgents,
      params.defaultAgentId,
    ),
    null,
    2,
  )}\n`;
  const databasePath = resolveOpencodeDatabasePath(params.runtimeEnv);

  await fs.mkdir(artifactsDir, { recursive: true });
  await ensureOpencodeDatabaseDirectory(databasePath);
  if (systemPrompt) {
    await writeIfChanged(systemPromptPath, systemPrompt);
  }
  await writeIfChanged(configPath, configContent);

  return {
    configPath,
    configContent,
    databasePath,
    launchKey: [
      promptKey,
      configContent,
      databasePath ?? '',
      params.runtimeEnv.XDG_DATA_HOME ?? '',
    ].join('::'),
    systemPromptPath,
  };
}

function resolveSystemPrompt(systemPrompt: OpencodeSystemPrompt): string {
  switch (systemPrompt.kind) {
    case 'none':
      return '';
    case 'explicit':
      return normalizeSystemPrompt(systemPrompt.text);
    case 'default':
      return normalizeSystemPrompt(buildSystemPrompt(systemPrompt.settings));
  }
}

function resolveSystemPromptKey(systemPrompt: OpencodeSystemPrompt): string {
  switch (systemPrompt.kind) {
    case 'none':
      return 'none';
    case 'explicit':
      return systemPrompt.key;
    case 'default':
      return computeSystemPromptKey(systemPrompt.settings);
  }
}

async function ensureOpencodeDatabaseDirectory(databasePath: string | null): Promise<void> {
  if (!databasePath || databasePath === ':memory:') {
    return;
  }

  await fs.mkdir(path.dirname(databasePath), { recursive: true });
}

export function buildOpencodeManagedConfig(
  baseConfig: Record<string, unknown>,
  systemPromptPath?: string,
  userName?: string,
  managedAgents: readonly OpencodeManagedAgentConfig[] = DEFAULT_OPENCODE_MANAGED_AGENT_CONFIGS,
  defaultAgentId?: string,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    ...baseConfig,
    $schema: typeof baseConfig.$schema === 'string'
      ? baseConfig.$schema
      : 'https://opencode.ai/config.json',
  };
  const existingAgents = isPlainObject(baseConfig.agent)
    ? { ...baseConfig.agent }
    : {};
  const nextAgents: Record<string, unknown> = { ...existingAgents };
  const agentConfigs = managedAgents.length > 0
    ? managedAgents
    : DEFAULT_OPENCODE_MANAGED_AGENT_CONFIGS;

  for (const agentConfig of agentConfigs) {
    const existingAgentValue = existingAgents[agentConfig.id];
    const existingAgent = isPlainObject(existingAgentValue)
      ? { ...existingAgentValue }
      : {};
    nextAgents[agentConfig.id] = {
      ...existingAgent,
      ...(isPlainObject(agentConfig.definition) ? agentConfig.definition : {}),
      ...(systemPromptPath ? { prompt: `{file:${systemPromptPath}}` } : {}),
    };
  }

  config.agent = nextAgents;
  const trimmedDefaultAgentId = defaultAgentId?.trim();
  if (trimmedDefaultAgentId) {
    config.default_agent = trimmedDefaultAgentId;
  }

  const trimmedUserName = userName?.trim();
  if (trimmedUserName) {
    config.username = trimmedUserName;
  }

  return config;
}

async function writeIfChanged(filePath: string, content: string): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    if (existing === content) {
      return;
    }
  } catch {
    // Missing file; write below.
  }

  await fs.writeFile(filePath, content, 'utf-8');
}

async function loadOpencodeBaseConfig(
  configuredPath: string | undefined,
  workspaceRoot: string,
): Promise<Record<string, unknown>> {
  const trimmedPath = configuredPath?.trim();
  if (!trimmedPath) {
    return {};
  }

  const expandedPath = expandHomePath(trimmedPath);
  const resolvedPath = path.isAbsolute(expandedPath)
    ? expandedPath
    : path.resolve(workspaceRoot, expandedPath);

  try {
    const rawConfig = await fs.readFile(resolvedPath, 'utf8');
    const parsedConfig = JSON.parse(rawConfig) as unknown;
    return isPlainObject(parsedConfig) ? parsedConfig : {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSystemPrompt(systemPrompt: string): string {
  return systemPrompt.endsWith('\n') ? systemPrompt : `${systemPrompt}\n`;
}
