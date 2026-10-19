"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import AppShell from "@/components/layout/AppShell";
import LoadingState from "@/components/common/LoadingState";
import { isAllowedManagerPath } from "@/lib/managerAccess";

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    if (!profile) return; // 프로필 로딩 대기
    if (profile.status === "pending") { router.replace("/pending"); return; }
    if (profile.status === "suspended") { router.replace("/login"); return; }
    if (profile.role === "admin") { router.replace("/admin"); return; }
    if (!isAllowedManagerPath(pathname)) { router.replace("/manager"); return; }
  }, [user, profile, loading, router, pathname]);

  if (loading || !profile) return <LoadingState />;
  if (profile.status !== "active" || profile.role !== "branch_manager") return null;
  // 리다이렉트가 적용되기 전 한 프레임 동안 숨긴 화면이 보이지 않게 막는다
  if (!isAllowedManagerPath(pathname)) return <LoadingState />;

  return <AppShell role="branch_manager">{children}</AppShell>;
}
