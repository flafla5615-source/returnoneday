import { NextResponse } from "next/server";
import { verifyFirebaseIdToken } from "@/lib/verifyFirebaseToken";
import { buildSystemPrompt, NO_DATA_REPLY } from "@/lib/chatPrompt";
import { buildContextText, type ChatContext } from "@/services/chatContext";

/* ══════════════════════════════════════════════════════════════
   Gemini 챗봇 API (Next.js Route Handler)
   ──────────────────────────────────────────────────────────────
   ⚠ GEMINI_API_KEY 는 이 파일(서버)에서만 읽는다.
      NEXT_PUBLIC_ 접두사를 붙이면 키가 클라이언트 번들에 그대로 들어가
      브라우저에서 누구나 볼 수 있게 된다. 절대 붙이지 않는다.

   Firebase Functions 가 아니라 Route Handler 로 만든 이유:
   Functions 는 previewTrainerImport 의 미설정 시크릿 때문에 배포가 막혀 있는데,
   Route Handler 는 Vercel 에 앱과 함께 배포되므로 그 블로커를 타지 않는다.
   ══════════════════════════════════════════════════════════════ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** 모델명은 환경변수로 교체 가능. 사용 가능한 모델은 scripts/list-gemini-models.mjs 로 확인한다. */
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const MAX_HISTORY_TURNS = 12;
const MAX_MESSAGE_LENGTH = 1000;

interface ChatMessage {
  role: "user" | "model";
  text: string;
}

/** 대화 기록을 Gemini 형식으로 정리 + 검증 */
function normalizeMessages(input: unknown): { role: string; parts: { text: string }[] }[] | null {
  if (!Array.isArray(input)) return null;

  const cleaned = input
    .filter(
      (m): m is ChatMessage =>
        !!m && typeof m === "object" && typeof (m as ChatMessage).text === "string" && !!(m as ChatMessage).text.trim()
    )
    .map((m) => ({
      role: m.role === "model" ? "model" : "user",
      parts: [{ text: m.text.trim().slice(0, MAX_MESSAGE_LENGTH) }],
    }))
    .slice(-MAX_HISTORY_TURNS);

  if (cleaned.length === 0) return null;
  // Gemini 는 마지막 턴이 user 여야 한다
  if (cleaned[cleaned.length - 1].role !== "user") return null;
  return cleaned;
}

export async function POST(request: Request) {
  // 1) 로그인한 사용자만 허용 — 외부에서 API 할당량을 소모하지 못하게 막는다
  const user = await verifyFirebaseIdToken(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2) 키 확인 (설정 실수는 서버 로그로만, 사용자에게는 일반 문구)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[chat] GEMINI_API_KEY 가 설정되지 않았습니다.");
    return NextResponse.json(
      { error: "not-configured", reply: "챗봇이 아직 설정되지 않았습니다. 관리자에게 문의해주세요." },
      { status: 503 }
    );
  }

  let body: { messages?: unknown; context?: ChatContext };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const contents = normalizeMessages(body.messages);
  if (!contents) {
    return NextResponse.json({ error: "invalid-messages" }, { status: 400 });
  }

  // 3) 컨텍스트는 클라이언트가 "본인 권한으로 조회한" 값이다.
  //    서버가 Firestore 를 직접 읽지 않으므로 사용자보다 넓은 권한을 갖지 않는다.
  if (!body.context) {
    return NextResponse.json({ reply: NO_DATA_REPLY }, { status: 200 });
  }

  let systemPrompt: string;
  try {
    systemPrompt = buildSystemPrompt(buildContextText(body.context));
  } catch (error) {
    console.error("[chat] 컨텍스트 생성 실패", error);
    return NextResponse.json({ error: "invalid-context", reply: NO_DATA_REPLY }, { status: 400 });
  }

  // 4) Gemini 호출
  try {
    const upstream = await fetch(`${GEMINI_ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          // 낮은 온도 = 주어진 숫자에서 벗어난 창작을 줄인다
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 800,
        },
      }),
    });

    if (!upstream.ok) {
      // 응답 본문에 키가 섞여 나갈 수 있으므로 서버 로그에만 남긴다
      const detail = await upstream.text().catch(() => "");
      console.error("[chat] Gemini 오류", upstream.status, detail.slice(0, 500));
      const reply =
        upstream.status === 429
          ? "요청이 많아 잠시 대기가 필요합니다. 잠시 후 다시 시도해주세요."
          : "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
      return NextResponse.json({ error: "upstream", reply }, { status: 502 });
    }

    const data = await upstream.json();
    const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text)
      .filter(Boolean)
      .join("")
      .trim();

    if (!text) {
      console.warn("[chat] 빈 응답", JSON.stringify(data).slice(0, 300));
      return NextResponse.json({ reply: NO_DATA_REPLY }, { status: 200 });
    }

    return NextResponse.json({ reply: text }, { status: 200 });
  } catch (error) {
    console.error("[chat] 처리 실패", error);
    return NextResponse.json(
      { error: "internal", reply: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
