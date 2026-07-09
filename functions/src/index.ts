import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";

admin.initializeApp();
const db = admin.firestore();

// ─── 지점 운영계정 생성 (admin 전용) ─────────────────────────────────────────
// 비밀번호는 어디에도 저장하지 않는다. Auth 계정만 만들고,
// 비밀번호 설정은 클라이언트에서 재설정 메일 발송으로 처리한다.

interface CreateAccountInput {
  branchId: string;
  branchName: string;
  email: string;
}

interface CreateAccountResult {
  branchId: string;
  uid?: string;
  createdAuth?: boolean;
  ok: boolean;
  error?: string;
}

export const createBranchAccounts = onCall(
  { region: "asia-northeast3", timeoutSeconds: 300, memory: "256MiB" },
  async (request): Promise<{ results: CreateAccountResult[] }> => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    const callerSnap = await db.doc(`users/${callerUid}`).get();
    const caller = callerSnap.data();
    if (!callerSnap.exists || caller?.role !== "admin" || caller?.status !== "active") {
      throw new HttpsError("permission-denied", "관리자만 실행할 수 있습니다.");
    }

    const branches = request.data?.branches as CreateAccountInput[] | undefined;
    if (!Array.isArray(branches) || branches.length === 0) {
      throw new HttpsError("invalid-argument", "생성할 지점 목록이 비어 있습니다.");
    }
    if (branches.length > 60) {
      throw new HttpsError("invalid-argument", "한 번에 최대 60개 지점까지 처리할 수 있습니다.");
    }

    const results: CreateAccountResult[] = [];

    for (const b of branches) {
      const branchId = String(b?.branchId ?? "").trim();
      try {
        const email = String(b?.email ?? "").trim().toLowerCase();
        const branchName = String(b?.branchName ?? "").trim();
        if (!branchId || !branchName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          results.push({ branchId, ok: false, error: "입력값이 올바르지 않습니다" });
          continue;
        }

        const branchRef = db.doc(`branches/${branchId}`);
        const branchSnap = await branchRef.get();
        if (!branchSnap.exists) {
          results.push({ branchId, ok: false, error: "지점 문서가 없습니다" });
          continue;
        }

        // 1) Firebase Auth — 같은 이메일이 있으면 재사용, 없으면 생성 (비밀번호 미지정)
        let uid: string;
        let createdAuth = false;
        try {
          const existing = await admin.auth().getUserByEmail(email);
          uid = existing.uid;
        } catch {
          const created = await admin.auth().createUser({
            email,
            displayName: branchName,
            emailVerified: false,
          });
          uid = created.uid;
          createdAuth = true;
        }

        // 2) users/{uid} 생성 또는 업데이트 (admin 계정은 강등하지 않음)
        const userRef = db.doc(`users/${uid}`);
        const userSnap = await userRef.get();
        const now = admin.firestore.FieldValue.serverTimestamp();

        if (userSnap.exists) {
          const u = userSnap.data()!;
          if (u.role === "admin") {
            results.push({
              branchId,
              uid,
              ok: false,
              error: "해당 이메일은 admin 계정입니다 — 운영계정으로 사용할 수 없습니다",
            });
            continue;
          }
          await userRef.update({
            role: "branch_manager",
            status: "active",
            branchIds: admin.firestore.FieldValue.arrayUnion(branchId),
            updatedAt: now,
          });
        } else {
          await userRef.set({
            uid,
            name: branchName,
            email,
            role: "branch_manager",
            status: "active",
            branchIds: [branchId],
            createdAt: now,
            updatedAt: now,
          });
        }

        // 3) branches/{branchId}.managerUids 연결 (arrayUnion — 중복 추가 없음)
        await branchRef.update({
          managerUids: admin.firestore.FieldValue.arrayUnion(uid),
          updatedAt: now,
        });

        results.push({ branchId, uid, createdAuth, ok: true });
      } catch (e) {
        results.push({ branchId, ok: false, error: (e as Error).message });
      }
    }

    return { results };
  }
);

