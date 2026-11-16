import { isAntigravityAccessFailure } from '@/providers/antigravity/AntigravityErrors';

describe('Antigravity provider errors', () => {
  it('recognizes the licence response agy sends as assistant text', () => {
    expect(isAntigravityAccessFailure(
      '⚠ You do not have a valid license of this product. Please contact your administrator. (#3501)',
    )).toBe(true);
    expect(isAntigravityAccessFailure(
      'Eligibility check failed: Your current account is not eligible for Antigravity, because it is not currently available in your location.',
    )).toBe(true);
    expect(isAntigravityAccessFailure('Reply with exactly OK.')).toBe(false);
  });
});
