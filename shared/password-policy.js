// Username and password rules, written in plain JavaScript (no TypeScript,
// no dependencies) so the same file is used by the React app, the Worker and
// the Node command-line script scripts/owner.mjs on any supported Node version.
// Types live in password-policy.d.ts. Re-exported from shared/auth.ts.

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Returns a list of problems with a proposed new password (empty = acceptable).
 * Length matters far more than character classes, so the rule is a 12+
 * character passphrase that is not trivially guessable.
 */
export function passwordProblems(password, username) {
  const problems = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Use at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (password.trim() !== password) {
    problems.push("Don't start or end with a space");
  }
  if (password.length > 0 && new Set(password).size < 4) {
    problems.push("Use more variety — too many repeated characters");
  }
  if (username && username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
    problems.push("Don't include your username");
  }
  return problems;
}
