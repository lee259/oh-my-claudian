export interface GeneralSettingsSection {
  id: string;
  title: string;
  description?: string;
}

export interface GeneralSettingsLayoutProps {
  sections: readonly GeneralSettingsSection[];
  onSectionMount: (sectionId: string, element: HTMLElement | null) => void;
}

export function GeneralSettingsLayout({
  sections,
  onSectionMount,
}: GeneralSettingsLayoutProps) {
  return (
    <div className="claudian-settings-general-layout">
      {sections.map((section) => {
        const headingId = `claudian-settings-general-section-${section.id}-heading`;
        const descriptionId = `${headingId}-description`;
        return (
          <section
            className="claudian-settings-general-section"
            data-section-id={section.id}
            aria-labelledby={headingId}
            aria-describedby={section.description ? descriptionId : undefined}
            key={section.id}
          >
            <div className="claudian-settings-general-section-header">
              <h2 id={headingId}>{section.title}</h2>
              {section.description && (
                <p
                  className="claudian-settings-general-section-description"
                  id={descriptionId}
                >
                  {section.description}
                </p>
              )}
            </div>
            <div
              className="claudian-settings-general-section-body"
              ref={(element) => onSectionMount(section.id, element)}
            />
          </section>
        );
      })}
    </div>
  );
}
