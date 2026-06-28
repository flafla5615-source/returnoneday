"use client";

import { useState } from "react";

const BRAND = "#c0392b";

type Feature = {
  icon: string;
  title: string;
  desc: string;
  format: string;
  example: string;
  details: string[];
  global?: boolean;
};

const BRANCH_FEATURES: Feature[] = [
  {
    icon: "📊",
    title: "오늘 대시보드",
    desc: "오늘 주요 KPI를 한 번에 확인",
    format: "{지점명} 대시보드",
    example: "어반요가 대시보드",
    details: ["유효회원", "문의수", "PT 상담·등록", "PT 전환율", "재등록", "컴백회원", "해피콜"],
  },
  {
    icon: "📅",
    title: "어제 실적",
    desc: "전일 보고서 조회",
    format: "{지점명} 어제",
    example: "어반요가 어제",
    details: ["오늘과 동일한 지표를 전일 기준으로 조회합니다"],
  },
  {
    icon: "📈",
    title: "7일 추이",
    desc: "최근 7일 유효회원·전환율 흐름",
    format: "{지점명} 추이",
    example: "어반요가 추이",
    details: ["날짜별 유효회원 수", "날짜별 PT 전환율", "제출 여부 표시"],
  },
  {
    icon: "📱",
    title: "TM 상세 현황",
    desc: "채널별 TM 건수 집계",
    format: "{지점명} TM",
    example: "어반요가 TM",
    details: ["전화 / 문자 / 카카오톡 / 기타", "만료·홀드 TM · 미등록 TM 구분", "전체 TM 합계"],
  },
  {
    icon: "⚠️",
    title: "운영 이슈 조회",
    desc: "미해결 이슈 목록 확인",
    format: "{지점명} 이슈",
    example: "어반요가 이슈",
    details: ["클레임 / 인력 / 시설 유형 구분", "중요도 및 처리 상태 표시"],
  },
  {
    icon: "📣",
    title: "캠페인 현황",
    desc: "지점 진행 중 캠페인 확인",
    format: "{지점명} 캠페인",
    example: "어반요가 캠페인",
    details: ["진행 중 캠페인명", "캠페인 기간"],
  },
];

const GLOBAL_FEATURES: Feature[] = [
  {
    icon: "🏢",
    title: "전 지점 오늘 요약",
    desc: "모든 지점의 유효회원·전환율 비교",
    format: "전체 현황",
    example: "전체 현황",
    details: ["전 지점 유효회원 수 한눈에 비교", "PT 전환율 함께 표시"],
    global: true,
  },
  {
    icon: "📋",
    title: "보고 제출 현황",
    desc: "전 지점 오늘 제출 여부 확인",
    format: "보고 현황",
    example: "보고 현황",
    details: ["✅ 제출 완료", "🔄 작성 중", "❌ 미제출"],
    global: true,
  },
  {
    icon: "📣",
    title: "전체 캠페인 현황",
    desc: "진행 중인 모든 캠페인 목록",
    format: "캠페인 현황",
    example: "캠페인 현황",
    details: ["전 지점 활성 캠페인", "캠페인 기간 표시"],
    global: true,
  },
  {
    icon: "❓",
    title: "도움말",
    desc: "전체 명령어 목록 안내",
    format: "도움말",
    example: "도움말",
    details: ["챗봇에서 사용 가능한 모든 명령어를 안내합니다"],
    global: true,
  },
];

function CopyButton({ text }: { text: string }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  function resetStatus() {
    window.setTimeout(() => setCopyStatus("idle"), 1800);
  }

  function fallbackCopy(value: string): boolean {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }

    return copied;
  }

  async function handleCopy() {
    try {
      if (fallbackCopy(text)) {
        setCopyStatus("copied");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyStatus("copied");
      } else if (!fallbackCopy(text)) {
        throw new Error("copy-failed");
      }
    } catch {
      setCopyStatus("failed");
    } finally {
      resetStatus();
    }
  }

  const buttonText =
    copyStatus === "copied"
      ? "✅ 복사됨"
      : copyStatus === "failed"
        ? "복사 실패 · 길게 눌러 복사"
        : `📋 "${text}" 복사`;

  return (
    <button
      onClick={handleCopy}
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        marginTop: 10,
        minHeight: 44,
        padding: "10px 14px",
        background: copyStatus === "copied" ? "#27ae60" : copyStatus === "failed" ? "#7f1d1d" : BRAND,
        color: "#fff",
        border: "none",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        transition: "background .2s",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {buttonText}
    </button>
  );
}

