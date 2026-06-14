"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";

interface Props {
  title: string;
  children: React.ReactNode;
}

export default function DashboardShell({ title, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-auto">
        <Header title={title} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-5 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
