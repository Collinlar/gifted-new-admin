interface Props {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}

export default function Card({ title, subtitle, action, children, className = "", padding = true }: Props) {
  return (
    <div className={`bg-card rounded-xl border border-border shadow-card ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            {title && <h2 className="font-semibold text-ink text-sm">{title}</h2>}
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={padding ? "p-5" : ""}>{children}</div>
    </div>
  );
}
