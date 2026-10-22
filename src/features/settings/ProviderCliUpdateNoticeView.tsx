import { t } from '@/i18n/i18n';

export function ProviderCliUpdateNoticeView({ count, onReview }: {
  count: number;
  onReview: () => void;
}) {
  return (
    <div className="claudian-cli-update-notice">
      <span className="claudian-cli-update-notice-copy">{t('settings.cliUpdates.noticeTitle', { count })}</span>
      <button type="button" className="claudian-cli-update-notice-action" onClick={event => {
        event.stopPropagation();
        onReview();
      }}>{t('settings.cliUpdates.review')}</button>
    </div>
  );
}
