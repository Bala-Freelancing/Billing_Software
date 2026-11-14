import { useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH, passwordProblems, type AuthUserResponse } from "../../shared/auth";
import { useAuth } from "../auth/useAuth";
import { Alert, Button, PasswordField } from "../components/ui";
import { api, ApiError } from "../lib/api";

type Fields = "currentPassword" | "newPassword" | "confirmPassword";
type FieldErrors = Partial<Record<Fields, string[]>>;

function ChangePasswordForm() {
  const { state, setUser } = useAuth();
  const username = state.status === "authenticated" ? state.user.username : "";
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    setSuccess(false);

    const next: FieldErrors = {};
    if (!currentPassword) next.currentPassword = ["Enter your current password"];
    const problems = passwordProblems(newPassword, username);
    if (problems.length) next.newPassword = problems;
    else if (newPassword === currentPassword) next.newPassword = ["New password must be different from the current one"];
    if (confirmPassword !== newPassword) next.confirmPassword = ["Passwords don't match"];
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      const { user } = await api<AuthUserResponse>("/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setUser(user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields as FieldErrors);
        if (!Object.keys(err.fields).length) setFormError(err.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {success && <Alert tone="success">Password changed. All other devices have been signed out.</Alert>}
      {formError && <Alert tone="error">{formError}</Alert>}
      <PasswordField
        label="Current password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        errors={errors.currentPassword}
      />
      <PasswordField
        label="New password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        errors={errors.newPassword}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easiest to remember, e.g. "blue phone shop since 1998".`}
      />
      <PasswordField
        label="Confirm new password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        errors={errors.confirmPassword}
      />
      <Button type="submit" loading={submitting}>
        Change password
      </Button>
    </form>
  );
}

function SignOutEverywhere() {
  const { logoutAllDevices } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setWorking(true);
    setError(null);
    try {
      await logoutAllDevices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setWorking(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Signs out every phone and computer where this account is signed in, including this one. Use it if a device
        is lost or someone else may know your password.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-slate-800">Sign out of all devices?</span>
          <Button variant="danger" onClick={handleConfirm} loading={working}>
            Yes, sign out everywhere
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={working}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Sign out of all devices
        </Button>
      )}
    </div>
  );
}

export function AccountPage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Account</h1>
        {user && (
          <p className="mt-1 text-sm text-slate-600">
            Signed in as <span className="font-medium text-slate-800">{user.username}</span> ({user.role})
          </p>
        )}
      </div>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Change password</h2>
        <ChangePasswordForm />
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Devices</h2>
        <SignOutEverywhere />
      </section>
    </div>
  );
}
