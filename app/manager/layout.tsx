"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import AppShell from "@/components/layout/AppShell";
import LoadingState from "@/components/common/LoadingState";

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    if (!profile) return; // 프로필 로딩 대기
    if (profile.status === "pending") { router.replace("/pending"); return; }
    if (profile.status === "suspended") { router.replace("/login"); return; }
    if (profile.role === "admin") { router.replace("/admin"); return; }
  }, [user, profile, loading, router]);

  if (loading || !profile) return <LoadingState />;
  if (profile.status !== "active" || profile.role !== "branch_manager") return null;

  return <AppShell role="branch_manager">{children}</AppShell>;
}
