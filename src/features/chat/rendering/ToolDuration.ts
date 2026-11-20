import type { ToolCallInfo } from '@/core/types';
import { formatDurationMmSs } from '@/utils/date';

function formatRecordedDuration(durationMs: number): string {
  if (durationMs > 0 && durationMs < 1) return '<1ms';
  const milliseconds = Math.round(durationMs);
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return formatDurationMmSs(Math.floor(milliseconds / 1000));
}

/** Keep settled timing available for inspection without a live presentation timer. */
export function attachToolDuration(header: HTMLElement, tool: ToolCallInfo): (tool: ToolCallInfo) => void {
  const label = header.createSpan({ cls: 'claudian-tool-duration' });
  const update = (current: ToolCallInfo) => {
    if (current.status === 'running') {
      label.setText('');
      return;
    }
    if (current.durationMs !== undefined && Number.isFinite(current.durationMs) && current.durationMs >= 0) {
      label.setText(formatRecordedDuration(current.durationMs));
      return;
    }
    if (current.startedAt === undefined || current.completedAt === undefined) {
      label.setText('');
      return;
    }
    const seconds = Math.max(0, Math.floor((current.completedAt - current.startedAt) / 1000));
    label.setText(formatDurationMmSs(seconds));
  };
  update(tool);
  return update;
}
