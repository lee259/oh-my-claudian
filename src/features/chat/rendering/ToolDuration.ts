import type { ToolCallInfo } from '@/core/types';
import { formatDurationMmSs } from '@/utils/date';

/** Keep settled timing available for inspection without a live presentation timer. */
export function attachToolDuration(header: HTMLElement, tool: ToolCallInfo): (tool: ToolCallInfo) => void {
  const label = header.createSpan({ cls: 'claudian-tool-duration' });
  const update = (current: ToolCallInfo) => {
    if (current.status === 'running' || current.startedAt === undefined || current.completedAt === undefined) {
      label.setText('');
      return;
    }
    const seconds = Math.max(0, Math.floor((current.completedAt - current.startedAt) / 1000));
    label.setText(formatDurationMmSs(seconds));
  };
  update(tool);
  return update;
}
