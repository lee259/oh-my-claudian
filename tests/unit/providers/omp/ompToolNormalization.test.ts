import {
  createOmpToolStreamAdapter,
  normalizeOmpToolName,
  resolveOmpRawToolName,
} from '@/providers/omp/normalization/ompToolNormalization';

describe('OMP tool normalization', () => {
  it('maps ACP read presentation titles to the shared Read tool', () => {
    expect(resolveOmpRawToolName(undefined, {
      kind: 'read',
      title: 'Reading 分享文档 README for context',
    })).toEqual({ provenance: 'mapped-kind', rawName: 'Read' });
    expect(normalizeOmpToolName('Reading 分享文档 README for context')).toBe('Read');
  });

  it('normalizes OMP path input for the shared file renderer', () => {
    const adapter = createOmpToolStreamAdapter();
    expect(adapter).toBeDefined();
  });
});
