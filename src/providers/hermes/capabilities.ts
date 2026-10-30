import type { ProviderCapabilities } from '@/core/providers/types';
export const HERMES_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'hermes', supportsNativeHistory: false, supportsEphemeralSessions: false,
  supportsPlanMode: false, supportsRewind: false, supportsFork: false,
  supportsProviderCommands: false, supportsImageAttachments: true, supportsInstructionMode: false,
  supportsMcpTools: false, supportsTurnSteer: false, reasoningControl: 'none',
});
