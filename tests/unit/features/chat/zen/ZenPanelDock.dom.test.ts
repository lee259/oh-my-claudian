/** @jest-environment jsdom */
import { ZenPanelDock } from '@/features/chat/zen/ZenPanelDock';

it('supports keyboard movement, clamps the panel, persists offsets and returns Home to the dock', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.appendChild(document.createElement('div'));
  const grip = root.appendChild(document.createElement('button'));
  host.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} });
  root.getBoundingClientRect = () => ({ x: 200, y: 400, left: 200, top: 400, right: 600, bottom: 560, width: 400, height: 160, toJSON() {} });
  const save = jest.fn();
  const dock = new ZenPanelDock(host, root, grip, null, save);
  grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  expect(root.style.left).toBe('184px');
  expect(save).toHaveBeenLastCalledWith({ x: -0.02, y: 0 });
  grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  expect(save).toHaveBeenLastCalledWith(null);
  expect(root.style.left).toBe('200px');
  dock.destroy();
  host.remove();
});

it('does not persist a cancelled pointer drag and clamps an out-of-bounds move', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.appendChild(document.createElement('div'));
  const grip = root.appendChild(document.createElement('button'));
  host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  root.getBoundingClientRect = () => ({ left: 200, top: 400, width: 400, height: 160 }) as DOMRect;
  const save = jest.fn();
  const dock = new ZenPanelDock(host, root, grip, null, save);
  const pointer = (type: string, x: number, y: number) => Object.assign(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 }), { pointerId: 1 });
  grip.dispatchEvent(pointer('pointerdown', 200, 400));
  document.dispatchEvent(pointer('pointermove', -800, -800));
  expect(root.style.left).toBe('8px');
  expect(root.style.top).toBe('8px');
  document.dispatchEvent(pointer('pointercancel', -800, -800));
  expect(root.style.left).toBe('200px');
  expect(save).not.toHaveBeenCalled();
  dock.destroy();
  host.remove();
});

it('opens composer menus toward available workspace space after moving the panel', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.appendChild(document.createElement('div'));
  const toolbar = root.appendChild(document.createElement('div'));
  toolbar.className = 'claudian-input-toolbar';
  const grip = root.appendChild(document.createElement('button'));
  host.getBoundingClientRect = () => ({ top: 100, bottom: 700, left: 0, width: 800, height: 600 }) as DOMRect;
  root.getBoundingClientRect = () => ({ top: 100 + (parseFloat(root.style.top) || 0), width: 400, height: 160 }) as DOMRect;
  toolbar.getBoundingClientRect = () => ({ top: 200 + parseFloat(root.style.top), bottom: 240 + parseFloat(root.style.top) }) as DOMRect;
  const dock = new ZenPanelDock(host, root, grip, { x: 0, y: -1 }, jest.fn());
  expect(root.classList.contains('opens-below')).toBe(true);
  expect(root.style.getPropertyValue('--claudian-zen-menu-height')).toBe('436px');
  grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  expect(root.classList.contains('opens-below')).toBe(false);
  expect(root.style.getPropertyValue('--claudian-zen-menu-height')).toBe('484px');
  dock.destroy();
  host.remove();
});
