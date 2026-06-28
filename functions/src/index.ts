import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

// ─── KakaoTalk i-builder v2 types ─────────────────────────────────────────

interface KakaoRequestBody {
  userRequest?: {
    utterance?: string;
    user?: { id?: string };
  };
}

interface KakaoResponse {
  version: "2.0";
  template: {
    outputs: Array<
      | { simpleText: { text: string } }
      | { basicCard: { title: string; description: string } }
    >;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function simpleText(text: string): KakaoResponse {
  return { version: "2.0", template: { outputs: [{ simpleText: { text } }] } };
}

function nowKST(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function todayKST(): string {
  return nowKST().toISOString().slice(0, 10);
}

function fmt(v: number | null | undefined, unit: string): string {
  return v !== null && v !== undefined ? `${v}${unit}` : "-";
}

function ptRate(consult: number | null | undefined, reg: number | null | undefined): string {
  if (!consult || !reg) return "-";
  return `${Math.round((reg / consult) * 100)}%`;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  submitted: "제출 완료",
  revision_required: "수정 요청",
  locked: "잠금",
};

// ─── Branch name matching ─────────────────────────────────────────────────
// 유사 매칭: 사용자 입력이 지점명에 포함되거나, 지점명이 사용자 입력에 포함

function matchBranch(
  docs: admin.firestore.QueryDocumentSnapshot[],
  query: string
): admin.firestore.QueryDocumentSnapshot | null {
  const q = query.trim();
  // 1) 완전 일치
  const exact = docs.find((d) => (d.data().name as string) === q);
  if (exact) return exact;
  // 2) 포함 검색 (긴 쪽 → 짧은 쪽 우선)
  const partial = docs
    .filter((d) => {
      const name = d.data().name as string;
      return name.includes(q) || q.includes(name);
    })
    .sort((a, b) => (b.data().name as string).length - (a.data().name as string).length);
  return partial[0] ?? null;
}

// ─── Keyword extraction ───────────────────────────────────────────────────
// "어반요가 대시보드", "어반요가 현황", "어반요가" 모두 → "어반요가"

function extractBranchQuery(utterance: string): string {
  return utterance
    .replace(/대시보드|현황|보고서|오늘|어제|실적|조회|알려줘|보여줘/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Report formatter ─────────────────────────────────────────────────────

interface ReportData {
  branchId: string;
  reportDate: string;
  status: string;
  activeMembers: number | null;
  inquiries: number | null;
  ptConsultations: number | null;
  ptRegistrations: number | null;
  reRegistrations: number | null;
  comebackMembers: number | null;
  happyCalls: number | null;
  expiringTmTotal?: number;
  unregisteredTmTotal?: number;
  offlinePromotionTotal?: number;
}

function formatReport(branchName: string, report: ReportData): string {
  const today = todayKST();
  const dateLabel = report.reportDate === today ? "오늘" : report.reportDate;
  const status = STATUS_LABEL[report.status] ?? report.status;

  const tmTotal = (report.expiringTmTotal ?? 0) + (report.unregisteredTmTotal ?? 0);
  const promoTotal = report.offlinePromotionTotal ?? 0;

  const lines: string[] = [
    `📊 ${branchName} 대시보드`,
    `📅 ${dateLabel} 기준 · ${status}`,
    ``,
    `👥 유효회원  ${fmt(report.activeMembers, "명")}`,
    `📋 문의      ${fmt(report.inquiries, "건")}`,
    `💬 PT 상담   ${fmt(report.ptConsultations, "건")}`,
    `✍️ PT 등록   ${fmt(report.ptRegistrations, "건")}`,
    `📈 전환율    ${ptRate(report.ptConsultations, report.ptRegistrations)}`,
    `🔄 재등록    ${fmt(report.reRegistrations, "명")}`,
    `🏃 컴백      ${fmt(report.comebackMembers, "명")}`,
    `📞 해피콜    ${fmt(report.happyCalls, "건")}`,
  ];

  if (tmTotal > 0) {
    lines.push(``, `📱 TM 총합   ${tmTotal}건`);
  }
  if (promoTotal > 0) {
    lines.push(`📣 홍보 총합 ${promoTotal}개`);
  }

  return lines.join("\n");
}

// ─── Main function ────────────────────────────────────────────────────────

export const kakaoDashboard = onRequest(
  {
    region: "asia-northeast3", // 서울 리전
    timeoutSeconds: 10,
    memory: "256MiB",
  },
  async (req, res) => {
    // 카카오 오픈빌더는 POST로만 호출
    if (req.method !== "POST") {
      res.status(405).json(simpleText("지원하지 않는 요청 방식입니다."));
      return;
    }

    const body = req.body as KakaoRequestBody;
    const utterance = (body?.userRequest?.utterance ?? "").trim();

    const branchQuery = extractBranchQuery(utterance);

    if (!branchQuery) {
      res.json(
        simpleText(
          "조회할 지점명을 입력해주세요.\n\n예) 어반요가 대시보드\n예) 우아필라테스 현황"
        )
      );
      return;
    }

    // 활성 지점 목록 조회
    const branchesSnap = await db
      .collection("branches")
      .where("active", "==", true)
      .get();

    const matched = matchBranch(branchesSnap.docs, branchQuery);

    if (!matched) {
      res.json(
        simpleText(
          `'${branchQuery}' 지점을 찾을 수 없습니다.\n정확한 지점명을 입력해주세요.`
        )
      );
      return;
    }

    const branchId = matched.id;
    const branchName = matched.data().name as string;

    // 가장 최근 보고서 조회 (제출 완료 우선, 없으면 draft)
    const reportsSnap = await db
      .collection("dailyReports")
      .where("branchId", "==", branchId)
      .orderBy("reportDate", "desc")
      .limit(3)
      .get();

    if (reportsSnap.empty) {
      res.json(simpleText(`${branchName}\n\n아직 제출된 보고서가 없습니다.`));
      return;
    }

    // submitted 우선 선택, 없으면 첫 번째
    const best =
      reportsSnap.docs.find((d) => d.data().status === "submitted") ??
      reportsSnap.docs[0];

    const report = best.data() as ReportData;
    res.json(simpleText(formatReport(branchName, report)));
  }
);
