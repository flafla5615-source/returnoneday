"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from "lucide-react";
import { signIn } from "@/lib/auth";
import { getUserProfile } from "@/lib/auth";

const schema = z.object({
  email: z.string().email("올바른 이메일을 입력해주세요"),
  password: z.string().min(6, "비밀번호는 6자 이상이어야 합니다"),
  remember: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

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
    try {
      const user = await signIn(data.email, data.password);
      const profile = await getUserProfile(user.uid);
      if (!profile || profile.status === "pending") {
        router.push("/pending");
      } else if (profile.status === "suspended") {
        setAuthError("계정이 정지되었습니다. 관리자에게 문의해주세요.");
      } else if (profile.role === "admin") {
        router.push("/admin");
      } else {
        router.push("/manager");
      }
    } catch {
      setAuthError("이메일 또는 비밀번호가 올바르지 않습니다.");
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  {showPw ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input {...register("remember")} type="checkbox" className="rounded" />
                로그인 상태 유지
              </label>
              <Link href="/forgot-password" className="text-sm text-red-600 hover:underline">
                비밀번호 찾기
              </Link>
            </div>

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
            <Link href="/signup" className="text-red-600 font-medium hover:underline">
              관리자에게 문의하세요.
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
