/** The server's password rule (api-backend/src/lib/auth/password-policy.ts): 12+ characters. */
export const PASSWORD_MIN = 12;
export const PASSWORD_HINT = `At least ${PASSWORD_MIN} characters`;

/** A form's own check before it posts: too short, or the two entries differ. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.trim().length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}
