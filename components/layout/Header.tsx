"use client";

import { Menu } from "lucide-react";

interface Props {
  title: string;
  onMenuClick: () => void;
}

export default function Header({ title, onMenuClick }: Props) {
  return (
    <header className="sticky top-0 z-20 bg-card border-b border-border flex items-center gap-3 px-5 h-14 shrink-0">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition-colors"
      >
        <Menu size={20} />
      </button>
      <h1 className="font-semibold text-ink text-sm">{title}</h1>
    </header>
  );
}