function FeatureCard({ f }: { f: Feature }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e8e8e8",
        borderRadius: 14,
        padding: "18px 18px 16px",
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>{f.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a1a1a" }}>
            {f.title}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "#888" }}>{f.desc}</p>
        </div>
      </div>

      <div
        style={{
          margin: "14px 0 0",
          background: "#f7f7f7",
          borderRadius: 8,
          padding: "10px 14px",
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: "#aaa", fontWeight: 600, letterSpacing: ".04em" }}>
          입력 형식
        </p>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 15,
            fontWeight: 700,
            color: BRAND,
            fontFamily: "monospace",
            wordBreak: "keep-all",
          }}
        >
          {f.format}
        </p>
      </div>

      <ul style={{ margin: "12px 0 0", padding: "0 0 0 18px" }}>
        {f.details.map((d) => (
          <li key={d} style={{ fontSize: 13, color: "#555", marginBottom: 3 }}>
            {d}
          </li>
        ))}
      </ul>

      <CopyButton text={f.example} />
    </div>
  );
}

export default function GuidePage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#f4f4f4",
        fontFamily:
          "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: BRAND,
          padding: "28px 20px 24px",
          color: "#fff",
        }}
      >
        <p style={{ margin: 0, fontSize: 12, opacity: 0.75, fontWeight: 500, letterSpacing: ".06em" }}>
          RETURN LIFE
        </p>
        <h1 style={{ margin: "6px 0 4px", fontSize: 22, fontWeight: 800, lineHeight: 1.3 }}>
          챗봇 사용 가이드
        </h1>
        <p style={{ margin: 0, fontSize: 14, opacity: 0.85, wordBreak: "keep-all" }}>
          카카오 채널 챗봇에서 사용 가능한 명령어를 안내합니다.
          <br />예시 버튼을 탭하면 명령어가 복사됩니다.
        </p>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "20px 16px 40px" }}>

        {/* 사용 방법 tip */}
        <div
          style={{
            background: "#fff8e6",
            border: "1px solid #f0d080",
            borderRadius: 10,
            padding: "12px 14px",
            marginBottom: 20,
            display: "flex",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 18 }}>💡</span>
          <p style={{ margin: 0, fontSize: 13, color: "#7a5c00", wordBreak: "keep-all", lineHeight: 1.6 }}>
            <strong>{"{지점명}"}</strong>은 실제 지점 이름으로 바꿔 입력하세요.
            <br />
            정확한 이름이 아니어도 <strong>부분 입력</strong>으로 인식됩니다.
          </p>
        </div>

        {/* 지점별 조회 섹션 */}
        <div style={{ marginBottom: 6 }}>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 12,
              fontWeight: 700,
              color: "#aaa",
              letterSpacing: ".07em",
            }}
          >
            지점별 조회
          </p>
          {BRANCH_FEATURES.map((f) => (
            <FeatureCard key={f.title} f={f} />
          ))}
        </div>

        {/* 전체 현황 섹션 */}
        <div style={{ marginTop: 8 }}>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 12,
              fontWeight: 700,
              color: "#aaa",
              letterSpacing: ".07em",
            }}
          >
            전체 현황 (지점명 없이 입력)
          </p>
          {GLOBAL_FEATURES.map((f) => (
            <FeatureCard key={f.title} f={f} />
          ))}
        </div>

        {/* 하단 안내 */}
        <div
          style={{
            marginTop: 24,
            padding: "14px 16px",
            background: "#fff",
            border: "1px solid #e8e8e8",
            borderRadius: 12,
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "#333" }}>
            ⚠️ 유의사항
          </p>
          <ul style={{ margin: 0, padding: "0 0 0 18px" }}>
            {[
              "보고서가 제출된 시점부터 데이터가 반영됩니다.",
              "오늘 보고서가 없으면 가장 최근 제출 데이터를 표시합니다.",
              "오류 또는 데이터 문의는 관리자에게 연락해주세요.",
            ].map((t) => (
              <li key={t} style={{ fontSize: 12, color: "#777", marginBottom: 4, lineHeight: 1.6 }}>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <p
          style={{
            textAlign: "center",
            marginTop: 28,
            fontSize: 11,
            color: "#bbb",
          }}
        >
          RETURN LIFE · 전 지점 일일 업무 보고 시스템
        </p>
      </div>
    </div>
  );
}
