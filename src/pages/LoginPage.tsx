import { useState, type FormEvent } from "react";
import { z } from "zod";
import { loginRequestSchema } from "../../shared/auth";
import { useAuth } from "../auth/useAuth";
import { Alert, Button, PasswordField, TextField } from "../components/ui";
import { ApiError } from "../lib/api";

type FieldErrors = { username?: string[] | undefined; password?: string[] | undefined };

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const parsed = loginRequestSchema.safeParse({ username, password });
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error).fieldErrors;
      setFieldErrors({ username: flat.username, password: flat.password });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data);
      // GuestOnly redirects once the auth state becomes "authenticated".
    } catch (err) {
      setPassword("");
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-wrap bg-[var(--erp-page)]">
      <section className="hidden flex-[1_1_480px] flex-col md:flex gap-10 bg-[#0E1726] px-8 py-10 text-white sm:px-14 sm:py-14">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--erp-blue)] font-bold">SV</span>
          <span className="text-lg font-semibold">Sri Vishnu Communication</span>
        </div>
        <div className="my-auto flex flex-col gap-4">
          <p className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">Billing, stock and credit for your counter</p>
          <p className="max-w-md text-base leading-relaxed text-[#C6CFDC]">Scan a serial, bill the retailer, and know who owes you — all in one place.</p>
        </div>
      </section>

      <div className="flex flex-[1_1_420px] items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <p className="mb-6 text-lg font-semibold text-slate-900 md:hidden">Sri Vishnu Communication</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-600">Use your shop username and password.</p>

          <form
            onSubmit={handleSubmit}
            noValidate
            className="mt-6 space-y-5 rounded-2xl border border-[var(--erp-panel-border)] bg-white p-6"
          >
            {formError && <Alert tone="error">{formError}</Alert>}
            <TextField
              label="Username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              errors={fieldErrors.username}
            />
            <PasswordField
              label="Password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              errors={fieldErrors.password}
            />
            <Button type="submit" loading={submitting} className="w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-6 text-sm text-slate-500">
            Forgot your password? Contact whoever set up this software to reset it.
          </p>
        </div>
      </div>
    </main>
  );
}
