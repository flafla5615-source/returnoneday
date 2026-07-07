"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  ClipboardListIcon,
  BarChart2Icon,
  AlertCircleIcon,
  UsersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

function isNavActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const managerMobileNav = [
  { label: "홈", href: "/manager", icon: HomeIcon, exact: true },
  { label: "보고작성", href: "/manager/report/new", icon: ClipboardListIcon },
  { label: "대시보드", href: "/manager/dashboard", icon: BarChart2Icon },
  { label: "회원", href: "/manager/members", icon: UsersIcon },
  { label: "이슈", href: "/manager/issues", icon: AlertCircleIcon },
];

const adminMobileNav = [
  { label: "현황", href: "/admin", icon: HomeIcon, exact: true },
  { label: "보고", href: "/admin/reports", icon: ClipboardListIcon },
  { label: "회원", href: "/admin/members", icon: UsersIcon },
  { label: "이슈", href: "/admin/issues", icon: AlertCircleIcon },
  { label: "사용자", href: "/admin/users", icon: UsersIcon },
];

export default function MobileNavigation({ role }: { role: "branch_manager" | "admin" }) {
  const pathname = usePathname();
  const nav = role === "admin" ? adminMobileNav : managerMobileNav;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#1e3a5f] border-t border-white/10 z-40">
      <div className="flex">
        {nav.map((item) => {
          const active = isNavActive(pathname, item.href, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors",
                active ? "text-white" : "text-white/50"
              )}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
