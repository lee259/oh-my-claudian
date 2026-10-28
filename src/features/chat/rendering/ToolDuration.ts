import type { ToolCallInfo } from '@/core/types';
import { formatDurationMmSs } from '@/utils/date';

/** Attach a presentation timer; the tool record remains the source of timing. */
export function attachToolDuration(header: HTMLElement, tool: ToolCallInfo): (tool: ToolCallInfo) => void {
  const label = header.createSpan({ cls: 'claudian-tool-duration' });
  let current = tool;
  const ownerWindow = header.ownerDocument.defaultView;
  let timer: number | undefined;
  const update = () => {
    if (current.startedAt === undefined || (current.status !== 'running' && current.completedAt === undefined)) {
      label.setText('');
    } else {
      const end = current.completedAt ?? Date.now();
      label.setText(formatDurationMmSs(Math.max(0, Math.floor((end - current.startedAt) / 1000))));
    }
    if ((current.status !== 'running' || current.completedAt !== undefined) && timer !== undefined) {
      ownerWindow?.clearInterval(timer);
      timer = undefined;
    }
  };
  update();
  if (ownerWindow && tool.status === 'running' && tool.startedAt !== undefined) {
    timer = ownerWindow.setInterval(() => {
      if (!header.isConnected) {
        ownerWindow?.clearInterval(timer);
        timer = undefined;
      } else update();
    }, 1000);
  }
  return next => { current = next; update(); };
}
