import { useEffect, useRef, useState } from 'preact/hooks';

export interface SettingsSaveLabels {
  saving: string;
  saved: string;
  error: string;
}

export interface SettingsSaveState {
  status: 'saving' | 'saved' | 'error';
  message?: string;
}

export interface SettingsSaveFeedbackProps {
  state?: SettingsSaveState;
  labels: SettingsSaveLabels;
}

type SaveAction = () => Promise<void> | void;

export function useSettingsSaveState(): {
  states: Readonly<Record<string, SettingsSaveState>>;
  save: (id: string, action: SaveAction) => Promise<boolean>;
} {
  const [states, setStates] = useState<Record<string, SettingsSaveState>>({});
  const versionsRef = useRef(new Map<string, number>());
  const timersRef = useRef(new Map<string, number>());
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, []);

  const save = async (id: string, action: SaveAction): Promise<boolean> => {
    const version = (versionsRef.current.get(id) ?? 0) + 1;
    versionsRef.current.set(id, version);
    const existingTimer = timersRef.current.get(id);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      timersRef.current.delete(id);
    }
    if (mountedRef.current) {
      setStates(previous => ({ ...previous, [id]: { status: 'saving' } }));
    }

    try {
      await action();
      if (versionsRef.current.get(id) === version && mountedRef.current) {
        setStates(previous => ({ ...previous, [id]: { status: 'saved' } }));
        timersRef.current.set(id, window.setTimeout(() => {
          if (versionsRef.current.get(id) !== version) return;
          timersRef.current.delete(id);
          setStates(previous => {
            const next = { ...previous };
            delete next[id];
            return next;
          });
        }, 1800));
      }
      return true;
    } catch (error) {
      if (versionsRef.current.get(id) === version && mountedRef.current) {
        setStates(previous => ({
          ...previous,
          [id]: {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        }));
      }
      return false;
    }
  };

  return { states, save };
}

export function SettingsSaveFeedback({ state, labels }: SettingsSaveFeedbackProps) {
  if (!state) return null;

  const isError = state.status === 'error';
  const message = state.status === 'saving'
    ? labels.saving
    : state.status === 'saved'
      ? labels.saved
      : state.message
        ? `${labels.error}: ${state.message}`
        : labels.error;

  return (
    <div
      aria-atomic="true"
      aria-live={isError ? 'assertive' : 'polite'}
      className={`claudian-settings-save-feedback${isError ? ' claudian-settings-save-feedback--error' : ''}`}
      role={isError ? 'alert' : 'status'}
    >
      {message}
    </div>
  );
}
