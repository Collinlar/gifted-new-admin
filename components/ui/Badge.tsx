type Variant = "teal" | "gold" | "blue" | "red" | "grey";

const styles: Record<Variant, string> = {
  teal: "bg-teal-light text-teal-dark",
  gold: "bg-gold-light text-gold-dark",
  blue: "bg-cobalt-light text-cobalt",
  red: "bg-red-100 text-red-700",
  grey: "bg-surface text-muted",
};

export default function Badge({ label, variant = "grey" }: { label: string; variant?: Variant }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[variant]}`}>
      {label}
    </span>
  );
}
