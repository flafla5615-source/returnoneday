"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  ClipboardListIcon,
  BarChart2Icon,
  AlertCircleIcon,
  SettingsIcon,
  UsersIcon,
  BuildingIcon,
  MegaphoneIcon,
  DownloadIcon,
  FileTextIcon,
  LogOutIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { logOut } from "@/lib/auth";
import { useRouter } from "next/navigation";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  exact?: boolean;
}

function isNavActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const managerNav: NavItem[] = [
  { label: "홈", href: "/manager", icon: <HomeIcon className="w-4 h-4" />, exact: true },
  { label: "일일보고 작성", href: "/manager/report/new", icon: <ClipboardListIcon className="w-4 h-4" /> },
  { label: "보고 내역", href: "/manager/reports", icon: <FileTextIcon className="w-4 h-4" /> },
  { label: "대시보드", href: "/manager/dashboard", icon: <BarChart2Icon className="w-4 h-4" /> },
  { label: "운영 이슈", href: "/manager/issues", icon: <AlertCircleIcon className="w-4 h-4" /> },
  { label: "설정", href: "/manager/settings", icon: <SettingsIcon className="w-4 h-4" /> },
];

const adminNav: NavItem[] = [
  { label: "오늘 현황", href: "/admin", icon: <HomeIcon className="w-4 h-4" />, exact: true },
  { label: "지점 내역", href: "/admin/branches", icon: <BuildingIcon className="w-4 h-4" /> },
  { label: "보고 관리", href: "/admin/reports", icon: <ClipboardListIcon className="w-4 h-4" /> },
  { label: "운영 이슈", href: "/admin/issues", icon: <AlertCircleIcon className="w-4 h-4" /> },
  { label: "캠페인 관리", href: "/admin/campaigns", icon: <MegaphoneIcon className="w-4 h-4" /> },
  { label: "사용자 관리", href: "/admin/users", icon: <UsersIcon className="w-4 h-4" /> },
  { label: "데이터 내보내기", href: "/admin/export", icon: <DownloadIcon className="w-4 h-4" /> },
  { label: "설정", href: "/admin/settings", icon: <SettingsIcon className="w-4 h-4" /> },
];

interface Props {
  role: "branch_manager" | "admin";
  onClose?: () => void;
}

export default function Sidebar({ role, onClose }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useAuth();
  const nav = role === "admin" ? adminNav : managerNav;

  async function handleLogout() {
    await logOut();
    router.push("/login");
  }

  return (
    <aside className="w-56 min-h-screen bg-[#1e3a5f] text-white flex flex-col">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-white/10 flex items-center gap-3">
        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center font-bold text-sm">
          R
        </div>
        <div>
          <p className="text-xs font-bold leading-tight">RETURN LIFE</p>
          <p className="text-[10px] text-white/50 leading-tight">
            {role === "admin" ? "관리자" : "지점장"}
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {nav.map((item) => {
          const active = isNavActive(pathname, item.href, item.exact);
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                active
                  ? "bg-white/10 text-white font-medium"
                  : "text-white/70 hover:text-white hover:bg-white/5"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <p className="text-xs text-white/50 mb-3 truncate">{profile?.name}</p>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-xs text-white/60 hover:text-white transition-colors"
        >
          <LogOutIcon className="w-3.5 h-3.5" />
          로그아웃
        </button>
      </div>
    </aside>
  );
}
