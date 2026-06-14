import { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

const variants = {
  primary: "bg-primary text-white hover:bg-primary-dark",
  secondary: "bg-surface text-body border border-border hover:bg-border",
  ghost: "text-muted hover:text-ink hover:bg-surface",
  danger: "bg-danger text-white hover:bg-red-700",
};

const sizes = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2.5 text-sm",
};

export default function Button({ variant = "primary", size = "md", className = "", children, ...props }: Props) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}
