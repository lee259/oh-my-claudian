const ACCESS_FAILURE_PATTERN = /(?:do not have a valid license|not licensed|valid license[^\n]*#3501|#3501|eligibility check failed|not eligible for Antigravity|not currently available in your location)/iu;

/** agy reports account, licence, and location eligibility failures as assistant text. */
export function isAntigravityAccessFailure(text: string): boolean {
  return ACCESS_FAILURE_PATTERN.test(text);
}
