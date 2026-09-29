import {
  getProviderAdditionalArguments,
  parseProviderAdditionalArguments,
  setProviderAdditionalArguments,
} from '@/core/providers/ProviderAdditionalArguments';

describe('provider additional arguments', () => {
  it('treats each non-empty line as one literal argument', () => {
    expect(parseProviderAdditionalArguments('  --extension\r\n/path with spaces/ext.ts\n\n --verbose '))
      .toEqual(['  --extension', '/path with spaces/ext.ts', ' --verbose ']);
  });

  it('fails closed for missing or malformed per-provider settings', () => {
    expect(getProviderAdditionalArguments({}, 'pi')).toEqual([]);
    expect(getProviderAdditionalArguments({ providerAdditionalArguments: null }, 'pi')).toEqual([]);
    expect(getProviderAdditionalArguments({
      providerAdditionalArguments: { pi: '--extension\n/path/ext.ts', omp: 42 },
    }, 'pi')).toEqual(['--extension', '/path/ext.ts']);
    expect(getProviderAdditionalArguments({
      providerAdditionalArguments: { pi: '--extension\n/path/ext.ts', omp: 42 },
    }, 'omp')).toEqual([]);
  });

  it('updates only one provider and replaces malformed stored maps safely', () => {
    const settings: Record<string, unknown> = {
      providerAdditionalArguments: { pi: '--extension', omp: '--verbose' },
    };
    setProviderAdditionalArguments(settings, 'pi', '--extension\n/path/ext.ts');
    expect(settings.providerAdditionalArguments).toEqual({
      pi: '--extension\n/path/ext.ts', omp: '--verbose',
    });

    const malformed: Record<string, unknown> = { providerAdditionalArguments: 'invalid' };
    setProviderAdditionalArguments(malformed, 'omp', '--verbose');
    expect(malformed.providerAdditionalArguments).toEqual({ omp: '--verbose' });
  });
});