// ─── KakaoTalk i-builder v2 types ─────────────────────────────────────────────
interface KakaoRequestBody {
  userRequest?: { utterance?: string };
}
interface KakaoResponse {
  version: "2.0";
  template: { outputs: Array<{ simpleText: { text: string } }> };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function simpleText(text: string): KakaoResponse {
  return { version: "2.0", template: { outputs: [{ simpleText: { text } }] } };
}

function nowKST(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function todayKST(): string {
  return nowKST().toISOString().slice(0, 10);
}

function yesterdayKST(): string {
  const d = nowKST();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function fmt(v: number | null | undefined, unit: string): string {
  return v !== null && v !== undefined ? `${v}${unit}` : "-";
}

function ptRate(c: number | null | undefined, r: number | null | undefined): string {
  if (!c || !r) return "-";
  return `${Math.round((r / c) * 100)}%`;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  submitted: "제출 완료 ✅",
  revision_required: "수정 요청 ⚠️",
  locked: "잠금 🔒",
};

const SEVERITY_LABEL: Record<string, string> = {
  low: "낮음", medium: "중간", high: "높음", critical: "긴급 🚨",
};

const ISSUE_TYPE_LABEL: Record<string, string> = {
  claim: "클레임", staff: "인력", facility: "시설",
};

// ─── Intent detection ─────────────────────────────────────────────────────────
type Intent =
  | "help"
  | "allSummary"
  | "reportStatus"
  | "campaigns"
  | "trend"
  | "issues"
  | "tm"
  | "yesterday"
  | "today";

function detectIntent(u: string): Intent {
  const s = u.toLowerCase().replace(/\s/g, "");
  if (/(도움말|사용법|명령어|help)/.test(s)) return "help";
  if (/(전체현황|전체요약|전지점요약|모든지점|전지점)/.test(s)) return "allSummary";
  if (/(보고현황|제출현황|오늘보고현황|보고상태)/.test(s)) return "reportStatus";
  if (/(추이|트렌드|7일|주간)/.test(s)) return "trend";
  if (/(이슈|클레임)/.test(s)) return "issues";
  if (/(tm|티엠)/.test(s)) return "tm";
  if (/캠페인/.test(s)) return "campaigns";
  if (/어제/.test(s)) return "yesterday";
  return "today";
}

// ─── Branch matching ──────────────────────────────────────────────────────────
type BranchDoc = admin.firestore.QueryDocumentSnapshot;

function matchBranch(docs: BranchDoc[], query: string): BranchDoc | null {
  const q = query.trim();
  if (!q) return null;
  const exact = docs.find((d) => (d.data().name as string) === q);
  if (exact) return exact;
  const partial = docs
    .filter((d) => {
      const name = d.data().name as string;
      return name.includes(q) || q.includes(name);
    })
    .sort((a, b) => (b.data().name as string).length - (a.data().name as string).length);
  return partial[0] ?? null;
}

function extractBranchQuery(utterance: string): string {
  return utterance
    .replace(/(대시보드|현황|보고서|오늘|어제|실적|조회|알려줘|보여줘|추이|트렌드|7일|주간|이슈|클레임|TM|tm|티엠|캠페인)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Firestore data types ─────────────────────────────────────────────────────
interface TmBreakdown {
  phone: number;
  sms: number;
  kakao: number;
  other: number;
}

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
  expiringTm?: TmBreakdown;
  expiringTmTotal?: number;
  unregisteredTm?: TmBreakdown;
  unregisteredTmTotal?: number;
  offlinePromotionTotal?: number;
}

// ─── Shared dashboard formatter ───────────────────────────────────────────────
function formatDashboard(branchName: string, report: ReportData, dayLabel?: string): string {
  const today = todayKST();
  const dateLabel = dayLabel ?? (report.reportDate === today ? "오늘" : report.reportDate);
  const status = STATUS_LABEL[report.status] ?? report.status;
  const tmTotal = (report.expiringTmTotal ?? 0) + (report.unregisteredTmTotal ?? 0);
  const promoTotal = report.offlinePromotionTotal ?? 0;

  const lines = [
    `📊 ${branchName} ${dateLabel} 실적`,
    `📅 ${report.reportDate} · ${status}`,
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
  if (tmTotal > 0) lines.push(``, `📱 TM 총합   ${tmTotal}건`);
  if (promoTotal > 0) lines.push(`📣 홍보 총합 ${promoTotal}개`);
  return lines.join("\n");
}

// ─── Handler: 도움말 ─────────────────────────────────────────────────────────
function handleHelp(): string {
  return [
    `📱 리턴라이프 챗봇 사용법`,
    ``,
    `🔹 오늘 대시보드`,
    `   {지점명} 대시보드`,
    `   예) 어반요가 대시보드`,
    ``,
    `🔹 어제 실적`,
    `   {지점명} 어제`,
    `   예) 어반요가 어제`,
    ``,
    `🔹 7일 추이`,
    `   {지점명} 추이`,
    `   예) 어반요가 추이`,
    ``,
    `🔹 TM 상세 현황`,
    `   {지점명} TM`,
    `   예) 어반요가 TM`,
    ``,
    `🔹 운영 이슈 조회`,
    `   {지점명} 이슈`,
    `   예) 어반요가 이슈`,
    ``,
    `🔹 전 지점 오늘 요약`,
    `   전체 현황`,
    ``,
    `🔹 보고 제출 현황`,
    `   보고 현황`,
    ``,
    `🔹 캠페인 현황`,
    `   캠페인 현황`,
    `   {지점명} 캠페인`,
    ``,
    `🔹 이 도움말`,
    `   도움말`,
  ].join("\n");
}

// ─── Handler: 전 지점 보고 현황 ──────────────────────────────────────────────
async function handleReportStatus(): Promise<string> {
  const today = todayKST();
  const branchesSnap = await db.collection("branches").where("active", "==", true).get();
  if (branchesSnap.empty) return "등록된 활성 지점이 없습니다.";

  const branches = branchesSnap.docs;
  const refs = branches.map((b) => db.doc(`dailyReports/${b.id}_${today}`));
  const reportDocs = await db.getAll(...refs);

  const done: string[] = [];
  const inProgress: string[] = [];
  const none: string[] = [];

  branches.forEach((b, i) => {
    const name = b.data().name as string;
    const rd = reportDocs[i];
    const st = rd.exists ? (rd.data()?.status as string) : null;
    if (st === "submitted" || st === "locked") {
      done.push(`✅ ${name}`);
    } else if (st === "draft" || st === "revision_required") {
      inProgress.push(`🔄 ${name} (${STATUS_LABEL[st] ?? st})`);
    } else {
      none.push(`❌ ${name}`);
    }
  });

  const lines = [
    `📋 ${today} 보고 제출 현황`,
    ``,
    ...done,
    ...inProgress,
    ...none,
    ``,
    `제출 완료 ${done.length}  /  전체 ${branches.length}개 지점`,
  ];
  return lines.join("\n");
}

// ─── Handler: 전 지점 오늘 요약 ──────────────────────────────────────────────
async function handleAllSummary(): Promise<string> {
  const today = todayKST();
  const branchesSnap = await db.collection("branches").where("active", "==", true).get();
  if (branchesSnap.empty) return "등록된 활성 지점이 없습니다.";

  const branches = branchesSnap.docs;
  const refs = branches.map((b) => db.doc(`dailyReports/${b.id}_${today}`));
  const reportDocs = await db.getAll(...refs);

  const lines = [`🏢 전 지점 오늘 요약`, `📅 ${today} 기준`, ``];

  branches.forEach((b, i) => {
    const name = b.data().name as string;
    const rd = reportDocs[i];
    if (rd.exists) {
      const r = rd.data() as ReportData;
      const icon = r.status === "submitted" ? "✅" : r.status === "draft" ? "🔄" : "⚠️";
      const members = r.activeMembers !== null ? `${r.activeMembers}명` : "-";
      const conv = ptRate(r.ptConsultations, r.ptRegistrations);
      lines.push(`${icon} ${name}`);
      lines.push(`   유효 ${members} · 전환율 ${conv}`);
    } else {
      lines.push(`❌ ${name}`);
      lines.push(`   미제출`);
    }
  });

  return lines.join("\n");
}

// ─── Handler: 7일 추이 ───────────────────────────────────────────────────────
async function handleTrend(branchId: string, branchName: string): Promise<string> {
  const snap = await db.collection("dailyReports")
    .where("branchId", "==", branchId)
    .orderBy("reportDate", "desc")
    .limit(7)
    .get();

  if (snap.empty) return `${branchName}\n\n최근 7일 보고 데이터가 없습니다.`;

  const lines = [`📈 ${branchName} 7일 추이`, ``];

  snap.docs
    .slice()
    .reverse()
    .forEach((d) => {
      const r = d.data() as ReportData;
      const date = r.reportDate.slice(5);
      const members = r.activeMembers !== null ? `${r.activeMembers}명` : " -  ";
      const conv = ptRate(r.ptConsultations, r.ptRegistrations);
      const icon = r.status === "submitted" ? "✅" : r.status === "draft" ? "🔄" : "❌";
      lines.push(`${icon} ${date}  유효 ${members} · 전환율 ${conv}`);
    });

  return lines.join("\n");
}

// ─── Handler: 운영 이슈 조회 ─────────────────────────────────────────────────
async function handleIssues(branchId: string, branchName: string): Promise<string> {
  const snap = await db.collection("issues").where("branchId", "==", branchId).get();
  const open = snap.docs.filter((d) =>
    ["open", "in_progress"].includes(d.data().status as string)
  );

  const lines = [`⚠️ ${branchName} 운영 이슈`, ``];

  if (open.length === 0) {
    lines.push("현재 미해결 이슈가 없습니다 👍");
    return lines.join("\n");
  }

  open.forEach((d) => {
    const iss = d.data();
    const type = ISSUE_TYPE_LABEL[iss.type as string] ?? (iss.type as string);
    const sev = SEVERITY_LABEL[iss.severity as string] ?? (iss.severity as string);
    const st = iss.status === "in_progress" ? "처리 중" : "미해결";
    lines.push(`[${type} · ${sev} · ${st}]`);
    lines.push(`${iss.description as string}`);
    if (iss.category) lines.push(`카테고리: ${iss.category as string}`);
    lines.push(``);
  });

  return lines.join("\n").trimEnd();
}

// ─── Handler: TM 상세 현황 ───────────────────────────────────────────────────
async function handleTm(branchId: string, branchName: string): Promise<string> {
  const today = todayKST();
  const doc = await db.doc(`dailyReports/${branchId}_${today}`).get();

  if (!doc.exists) return `${branchName}\n\n오늘 보고서가 없습니다.`;

  const r = doc.data() as ReportData;
  const et = r.expiringTm;
  const ut = r.unregisteredTm;

  const lines = [`📱 ${branchName} TM 현황`, `📅 ${today} 기준`, ``];

  if (et) {
    const sub = et.phone + et.sms + et.kakao + et.other;
    lines.push(`─ 만료·홀드 TM ─`);
    lines.push(`  전화   ${et.phone}건`);
    lines.push(`  문자   ${et.sms}건`);
    lines.push(`  카카오 ${et.kakao}건`);
    lines.push(`  기타   ${et.other}건`);
    lines.push(`  소계   ${sub}건`);
    lines.push(``);
  }

  if (ut) {
    const sub = ut.phone + ut.sms + ut.kakao + ut.other;
    lines.push(`─ 미등록 TM ─`);
    lines.push(`  전화   ${ut.phone}건`);
    lines.push(`  문자   ${ut.sms}건`);
    lines.push(`  카카오 ${ut.kakao}건`);
    lines.push(`  기타   ${ut.other}건`);
    lines.push(`  소계   ${sub}건`);
    lines.push(``);
  }

  if (!et && !ut) {
    lines.push("오늘 TM 데이터가 없습니다.");
    return lines.join("\n");
  }

  const total = (r.expiringTmTotal ?? 0) + (r.unregisteredTmTotal ?? 0);
  lines.push(`전체 TM 합계: ${total}건`);
  return lines.join("\n");
}

// ─── Handler: 캠페인 현황 ────────────────────────────────────────────────────
async function handleCampaigns(branchId?: string, branchName?: string): Promise<string> {
  const baseQuery = db.collection("campaigns").where("status", "==", "active");
  const snap = await baseQuery.get();

  // branchId 필드가 있는 경우 클라이언트 필터링
  let docs = snap.docs;
  if (branchId) {
    const filtered = docs.filter((d) => (d.data().branchId as string | undefined) === branchId);
    if (filtered.length > 0) docs = filtered;
  }

  const prefix = branchName ? `${branchName} ` : "";
  const lines = [`📣 ${prefix}캠페인 현황`, ``];

  if (docs.length === 0) {
    lines.push("현재 진행 중인 캠페인이 없습니다.");
    return lines.join("\n");
  }

  docs.forEach((d) => {
    const c = d.data();
    lines.push(`▶ ${c.name as string}`);
    lines.push(`  기간: ${c.startDate as string} ~ ${c.endDate as string}`);
    lines.push(``);
  });

  return lines.join("\n").trimEnd();
}

// ─── Scheduled: 미제출 지점 이메일 알림 (매일 21:00 KST = 12:00 UTC) ────────
export const dailyMissingReportAlert = onSchedule(
  { schedule: "0 12 * * *", timeZone: "Asia/Seoul", region: "asia-northeast3", timeoutSeconds: 30, memory: "256MiB" },
  async () => {
    const today = todayKST();
    const branchesSnap = await db.collection("branches").where("active", "==", true).get();
    if (branchesSnap.empty) return;

    const branches = branchesSnap.docs;
    const refs = branches.map((b) => db.doc(`dailyReports/${b.id}_${today}`));
    const reportDocs = await db.getAll(...refs);

    const missing: string[] = [];
    branches.forEach((b, i) => {
      const rd = reportDocs[i];
      const status = rd.exists ? (rd.data()?.status as string) : null;
      if (!status || status === "draft" || status === "revision_required") {
        const label = !status ? "미제출" : status === "draft" ? "작성 중" : "수정 요청";
        missing.push(`• ${b.data().name as string} (${label})`);
      }
    });

    if (missing.length === 0) return;

    const adminEmail = process.env.ADMIN_EMAIL;
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASS;

    if (!adminEmail || !gmailUser || !gmailPass) {
      console.warn("이메일 환경변수 미설정 — ADMIN_EMAIL, GMAIL_USER, GMAIL_PASS 확인");
      return;
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });

    const subject = `[RETURN LIFE] ${today} 보고 미제출 알림 — ${missing.length}개 지점`;
    const text = [
      `오늘(${today}) 오후 9시 기준 미제출 또는 미완료 지점입니다.`,
      ``,
      ...missing,
      ``,
      `관리자 대시보드: https://returnlife-five.vercel.app/admin`,
    ].join("\n");

    await transporter.sendMail({ from: gmailUser, to: adminEmail, subject, text });
    console.log(`알림 이메일 발송 완료 → ${adminEmail} (${missing.length}개 지점)`);
  }
);

// ─── Main Cloud Function ──────────────────────────────────────────────────────
export const kakaoDashboard = onRequest(
  { region: "asia-northeast3", timeoutSeconds: 15, memory: "256MiB" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json(simpleText("지원하지 않는 요청 방식입니다."));
      return;
    }

    const body = req.body as KakaoRequestBody;
    const utterance = (body?.userRequest?.utterance ?? "").trim();
    const intent = detectIntent(utterance);

    // ── Global intents (지점명 불필요) ────────────────────────────────────────
    if (intent === "help") {
      res.json(simpleText(handleHelp()));
      return;
    }
    if (intent === "reportStatus") {
      res.json(simpleText(await handleReportStatus()));
      return;
    }
    if (intent === "allSummary") {
      res.json(simpleText(await handleAllSummary()));
      return;
    }

    // ── Campaigns: 지점명 있으면 필터, 없으면 전체 ───────────────────────────
    if (intent === "campaigns") {
      const q = extractBranchQuery(utterance);
      if (q) {
        const bSnap = await db.collection("branches").where("active", "==", true).get();
        const m = matchBranch(bSnap.docs, q);
        res.json(simpleText(await handleCampaigns(m?.id, m?.data().name as string | undefined)));
      } else {
        res.json(simpleText(await handleCampaigns()));
      }
      return;
    }

    // ── Branch-specific intents ───────────────────────────────────────────────
    const branchQuery = extractBranchQuery(utterance);

    const intentHint: Record<string, string> = {
      yesterday: "어제", trend: "추이", issues: "이슈", tm: "TM",
    };

    if (!branchQuery) {
      const example = intentHint[intent] ?? "대시보드";
      res.json(simpleText(
        `지점명을 함께 입력해주세요.\n예) 어반요가 ${example}\n\n"도움말" 을 입력하면 전체 명령어를 볼 수 있습니다.`
      ));
      return;
    }

    const branchesSnap = await db.collection("branches").where("active", "==", true).get();
    const matched = matchBranch(branchesSnap.docs, branchQuery);

    if (!matched) {
      res.json(simpleText(
        `'${branchQuery}' 지점을 찾을 수 없습니다.\n정확한 지점명을 입력해주세요.\n\n"도움말" 을 입력하면 사용법을 볼 수 있습니다.`
      ));
      return;
    }

    const branchId = matched.id;
    const branchName = matched.data().name as string;

    switch (intent) {
      case "yesterday": {
        const ydate = yesterdayKST();
        const doc = await db.doc(`dailyReports/${branchId}_${ydate}`).get();
        if (!doc.exists) {
          res.json(simpleText(`${branchName}\n\n어제(${ydate}) 보고서가 없습니다.`));
          return;
        }
        res.json(simpleText(formatDashboard(branchName, doc.data() as ReportData, "어제")));
        return;
      }

      case "trend":
        res.json(simpleText(await handleTrend(branchId, branchName)));
        return;

      case "issues":
        res.json(simpleText(await handleIssues(branchId, branchName)));
        return;

      case "tm":
        res.json(simpleText(await handleTm(branchId, branchName)));
        return;

      default: {
        // "today" — 오늘 대시보드 (기존)
        const snap = await db.collection("dailyReports")
          .where("branchId", "==", branchId)
          .orderBy("reportDate", "desc")
          .limit(3)
          .get();

        if (snap.empty) {
          res.json(simpleText(`${branchName}\n\n아직 제출된 보고서가 없습니다.`));
          return;
        }

        const best =
          snap.docs.find((d) => d.data().status === "submitted") ?? snap.docs[0];
        res.json(simpleText(formatDashboard(branchName, best.data() as ReportData)));
        return;
      }
    }
  }
);
