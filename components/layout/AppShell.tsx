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
      <div className="hidden md:flex no-print">
        <Sidebar role={role} />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 md:hidden no-print"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed left-0 top-0 bottom-0 z-50 md:hidden no-print">
            <Sidebar role={role} onClose={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 print-page">
        <div className="no-print">
          <Header title={title} onMenuClick={() => setMobileOpen(true)} />
        </div>
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6 overflow-auto">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <div className="no-print">
        <MobileNavigation role={role} />
      </div>
    </div>
  );
}
