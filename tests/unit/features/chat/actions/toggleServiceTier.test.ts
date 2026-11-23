import { toggleServiceTier } from '@/features/chat/actions/toggleServiceTier';

describe('toggleServiceTier', () => {
  it('persists the active tier when the current tier is inactive', async () => {
    const onServiceTierChange = jest.fn().mockResolvedValue(undefined);

    await expect(toggleServiceTier({
      getSettings: () => ({ serviceTier: 'default' }),
      getUIConfig: () => ({
        getServiceTierToggle: () => ({
          fastValue: 'priority',
          options: [
            { label: 'Standard', value: 'default' },
            { label: 'Fast', value: 'priority' },
          ],
          selectedValue: 'default',
        }),
      }),
      onServiceTierChange,
    })).resolves.toBe(true);

    expect(onServiceTierChange).toHaveBeenCalledWith('priority');
  });

  it('returns false without persisting when the provider has no service-tier toggle', async () => {
    const onServiceTierChange = jest.fn().mockResolvedValue(undefined);

    await expect(toggleServiceTier({
      getSettings: () => ({ serviceTier: 'default' }),
      getUIConfig: () => ({}),
      onServiceTierChange,
    })).resolves.toBe(false);

    expect(onServiceTierChange).not.toHaveBeenCalled();
  });

  it('propagates persistence failures to the invoking surface', async () => {
    const failure = new Error('save failed');

    await expect(toggleServiceTier({
      getSettings: () => ({ serviceTier: 'priority' }),
      getUIConfig: () => ({
        getServiceTierToggle: () => ({
          fastValue: 'priority',
          options: [
            { label: 'Standard', value: 'default' },
            { label: 'Fast', value: 'priority' },
          ],
          selectedValue: 'priority',
        }),
      }),
      onServiceTierChange: jest.fn().mockRejectedValue(failure),
    })).rejects.toBe(failure);
  });

  it('turns any accelerated tier off and uses Fast when turning acceleration back on', async () => {
    const onServiceTierChange = jest.fn().mockResolvedValue(undefined);
    const policy = {
      fastValue: 'fast',
      options: [
        { label: 'Standard', value: 'default' },
        { label: 'Fast', value: 'fast' },
        { label: 'Ultrafast', value: 'ultrafast' },
      ],
      selectedValue: 'ultrafast',
    };
    const context = {
      getUIConfig: () => ({ getServiceTierToggle: () => policy }),
      onServiceTierChange,
    };

    await expect(toggleServiceTier({
      ...context,
      getSettings: () => ({ serviceTier: 'ultrafast' }),
    })).resolves.toBe(true);
    expect(onServiceTierChange).toHaveBeenLastCalledWith('default');

    await expect(toggleServiceTier({
      ...context,
      getSettings: () => ({ serviceTier: 'default' }),
      getUIConfig: () => ({
        getServiceTierToggle: () => ({ ...policy, selectedValue: 'default' }),
      }),
    })).resolves.toBe(true);
    expect(onServiceTierChange).toHaveBeenLastCalledWith('fast');
  });
});
