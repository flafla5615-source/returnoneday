"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { KeyRoundIcon, LockIcon } from "lucide-react";
import LoadingState from "@/components/common/LoadingState";
import { useAuth } from "@/contexts/AuthContext";
import { changeCurrentUserPassword, logOut } from "@/lib/auth";
import { db } from "@/lib/firebase";

function validatePassword(password: string): string | null {
  if (
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return "비밀번호 조건을 확인해주세요.";
  }
  return null;
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, profile, loading, refreshProfile } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!profile) return;
    if (profile.status === "pending") {
      router.replace("/pending");
      return;
    }
    if (profile.status === "suspended") {
      router.replace("/login");
      return;
    }
    if (profile.role === "admin" || !profile.mustChangePassword) {
      router.replace(profile.role === "admin" ? "/admin" : "/manager");
    }
  }, [loading, profile, router, user]);

  const validationError = useMemo(() => {
    const strength = validatePassword(password);
    if (strength) return strength;
    if (password !== confirm) return "비밀번호가 일치하지 않습니다.";
    return null;
  }, [confirm, password]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (validationError) {
      setError(validationError);
      return;
    }
    if (!user) {
      setError("다시 로그인 후 시도해주세요.");
      return;
    }

    setSaving(true);
    try {
      await changeCurrentUserPassword(password);
      await updateDoc(doc(db, "users", user.uid), {
        mustChangePassword: false,
        updatedAt: serverTimestamp(),
      });
      await refreshProfile();
      router.replace("/manager");
    } catch (err) {
      console.error("[ChangePassword] failed", err);
      const code = (err as { code?: string }).code;
      if (code === "auth/requires-recent-login" || (err as Error).message === "requires-recent-login") {
        setError("다시 로그인 후 시도해주세요.");
      } else {
        setError("비밀번호 조건을 확인해주세요.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await logOut();
    router.push("/login");
  }

  if (loading || !profile) return <LoadingState />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mb-5">
          <KeyRoundIcon className="w-7 h-7 text-red-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">초기 비밀번호 변경</h1>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          보안을 위해 최초 로그인 후 비밀번호를 변경해주세요.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">새 비밀번호</label>
            <div className="relative">
              <LockIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                className="w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">새 비밀번호 확인</label>
            <div className="relative">
              <LockIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                className="w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <p className="text-xs text-gray-400">
            8자 이상, 영문, 숫자, 특수문자를 모두 포함해야 합니다.
          </p>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-red-600 text-white rounded-lg font-semibold text-sm hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? "변경 중..." : "비밀번호 변경"}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            다시 로그인하기
          </button>
        </form>
      </div>
    </div>
  );
}
