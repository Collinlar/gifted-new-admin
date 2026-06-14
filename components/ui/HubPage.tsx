import Link from "next/link";
import { LucideIcon } from "lucide-react";

interface HubItem {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  color: string;
  bg: string;
}

export default function HubPage({ items }: { items: HubItem[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-5 max-w-2xl">
      {items.map(({ href, icon: Icon, title, description, color, bg }) => (
        <Link
          key={href}
          href={href}
          className="bg-white border border-border rounded-xl p-6 flex flex-col items-start gap-4 hover:border-teal hover:shadow-sm transition-all group"
        >
          <div className={`${bg} ${color} p-3 rounded-xl group-hover:scale-105 transition-transform`}>
            <Icon size={22} />
          </div>
          <div>
            <p className="font-semibold text-ink">{title}</p>
            <p className="text-sm text-muted mt-1">{description}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
