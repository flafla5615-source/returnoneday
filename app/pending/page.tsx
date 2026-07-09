"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { logOut } from "@/lib/auth";
import { ClockIcon } from "lucide-react";

export default function PendingPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    if (profile?.status === "active") {
      if (profile.role === "admin") router.replace("/admin");
      else if (profile.mustChangePassword) router.replace("/change-password");
      else router.replace("/manager");
    }
  }, [user, profile, loading, router]);

  async function handleLogout() {
    await logOut();
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <ClockIcon className="w-8 h-8 text-yellow-500" />
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">승인 대기 중</h2>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          관리자 승인 대기 중입니다.
          <br />
          승인 완료 후 서비스를 이용하실 수 있습니다.
        </p>
        <p className="text-xs text-gray-400 mb-6">
          문의: 관리자에게 연락해주세요
        </p>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
