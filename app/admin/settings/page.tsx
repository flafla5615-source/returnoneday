"use client";

import { useAuth } from "@/contexts/AuthContext";
import { logOut } from "@/lib/auth";
import { useRouter } from "next/navigation";

export default function AdminSettingsPage() {
  const { profile } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logOut();
    router.push("/login");
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <h1 className="text-base font-bold text-gray-900">설정</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">계정 정보</h2>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">이름</span>
          <span className="text-gray-900 font-medium">{profile?.name}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">이메일</span>
          <span className="text-gray-900">{profile?.email}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">역할</span>
          <span className="text-gray-900">관리자</span>
        </div>
      </div>

      <button
        onClick={handleLogout}
        className="w-full py-3 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
      >
        로그아웃
      </button>
    </div>
  );
}
