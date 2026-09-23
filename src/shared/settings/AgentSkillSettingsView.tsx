import { setIcon } from 'obsidian';

import type { AgentSkillDiagnostic, AgentSkillDocument } from '../../core/skills/AgentSkill';
import { t } from '../../i18n/i18n';

export type AgentSkillSettingsStatus = 'loading' | 'ready' | 'error';

export interface AgentSkillSettingsViewProps {
  status: AgentSkillSettingsStatus;
  skills: readonly AgentSkillDocument[];
  diagnostics: readonly AgentSkillDiagnostic[];
  onRefresh: () => void;
  onAdd: () => void;
  onEdit: (skill: AgentSkillDocument) => void;
  onDelete: (skill: AgentSkillDocument) => void;
}

export function AgentSkillSettingsView({
  status,
  skills,
  diagnostics,
  onRefresh,
  onAdd,
  onEdit,
  onDelete,
}: AgentSkillSettingsViewProps) {
  return (
    <div className="claudian-agent-skills-view" aria-busy={status === 'loading'}>
      <div className="claudian-sp-header claudian-agent-skills-header">
        <div className="claudian-agent-skills-help">
          <p>{t('settings.agentSkills.sharedExpectation')}</p>
        </div>
        <div className="claudian-sp-header-actions">
          <IconButton
            icon="refresh-cw"
            label={t('common.refresh')}
            disabled={status === 'loading'}
            onClick={onRefresh}
          />
          <IconButton icon="plus" label={t('common.add')} onClick={onAdd} />
        </div>
      </div>

      {status === 'loading' ? (
        <div className="claudian-sp-empty-state claudian-agent-skills-loading" role="status" aria-live="polite">
          {t('common.loading')}
        </div>
      ) : status === 'error' ? (
        <div className="claudian-agent-skills-error" role="alert">
          {t('settings.agentSkills.loadFailed')}
        </div>
      ) : (
        <>
          {skills.length === 0 ? (
            <div className="claudian-sp-empty-state">{t('settings.agentSkills.noSkills')}</div>
          ) : (
            <div className="claudian-sp-list">
              {skills.map(skill => (
                <div className="claudian-sp-item" key={`${skill.name}:${skill.revision}`}>
                  <div className="claudian-sp-info">
                    <div className="claudian-sp-item-header">
                      <span className="claudian-sp-item-name">{skill.name}</span>
                      <span className="claudian-slash-item-badge">
                        {t('settings.agentSkills.skillBadge')}
                      </span>
                    </div>
                    <div className="claudian-sp-item-desc">{skill.description}</div>
                  </div>
                  <div className="claudian-sp-item-actions">
                    <IconButton
                      icon="pencil"
                      label={t('common.edit')}
                      onClick={() => onEdit(skill)}
                    />
                    <IconButton
                      icon="trash-2"
                      label={t('common.delete')}
                      className="claudian-settings-delete-btn"
                      onClick={() => onDelete(skill)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          {diagnostics.length > 0 && (
            <div className="claudian-agent-skills-diagnostics">
              <div className="claudian-agent-skills-diagnostics-title">
                {t('settings.agentSkills.diagnosticsTitle')}
              </div>
              {diagnostics.map(diagnostic => (
                <div
                  className="claudian-agent-skills-diagnostic"
                  key={`${diagnostic.directoryPath}:${diagnostic.message}`}
                >
                  <code>{diagnostic.directoryPath}</code>
                  <span>{diagnostic.message}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface IconButtonProps {
  icon: string;
  label: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}

function IconButton({ icon, label, disabled, className, onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`claudian-settings-action-btn${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true" ref={element => {
        if (element) setIcon(element, icon);
      }} />
    </button>
  );
}
