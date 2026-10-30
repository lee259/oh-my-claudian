import type { UsageInfo } from '@/core/types';
import { t } from '@/i18n/i18n';

const SIZE = 16;
const STROKE_WIDTH = 2;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CENTER = SIZE / 2;
const ARC_RADIANS = 240 * Math.PI / 180;
const CIRCUMFERENCE = RADIUS * ARC_RADIANS;
const start = 150 * Math.PI / 180;
const end = 390 * Math.PI / 180;
const path = `M ${CENTER + RADIUS * Math.cos(start)} ${CENTER + RADIUS * Math.sin(start)} A ${RADIUS} ${RADIUS} 0 1 1 ${CENTER + RADIUS * Math.cos(end)} ${CENTER + RADIUS * Math.sin(end)}`;

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

export function ContextUsageMeterView({ usage, visible }: { usage: UsageInfo | null; visible: boolean }) {
  const warning = (usage?.percentage ?? 0) > 80;
  const details = usage ? `${formatTokens(usage.contextTokens)} / ${formatTokens(usage.contextWindow)}` : undefined;
  const tooltip = warning ? `${details} (Approaching limit, run \`/compact\` to continue)` : details;
  const offset = CIRCUMFERENCE - ((usage?.percentage ?? 0) / 100) * CIRCUMFERENCE;
  return (
    <div
      className={`claudian-context-meter${visible ? '' : ' claudian-hidden'}${warning ? ' warning' : ''}`}
      role="progressbar"
      aria-label={t('chat.composer.contextUsage')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={usage?.percentage}
      aria-valuetext={details}
      data-tooltip={tooltip}
    >
      <div className="claudian-context-meter-gauge">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <path className="claudian-meter-bg" d={path} fill="none" stroke-width={STROKE_WIDTH} stroke-linecap="round" />
          <path className="claudian-meter-fill" d={path} fill="none" stroke-width={STROKE_WIDTH} stroke-linecap="round"
            stroke-dasharray={CIRCUMFERENCE} stroke-dashoffset={offset} />
        </svg>
      </div>
      <span className="claudian-context-meter-percent">{usage ? `${usage.percentage}%` : ''}</span>
    </div>
  );
}
