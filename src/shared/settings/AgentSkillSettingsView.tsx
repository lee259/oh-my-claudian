import { setIcon } from 'obsidian';
import { useRef, useState } from 'preact/hooks';

import type { AgentSkillDiagnostic, AgentSkillDocument } from '../../core/skills/AgentSkill';
import { t } from '../../i18n/i18n';

export type AgentSkillSettingsStatus = 'loading' | 'ready' | 'error';

export interface AgentSkillSettingsViewProps {
  status: AgentSkillSettingsStatus;
  skills: readonly AgentSkillDocument[];
  diagnostics: readonly AgentSkillDiagnostic[];
  onRefresh: () => void;
  onAdd: () => void;
  onOpen: (skill: AgentSkillDocument) => void;
  onEdit: (skill: AgentSkillDocument) => void;
  onDelete: (skill: AgentSkillDocument) => void;
}

export function AgentSkillSettingsView({
  status,
  skills,
  diagnostics,
  onRefresh,
  onAdd,
  onOpen,
  onEdit,
  onDelete,
}: AgentSkillSettingsViewProps) {
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const filter = query.trim().toLocaleLowerCase();
  const visibleSkills = skills.filter(skill => (
    `${skill.name}\n${skill.description}`.toLocaleLowerCase().includes(filter)
  ));
  return (
    <div className="claudian-agent-skills-view" aria-busy={status === 'loading'}>
      <div className="claudian-agent-skills-header">
        <div className="claudian-agent-skills-help">
          <div className="claudian-agent-skills-title-row">
            <h3 className="claudian-agent-skills-title">{t('settings.agentSkills.sharedSkillsTitle')}</h3>
            {status === 'ready' && <span className="claudian-agent-skills-count">{skills.length}</span>}
          </div>
          <p>{t('settings.agentSkills.sharedExpectation')}</p>
        </div>
      </div>
      <div className="claudian-agent-skills-toolbar">
        <div className="claudian-agent-skills-search">
          <SkillIcon icon="search" />
          <input
            ref={searchInput}
            type="search"
            value={query}
            placeholder={t('settings.agentSkills.search')}
            aria-label={t('settings.agentSkills.search')}
            onInput={event => setQuery(event.currentTarget.value)}
          />
          {query && <IconButton
            icon="x"
            label={t('settings.agentSkills.clearSearch')}
            onClick={() => {
              setQuery('');
              searchInput.current?.focus();
            }}
          />}
        </div>
        <div className="claudian-agent-skills-toolbar-actions">
          <IconButton
            icon="refresh-cw"
            label={t('common.refresh')}
            disabled={status === 'loading'}
            onClick={onRefresh}
          />
          <button type="button" className="claudian-agent-skills-add" onClick={onAdd}>
            <SkillIcon icon="plus" />
            {t('common.add')}
          </button>
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
          ) : visibleSkills.length === 0 ? (
            <div className="claudian-sp-empty-state" role="status">
              {t('settings.agentSkills.noMatches')}
            </div>
          ) : (
            <div className="claudian-agent-skills-list" role="list">
              {visibleSkills.map(skill => (
                <div className="claudian-agent-skills-row" role="listitem" key={`${skill.name}:${skill.revision}`}>
                  <div className="claudian-agent-skills-info">
                    <div className="claudian-agent-skills-name-line">
                      <button
                        type="button"
                        className="claudian-sp-item-name claudian-agent-skill-item-link claudian-agent-skill-item-link--title"
                        title={skill.name}
                        onClick={event => {
                          event.stopPropagation();
                          onOpen(skill);
                        }}
                      >
                        {skill.name}
                      </button>
                    </div>
                    <div className="claudian-agent-skills-description" title={skill.description}>{skill.description}</div>
                  </div>
                  <div className="claudian-agent-skills-actions">
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
      <SkillIcon icon={icon} />
    </button>
  );
}

function SkillIcon({ icon }: { icon: string }) {
  return <span aria-hidden="true" ref={element => {
    if (element) setIcon(element, icon);
  }} />;
}
