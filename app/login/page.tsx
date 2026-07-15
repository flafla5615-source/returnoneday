"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "lucide-react";
import type { User } from "firebase/auth";
import { signIn, getUserProfile, logOut } from "@/lib/auth";

const schema = z.object({
  email: z.string().email("올바른 이메일을 입력해주세요"),
  password: z.string().min(6, "비밀번호는 6자 이상이어야 합니다"),
  remember: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

// Firebase Auth 에러 코드 → 사용자 친화적 메시지
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth/invalid-credential":  "이메일 또는 비밀번호가 올바르지 않습니다.",
  "auth/user-not-found":      "등록되지 않은 계정입니다.",
  "auth/wrong-password":      "비밀번호가 올바르지 않습니다.",
  "auth/invalid-email":       "이메일 형식이 올바르지 않습니다.",
  "auth/too-many-requests":   "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.",
  "auth/user-disabled":       "비활성화된 계정입니다. 관리자에게 문의해주세요.",
  "auth/unauthorized-domain":  "현재 접속한 주소가 Firebase 로그인 승인 도메인에 등록되어 있지 않습니다.",
  "auth/network-request-failed": "네트워크 연결 문제로 로그인 요청을 완료하지 못했습니다.",
  "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Firebase API 키 설정이 올바르지 않습니다.",
  "auth/operation-not-supported-in-this-environment": "현재 브라우저 환경에서 Firebase 로그인을 실행할 수 없습니다.",
  "permission-denied":        "로그인은 성공했지만 사용자 권한 정보를 읽을 수 없습니다.",
};

function getFirebaseErrorMessage(error: unknown): string {
  const code = (error as { code?: string }).code ?? "";
  if (process.env.NODE_ENV === "development") {
    console.error("[Firebase Error]", code, (error as Error).message);
  }
  return AUTH_ERROR_MESSAGES[code] ?? `로그인 중 오류가 발생했습니다.${code ? ` (${code})` : ""}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    setLoading(true);
    setAuthError("");

    // ── Step 1: Firebase Auth 로그인 ────────────────────────────────────────
    let user!: User;
    try {
      user = await signIn(data.email, data.password);
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
      setLoading(false);
      return;
    }

    // ── Step 2: Firestore 프로필 조회 및 라우팅 ───────────────────────────
    try {
      const profile = await getUserProfile(user.uid);

      if (!profile) {
        // Auth 계정은 있지만 Firestore users 문서가 없는 경우
        await logOut();
        setAuthError("계정은 존재하지만 관리자 승인이 완료되지 않았습니다.");
        return;
      }

      if (profile.status === "pending") {
        router.push("/pending");
        return;
      }
      if (profile.status === "suspended") {
        await logOut();
        setAuthError("계정이 정지되었습니다. 관리자에게 문의해주세요.");
        return;
      }
      if (profile.role === "admin") {
        router.push("/admin");
      } else {
        router.push("/manager");
      }
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      if (process.env.NODE_ENV === "development") {
        console.error("[Profile Error]", code, (error as Error).message);
      }
      setAuthError(
        AUTH_ERROR_MESSAGES[code] ??
        `사용자 정보를 불러오는 중 오류가 발생했습니다.${code ? ` (${code})` : ""}`
      );
      await logOut();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex w-1/2 bg-[#1e3a5f] flex-col items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1e3a5f] to-[#0f2540]" />
        <div className="relative z-10 text-center text-white">
          <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6 text-2xl font-black">
            R
          </div>
          <h1 className="text-3xl font-black mb-2 tracking-tight">RETURN LIFE</h1>
          <p className="text-lg font-medium text-white/80 mb-4">지점 일일 업무 보고 시스템</p>
          <p className="text-sm text-white/50 max-w-xs leading-relaxed">
            지점의 현황을 한눈에 파악하고
            <br />
            빠르게 보고하세요.
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center mx-auto mb-3 text-xl font-black text-white">
              R
            </div>
            <h1 className="text-xl font-black text-gray-900">RETURN LIFE</h1>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-6">로그인</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <div className="relative">
                <MailIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  {...register("email")}
                  type="email"
                  placeholder="이메일을 입력하세요"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <div className="relative">
                <LockIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  {...register("password")}
                  type={showPw ? "text" : "password"}
                  placeholder="비밀번호를 입력하세요"
                  className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? "비밀번호 숨기기" : "비밀번호 보기"}
                  className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-gray-400"
                >
                  {showPw ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="min-h-[44px] flex items-center gap-2 py-2 pr-2 text-sm text-gray-600 cursor-pointer">
                <input {...register("remember")} type="checkbox" className="w-4 h-4 rounded" />
                로그인 상태 유지
              </label>
              <Link href="/forgot-password" className="min-h-[44px] inline-flex items-center text-sm text-red-600 hover:underline">
                비밀번호 찾기
              </Link>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              지점 운영계정 비밀번호 변경은 본사 관리자에게 요청해주세요.
            </p>

            {authError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{authError}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-red-600 text-white rounded-lg font-semibold text-sm hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            계정이 없으신가요?{" "}
            <Link href="/signup" className="min-h-[44px] inline-flex items-center text-red-600 font-medium hover:underline">
              관리자에게 문의하세요.
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
