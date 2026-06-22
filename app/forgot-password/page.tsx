"use client";

import { useState } from "react";
import Link from "next/link";
import { resetPassword } from "@/lib/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await resetPassword(email);
      setSent(true);
    } catch {
      setError("이메일 전송에 실패했습니다. 올바른 이메일인지 확인해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="text-center mb-6">
          <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center mx-auto mb-3 text-lg font-black text-white">R</div>
          <h2 className="text-xl font-bold text-gray-900">비밀번호 찾기</h2>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-green-600 text-xl">✓</span>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              <strong>{email}</strong>으로 비밀번호 재설정 이메일을 보냈습니다.
            </p>
            <Link href="/login" className="text-red-600 text-sm font-medium hover:underline">
              로그인으로 돌아가기
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-500">가입하신 이메일을 입력하시면 비밀번호 재설정 링크를 보내드립니다.</p>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="example@email.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <button type="submit" disabled={loading} className="w-full py-3 bg-red-600 text-white rounded-lg font-semibold text-sm hover:bg-red-700 transition-colors disabled:opacity-50">
              {loading ? "전송 중..." : "재설정 이메일 보내기"}
            </button>
            <div className="text-center">
              <Link href="/login" className="text-sm text-gray-500 hover:underline">로그인으로 돌아가기</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
