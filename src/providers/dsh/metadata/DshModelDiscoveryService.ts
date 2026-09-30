import type { ProviderSessionConfig } from '@/core/execution';
import type { ProviderInteractionPort } from '@/core/execution/ProviderInteractionPort';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { getVaultPath } from '@/utils/path';

import { DefaultDshAcpSessionKernel } from '../execution/DshAcpSessionKernel';
import {
  normalizeDshConfigOptionCatalog,
  normalizeDshReasoningConfigOptions,
} from '../models';
const DISCOVERY_INTERACTION_PORT: ProviderInteractionPort = {
  requestApproval: async () => { throw new Error('Model discovery cannot request approval.'); },
  askUserQuestion: async () => { throw new Error('Model discovery cannot ask a question.'); },
  requestPlanDecision: async () => { throw new Error('Model discovery cannot request a plan decision.'); },
  dismissInteraction: () => undefined,
};

export interface DshDiscoveredCatalog {
  defaultModelId: string | null;
  models: ReturnType<typeof normalizeDshConfigOptionCatalog>['models'];
  reasoning: ReturnType<typeof normalizeDshReasoningConfigOptions>;
  sessionId: string;
}

export class DshModelDiscoveryService {
  constructor(private readonly plugin: ProviderHost) {}

  async discoverCatalog(resumeSessionId?: string): Promise<DshDiscoveredCatalog> {
    const vaultPath = getVaultPath(this.plugin.app) ?? process.cwd();
    const config: ProviderSessionConfig = {
      lifecycle: 'ephemeral',
      nativePersistence: 'disabled-if-supported',
      vaultWorkingDirectory: vaultPath,
      interactionPort: DISCOVERY_INTERACTION_PORT,
    };
    let nativeSessionId: string | null = null;
    const kernel = new DefaultDshAcpSessionKernel({
      config,
      getActiveTurnId: () => null,
      onClosed: () => undefined,
      onNotification: () => undefined,
      plugin: this.plugin,
      sessionInstanceId: 'dsh-model-discovery',
    });

    try {
      await kernel.connect();
      let session;
      try {
        session = await kernel.openSession(resumeSessionId);
      } catch (error) {
        if (!resumeSessionId) throw error;
        session = await kernel.openSession();
      }
      nativeSessionId = session.sessionId;
      const catalog = normalizeDshConfigOptionCatalog(session.configOptions);
      const models = catalog.models;
      if (!models.length) {
        throw new Error('DeepSeek Harness ACP returned no model options. Check the DSH model provider configuration.');
      }
      return {
        models,
        defaultModelId: catalog.defaultModelId,
        reasoning: normalizeDshReasoningConfigOptions(session.configOptions),
        sessionId: session.sessionId,
      };
    } finally {
      if (nativeSessionId) await kernel.closeSession(nativeSessionId).catch(() => undefined);
      await kernel.dispose();
    }
  }
}
