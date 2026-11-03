import { NativeHistoryGuard } from '@/features/chat/sessions/NativeHistoryGuard';

describe('NativeHistoryGuard', () => {
  it('reloads on the first revision when the transcript was loaded before the revision was observed', async () => {
    const refresh = jest.fn(async () => true);
    const guard = new NativeHistoryGuard(async () => 'external-revision', refresh, true);
    expect(await guard.check()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await guard.check()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not establish the initial revision if the first reload fails', async () => {
    const refresh = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const guard = new NativeHistoryGuard(async () => 'external-revision', refresh, true);
    expect(await guard.check()).toBe(false);
    expect(await guard.check()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('shares a refresh when external history changed and retains stale state after failure', async () => {
    let revision = 'first';
    let permitted = false;
    const refresh = jest.fn(async () => permitted);
    const guard = new NativeHistoryGuard(async () => revision, refresh);
    expect(await guard.check()).toBe(true);
    revision = 'second';
    expect(await guard.check()).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    permitted = true;
    expect(await Promise.all([guard.check(), guard.check()])).toEqual([true, true]);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(await guard.check()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not accept a known history becoming unreadable', async () => {
    let revision: string | null = 'first';
    const refresh = jest.fn(async () => true);
    const guard = new NativeHistoryGuard(async () => revision, refresh);
    expect(await guard.check()).toBe(true);
    revision = null;
    expect(await guard.check()).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reloads instead of adopting a history that appeared after an unknown revision', async () => {
    let revision: string | null = null;
    const refresh = jest.fn(async () => true);
    const guard = new NativeHistoryGuard(async () => revision, refresh);
    expect(await guard.check()).toBe(true);
    revision = 'created';
    expect(await guard.check()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps a revision stale if the transcript changes during refresh', async () => {
    let revision = 'first';
    const guard = new NativeHistoryGuard(async () => revision, async () => { revision = 'third'; return true; });
    expect(await guard.check()).toBe(true);
    revision = 'second';
    expect(await guard.check()).toBe(false);
  });
});
