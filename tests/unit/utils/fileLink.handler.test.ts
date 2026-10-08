jest.mock('@/utils/obsidianCompat', () => ({
  getVaultFileByPath: jest.fn(),
  isExternalTextFilePath: (filePath: string) => filePath.startsWith('/') && filePath.endsWith('.md'),
  openVaultFile: jest.fn().mockResolvedValue(true),
}));

import { registerFileLinkHandler } from '@/utils/fileLink';
import { openVaultFile } from '@/utils/obsidianCompat';

describe('registerFileLinkHandler', () => {
  it('opens data-href target when present', () => {
    const app = {
      workspace: {
        openLinkText: jest.fn(),
      },
    };

    const link: any = {
      dataset: { href: 'note#section' },
      getAttribute: jest.fn().mockReturnValue('note'),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);

    const event = {
      target: link,
      preventDefault: jest.fn(),
    } as any;

    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => {
        cb(event);
      },
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note#section', '', 'tab');
  });

  it('falls back to href when data-href is missing', () => {
    const app = {
      workspace: {
        openLinkText: jest.fn(),
      },
    };

    const link: any = {
      dataset: {},
      getAttribute: jest.fn().mockReturnValue('note^block'),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);

    const event = {
      target: link,
      preventDefault: jest.fn(),
    } as any;

    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => {
        cb(event);
      },
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);

    expect(app.workspace.openLinkText).toHaveBeenCalledWith('note^block', '', 'tab');
  });

  it('routes external text-file links through the compatibility opener', () => {
    const app = { workspace: { openLinkText: jest.fn() } };
    const link: any = {
      dataset: { href: '/Users/lee/notes/README.md' },
      getAttribute: jest.fn(),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);
    const event = { target: link, preventDefault: jest.fn() } as any;
    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => cb(event),
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);

    expect(openVaultFile).toHaveBeenCalledWith(app, '/Users/lee/notes/README.md');
    expect(app.workspace.openLinkText).not.toHaveBeenCalled();
  });

  it('routes managed skill links through the compatibility opener', () => {
    const app = { workspace: { openLinkText: jest.fn() } };
    const link: any = {
      dataset: { href: '.agents/skills/release-notes/SKILL.md' },
      getAttribute: jest.fn(),
      closest: jest.fn(),
    };
    link.closest.mockReturnValue(link);
    const event = { target: link, preventDefault: jest.fn() } as any;
    const component = {
      registerDomEvent: (_el: HTMLElement, _event: string, cb: (event: MouseEvent) => void) => cb(event),
    };

    registerFileLinkHandler(app as any, {} as HTMLElement, component as any);

    expect(openVaultFile).toHaveBeenCalledWith(app, '.agents/skills/release-notes/SKILL.md');
    expect(app.workspace.openLinkText).not.toHaveBeenCalled();
  });
});
