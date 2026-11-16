// Validation rules and API types shared by the React app and the Worker.
// Keeping them in one place guarantees the browser and server agree.
import { z } from "zod";

import { PASSWORD_MAX_LENGTH, USERNAME_PATTERN } from "./password-policy.js";

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblems, USERNAME_PATTERN } from "./password-policy.js";

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
