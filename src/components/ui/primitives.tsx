"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "lime";
  size?: "sm" | "md" | "lg";
}) {
  const styles = {
    primary: "bg-forest-900 text-white hover:bg-forest-800",
    secondary: "bg-white text-forest-900 border border-forest-900/15 hover:bg-cream",
    ghost: "bg-transparent text-forest-900 hover:bg-forest-900/5",
    danger: "bg-danger text-white hover:bg-red-700",
    lime: "bg-lime-500 text-forest-950 hover:bg-lime-400",
  }[variant];

  const sizeStyles = {
    sm: "px-3 py-1.5 text-xs min-h-9",
    md: "px-5 py-2.5 text-base min-h-12",
    lg: "px-6 py-3 text-lg min-h-14",
  }[size];

  return (
    <button
      className={cn(
        "touch-target inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition disabled:opacity-50",
        styles,
        sizeStyles,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-semibold text-forest-900">
      {label}
      {children}
      {error ? <span className="text-sm font-medium text-danger">{error}</span> : null}
    </label>
  );
}

const inputClass =
  "touch-target w-full rounded-2xl border border-forest-900/15 bg-white px-4 text-base font-medium text-ink outline-none focus:border-lime-ring focus:ring-4 focus:ring-lime-400/30";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, props.className)} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputClass, props.className)} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, "min-h-24 py-3", props.className)} {...props} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("card-shadow rounded-3xl bg-paper p-5", className)}>{children}</section>;
}

export function EmptyState({
  title,
  hint,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  hint?: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-forest-900/20 bg-white/70 px-6 py-12 text-center">
      {Icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-forest-900/5 text-forest-800">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <p className="text-lg font-bold text-forest-900">{title}</p>
      {(description || hint) && <p className="mt-2 text-sm text-muted max-w-sm">{description || hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
