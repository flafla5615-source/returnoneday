"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import LoadingState from "@/components/common/LoadingState";

/**
 * 지점 운영계정 비밀번호는 본사 admin이 관리하며, branch_manager는 직접 변경할 수 없다.
 * 이 경로로 직접 접근하면 역할에 맞는 화면으로 돌려보낸다.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    if (!profile) return;
    if (profile.status === "pending") { router.replace("/pending"); return; }
    if (profile.status === "suspended") { router.replace("/login"); return; }
    router.replace(profile.role === "admin" ? "/admin" : "/manager");
  }, [loading, profile, router, user]);

  return <LoadingState text="이동 중..." />;
}
