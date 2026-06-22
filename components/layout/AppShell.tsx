"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";
import MobileNavigation from "./MobileNavigation";
import Header from "./Header";

interface Props {
  role: "branch_manager" | "admin";
  title?: string;
  children: React.ReactNode;
}

export default function AppShell({ role, title, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar role={role} />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed left-0 top-0 bottom-0 z-50 md:hidden">
            <Sidebar role={role} onClose={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6 overflow-auto">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <MobileNavigation role={role} />
    </div>
  );
}
