/** Formats recent activity in the compact form used by chat history surfaces. */
export function formatActivity(timestamp: number, now = Date.now(), locale?: string): string {
  const elapsedMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsedMs / 60_000);
  const resolvedLocale = locale ?? new Intl.DateTimeFormat().resolvedOptions().locale;
  const isChinese = /^zh(?:-|$)/i.test(resolvedLocale);

  if (minutes < 1) return isChinese ? '刚刚' : 'now';

  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (isChinese) {
    if (minutes < 60) return `${minutes} 分`;
    if (hours < 24) return `${hours} 小时`;
    return `${days} 天`;
  }

  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}
