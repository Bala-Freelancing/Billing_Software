// Validation rules and API types shared by the React app and the Worker.
// Keeping them in one place guarantees the browser and server agree.
import { z } from "zod";

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, "Username must be 3–32 characters: letters, numbers, dot, dash or underscore");

// Login accepts any non-empty password up to the max length; the strength
// policy applies only when a password is set, so old passwords keep working.
export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "Enter your password").max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * Returns a list of problems with a proposed new password (empty = acceptable).
 * Length matters far more than character classes, so the rule is a 12+
 * character passphrase that is not trivially guessable.
 */
export function passwordProblems(password: string, username?: string): string[] {
  const problems: string[] = [];
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

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(PASSWORD_MAX_LENGTH),
    newPassword: z.string().max(PASSWORD_MAX_LENGTH),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current one",
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export type Role = "owner" | "staff";

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface AuthUserResponse {
  user: SessionUser;
}

/** Every API error has this shape. `code` is stable; `message` is for people. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    fields?: Record<string, string[]>;
    retryAfterSeconds?: number;
  };
}
