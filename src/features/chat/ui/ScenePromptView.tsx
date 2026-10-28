import { t } from '@/i18n/i18n';

interface ScenePromptViewProps {
  hasSelection: boolean;
  hasCurrentNote: boolean;
  hasMessages: boolean;
  draft: string;
  onChoose: (prompt: string) => void;
}

export function ScenePromptView({ hasSelection, hasCurrentNote, hasMessages, draft, onChoose }: ScenePromptViewProps) {
  if (hasMessages || draft || (!hasSelection && !hasCurrentNote)) return null;
  const actions = hasSelection
    ? [
      { label: t('chat.scenePrompts.explain'), prompt: t('chat.scenePrompts.explainPrompt') },
      { label: t('chat.scenePrompts.polish'), prompt: t('chat.scenePrompts.polishPrompt') },
      { label: t('chat.scenePrompts.shorten'), prompt: t('chat.scenePrompts.shortenPrompt') },
    ]
    : [
      { label: t('chat.scenePrompts.summarize'), prompt: t('chat.scenePrompts.summarizePrompt') },
      { label: t('chat.scenePrompts.tasks'), prompt: t('chat.scenePrompts.tasksPrompt') },
      { label: t('chat.scenePrompts.related'), prompt: t('chat.scenePrompts.relatedPrompt') },
    ];
  return <div className="claudian-scene-prompts" role="group" aria-label={t('chat.scenePrompts.label')}>
    {actions.map(action => <button type="button" className="claudian-scene-prompt claudian-scene-prompt--chip" onClick={() => onChoose(action.prompt)}>{action.label}</button>)}
  </div>;
}
