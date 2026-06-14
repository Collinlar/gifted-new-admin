import { InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export default function Input({ label, error, hint, className = "", ...props }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm font-medium text-ink">{label}</label>}
      <input
        {...props}
        className={`w-full rounded-lg border bg-white px-3 py-2.5 text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors ${error ? "border-danger" : "border-border"} ${className}`}
      />
      {hint && !error && <span className="text-xs text-muted">{hint}</span>}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
