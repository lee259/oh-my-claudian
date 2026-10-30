/** @jest-environment jsdom */
import * as obsidian from 'obsidian';

import { fetchHermesLatestRelease, hermesCliMetadata } from '@/providers/hermes/runtime/HermesCliLifecycle';

describe('Hermes CLI lifecycle', () => {
  it('reads the latest official release and uses the native updater', async () => {
    jest.spyOn(obsidian, 'requestUrl').mockResolvedValueOnce({ status: 200, json: { tag_name: 'v0.22.5' } } as never);
    await expect(fetchHermesLatestRelease()).resolves.toBe('0.22.5');
    expect(hermesCliMetadata.update).toEqual({ command: 'hermes', args: ['update', '--yes'] });
  });

  it('does not invent a version when the release response is invalid', async () => {
    jest.spyOn(obsidian, 'requestUrl').mockResolvedValueOnce({ status: 200, json: { tag_name: 'latest' } } as never);
    await expect(fetchHermesLatestRelease()).resolves.toBeNull();
  });
});
