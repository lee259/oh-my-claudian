import type { ProviderCapabilities } from '../../core/providers/types';

export const OPENCODE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'opencode',
  supportsResponseThroughput: true,
  supportsNativeHistory: true,
  supportsEphemeralSessions: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: true,
  supportsEphemeralFork: false,
  forkMode: 'full-session',
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsTurnSteer: true,
  reasoningControl: 'effort',
});
