"use client";

import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import type { ChatContext } from "@/services/chatContext";
import { cn } from "@/lib/utils";
import { SparklesIcon, SendIcon, XIcon, Loader2Icon } from "lucide-react";

/* ══════════════════════════════════════════════════════════════
   KPI 데이터 어시스턴트 위젯
   ──────────────────────────────────────────────────────────────
   화면에서 이미 조회·계산한 데이터(context)를 그대로 서버로 보내고,
   서버는 그 값만 근거로 답한다. 서버가 Firestore 를 다시 읽지 않으므로
   화면 숫자와 답변 숫자가 어긋나지 않는다.
   ══════════════════════════════════════════════════════════════ */

interface Message {
  role: "user" | "model";
  text: string;
}

const SUGGESTIONS = [
  "매출 상위 3개 지점 알려줘",
  "미제출 지점 어디야?",
  "긴급 이슈 있는 지점 알려줘",
  "트레이너 매출 1위는?",
];

export default function ChatAssistant({
  context,
  disabled,
}: {
  context: ChatContext | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 새 메시지가 오면 아래로 스크롤
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || sending) return;

    setError(null);
    const nextMessages: Message[] = [...messages, { role: "user", text: question }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      // 로그인 토큰을 붙여야 서버가 요청을 받아준다
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        setError("로그인이 만료되었습니다. 새로고침 후 다시 시도해주세요.");
        return;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: nextMessages, context }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok && !data.reply) {
        setError(
          res.status === 401
            ? "인증에 실패했습니다. 다시 로그인해주세요."
            : "답변을 가져오지 못했습니다. 잠시 후 다시 시도해주세요."
        );
        return;
      }

      setMessages((prev) => [...prev, { role: "model", text: data.reply }]);
    } catch (err) {
      console.error("[ChatAssistant] 요청 실패", err);
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSending(false);
    }
  }

  if (disabled) return null;

  return (
    <>
      {/* 플로팅 버튼 */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="데이터 어시스턴트 열기"
          className="no-print fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 flex items-center gap-2 rounded-full bg-[#1e3a5f] px-4 py-3 text-sm font-medium text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
        >
          <SparklesIcon className="h-4 w-4" />
          데이터 질문
        </button>
      )}

      {/* 채팅 패널 */}
      {open && (
        <div className="no-print fixed inset-x-3 bottom-20 z-40 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl md:inset-x-auto md:right-6 md:bottom-6 md:w-[400px] md:max-h-[600px]">
          {/* 헤더 */}
          <div className="flex items-center justify-between border-b border-gray-100 bg-[#1e3a5f] px-4 py-3">
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 text-white" />
              <div>
                <p className="text-sm font-semibold text-white">데이터 어시스턴트</p>
                <p className="text-[11px] text-white/60">
                  {context
                    ? `${context.period.from} ~ ${context.period.to} · ${context.scope}`
                    : "조회된 데이터 없음"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="닫기"
              className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          {/* 대화 */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  지금 화면에 조회된 데이터에 대해 물어보세요. 화면에 없는 기간이나 지점은 답할 수 없습니다.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600 transition-colors hover:bg-gray-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                    m.role === "user"
                      ? "bg-[#1e3a5f] text-white"
                      : "bg-gray-100 text-gray-800"
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl bg-gray-100 px-3 py-2 text-sm text-gray-500">
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                  확인 중...
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>

          {/* 입력 */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-gray-100 px-3 py-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={context ? "데이터에 대해 질문하기" : "먼저 데이터를 조회해주세요"}
              disabled={sending || !context}
              maxLength={1000}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim() || !context}
              aria-label="보내기"
              className="rounded-lg bg-[#1e3a5f] p-2 text-white transition-opacity hover:bg-[#16304f] disabled:opacity-40"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
