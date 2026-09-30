import type { ProviderCapabilities } from '../../core/providers/types';

export const DSH_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'dsh',
  supportsNativeHistory: true,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: false,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});
