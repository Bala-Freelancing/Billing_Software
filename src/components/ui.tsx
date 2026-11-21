import type React from "react";
import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { groupFor } from "../lib/nav";

type ButtonVariant = "primary" | "secondary" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-[var(--erp-blue)] text-white shadow-sm hover:bg-[var(--erp-blue-dark)] focus-visible:outline-[var(--erp-blue)]",
  secondary:
    "bg-white text-[var(--erp-blue-dark)] ring-1 ring-inset ring-[var(--erp-blue)] hover:bg-[var(--erp-row-hover)] focus-visible:outline-[var(--erp-blue)]",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export function Button({ variant = "primary", loading = false, disabled, className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-semibold transition active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${buttonStyles[variant]} ${className}`}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  errors?: string[] | undefined;
  hint?: ReactNode;
}

export function TextField({ label, errors, hint, className = "", ...rest }: FieldProps) {
  const id = useId();
  const describedBy = errors?.length ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[13px] text-slate-600">
        {label}
        {rest.required && <span className="ml-0.5 text-[var(--erp-blue)]" aria-hidden="true">*</span>}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1 block w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-[15px] text-slate-900 ring-1 ring-inset placeholder:text-slate-400 read-only:bg-[var(--erp-readonly)] disabled:bg-[var(--erp-readonly)] focus:ring-2 focus:ring-inset ${
          errors?.length ? "ring-red-400 focus:ring-red-600" : "ring-[var(--erp-field-border)] focus:ring-[var(--erp-blue)]"
        }`}
      />
      <FieldMessages id={id} errors={errors} hint={hint} />
    </div>
  );
}

export function PasswordField({ label, errors, hint, className = "", ...rest }: FieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const describedBy = errors?.length ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[13px] text-slate-600">
        {label}
        {rest.required && <span className="ml-0.5 text-[var(--erp-blue)]" aria-hidden="true">*</span>}
      </label>
      <div className="relative mt-1">
        <input
          {...rest}
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={errors?.length ? true : undefined}
          aria-describedby={describedBy}
          className={`block w-full rounded-md border-0 py-1.5 pl-2.5 pr-16 text-[15px] text-slate-900 ring-1 ring-inset focus:ring-2 focus:ring-inset ${
            errors?.length ? "ring-red-400 focus:ring-red-600" : "ring-[var(--erp-field-border)] focus:ring-[var(--erp-blue)]"
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-slate-600 hover:text-slate-900"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      <FieldMessages id={id} errors={errors} hint={hint} />
    </div>
  );
}

function FieldMessages({ id, errors, hint }: { id: string; errors?: string[] | undefined; hint?: ReactNode }) {
  if (errors?.length) {
    return (
      <ul id={`${id}-error`} className="mt-1.5 space-y-0.5 text-sm text-red-700">
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    );
  }
  if (hint) {
    return (
      <p id={`${id}-hint`} className="mt-1.5 text-sm text-slate-500">
        {hint}
      </p>
    );
  }
  return null;
}

export function Alert({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "bg-red-50 text-red-800 ring-red-200",
    success: "bg-green-50 text-green-800 ring-green-200",
    info: "bg-blue-50 text-blue-800 ring-blue-200",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg px-4 py-3 text-sm ring-1 ring-inset ${styles}`}>
      {children}
    </div>
  );
}

export function FullPageMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-6">{children}</div>;
}

interface SelectFieldProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  errors?: string[] | undefined;
  hint?: ReactNode;
  children: ReactNode;
}

export function SelectField({ label, errors, hint, className = "", children, ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[13px] text-slate-600">
        {label}
        {rest.required && <span className="ml-0.5 text-[var(--erp-blue)]" aria-hidden="true">*</span>}
      </label>
      <select
        {...rest}
        id={id}
        aria-invalid={errors?.length ? true : undefined}
        className={`mt-1 block w-full rounded-md border-0 bg-white px-2 py-1.5 text-[15px] text-slate-900 ring-1 ring-inset disabled:bg-[var(--erp-readonly)] focus:ring-2 focus:ring-inset ${
          errors?.length ? "ring-red-400 focus:ring-red-600" : "ring-[var(--erp-field-border)] focus:ring-[var(--erp-blue)]"
        }`}
      >
        {children}
      </select>
      <FieldMessages id={id} errors={errors} hint={hint} />
    </div>
  );
}

export function CheckboxField({
  label,
  description,
  checked,
  onChange,
  errors,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  errors?: string[] | undefined;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[var(--erp-blue)]"
        />
        <label htmlFor={id} className="text-sm">
          <span className="font-medium text-slate-800">{label}</span>
          {description && <span className="block text-slate-500">{description}</span>}
        </label>
      </div>
      <FieldMessages id={id} errors={errors} />
    </div>
  );
}

/**
 * Title strip, as in the previous software: title with the page's quick
 * actions beside it, the breadcrumb on the right, a blue edge on both sides.
 */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const { pathname } = useLocation();
  const group = groupFor(pathname);
  return (
    <div className="mb-4">
      <div className="erp-panel flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-x-4 border-x-[var(--erp-blue)] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-lg font-bold text-slate-900">{title}</h1>
          {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
        </div>
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm print:hidden">
          <Link to="/" aria-label="Dashboard" className="text-[var(--erp-blue)] hover:text-[var(--erp-blue-dark)]">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true"><path d="M12 3l10 9h-3v9h-5v-6h-4v6H5v-9H2z" /></svg>
          </Link>
          {group && (
            <>
              <span className="text-slate-400">›</span>
              <span className="italic text-[var(--erp-blue)]">{group.title}</span>
            </>
          )}
          <span className="text-slate-400">›</span>
          <span className="font-semibold italic text-slate-900">{title}</span>
        </nav>
      </div>
      {subtitle && <div className="mt-2 px-1 text-sm text-slate-600">{subtitle}</div>}
    </div>
  );
}

export function Badge({ tone = "slate", children }: { tone?: "slate" | "green" | "amber" | "red" | "blue"; children: ReactNode }) {
  const styles = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-[var(--erp-blue)] text-white",
  }[tone];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${styles}`}>{children}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`erp-panel p-5 ${className}`}>{children}</section>;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
