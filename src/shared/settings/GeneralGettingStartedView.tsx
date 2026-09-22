export interface GeneralGettingStartedViewProps {
  steps: readonly string[];
  actionLabel: string;
  actionDescription: string;
  onOpenChat: () => void;
}

export function GeneralGettingStartedView({
  steps,
  actionLabel,
  actionDescription,
  onOpenChat,
}: GeneralGettingStartedViewProps) {
  return (
    <>
      <ol className="claudian-getting-started-steps">
        {steps.map(step => <li key={step}>{step}</li>)}
      </ol>
      <div className="claudian-getting-started-action-row">
        <button
          className="claudian-getting-started-action"
          type="button"
          onClick={onOpenChat}
        >
          {actionLabel}
        </button>
        <p className="claudian-getting-started-action-description">
          {actionDescription}
        </p>
      </div>
    </>
  );
}
