import type {
  ProviderExecutionRequest,
  ProviderResolvedHistoryDiagnostics,
} from './ProviderExecutionRequest';

/** Reports the content-free size of the prompt sent for the current turn. */
export function reportResolvedTurnPrompt(
  request: ProviderExecutionRequest,
  characters: number,
): void {
  request.diagnostics?.onResolved?.({
    turnPrompt: {
      source: 'provider',
      characters,
      sections: [{ name: 'turn-prompt', characters }],
    },
  });
}

/** Reports content-free history replay compaction facts for the current turn. */
export function reportHistoryReplay(
  request: ProviderExecutionRequest,
  diagnostics: ProviderResolvedHistoryDiagnostics,
): void {
  request.diagnostics?.onResolved?.({ historyReplay: diagnostics });
}
