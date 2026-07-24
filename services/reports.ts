import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DailyReport, ReportStatus, ReportComment, Issue, CampaignResult } from "@/types";
import { getReportId, isAbnormalSubmittedReport, removeUndefinedDeep } from "@/lib/utils";
import { trainerSessionId, getTrainerSessionsByBranchAndDate } from "@/services/trainerSessions";

export async function getReport(
  branchId: string,
  date: string
): Promise<DailyReport | null> {
  const id = getReportId(branchId, date);
  const snap = await getDoc(doc(db, "dailyReports", id));
  return snap.exists() ? (snap.data() as DailyReport) : null;
}

export async function getReportById(
  reportId: string
): Promise<DailyReport | null> {
  const snap = await getDoc(doc(db, "dailyReports", reportId));
  return snap.exists() ? (snap.data() as DailyReport) : null;
}

/**
 * 일일보고 생성 또는 업데이트.
 * - 문서 ID: {branchId}_{YYYY-MM-DD}
 * - 미입력 필드는 null, 실적 없음은 0 (절대 기본값 0 주입 금지)
 * - locked 상태인 경우 Error('locked') throw → UI에서 처리
 * - submittedAt, updatedAt은 serverTimestamp 사용
 */
export async function upsertReport(
  branchId: string,
  date: string,
  writerUid: string,
  data: Partial<DailyReport>,
  status: ReportStatus = "draft"
): Promise<string> {
  if (!branchId) throw new Error("branchId is missing");
  if (!writerUid) throw new Error("writerUid is missing");
  if (!date) throw new Error("reportDate is missing");

  const id = getReportId(branchId, date);
  const ref = doc(db, "dailyReports", id);
  const existing = await getDoc(ref);

  const cleanData = removeUndefinedDeep(data);

  console.log("report document id:", id);
  console.log("report payload raw:", cleanData);
  console.log("report payload json:", JSON.stringify(cleanData, null, 2));

  if (existing.exists()) {
    const currentStatus = existing.data().status as ReportStatus;
    if (currentStatus === "locked") {
      throw new Error("locked");
    }

    await updateDoc(ref, {
      ...cleanData,
      status,
      updatedAt: serverTimestamp(),
      ...(status === "submitted" && !existing.data().submittedAt
        ? { submittedAt: serverTimestamp() }
        : {}),
    });
  } else {
    await setDoc(ref, {
      id,
      branchId,
      reportDate: date,
      writerUid,
      status,
      activeMembers: null,
      inquiries: null,
      ptConsultations: null,
      ptRegistrations: null,
      reRegistrations: null,
      comebackMembers: null,
      happyCalls: null,
      newHappyCalls: null,
      existingHappyCalls: null,
      expiringTm: { phone: 0, sms: 0, kakao: 0, other: 0 },
      expiringTmTotal: 0,
      unregisteredTm: { phone: 0, sms: 0, kakao: 0, other: 0 },
      unregisteredTmTotal: 0,
      offlinePromotion: { flyer: 0, placard: 0, banner: 0, partnership: 0, event: 0, other: 0 },
      offlinePromotionTotal: 0,
      ...cleanData,
      isTestData: false,
      source: "manager-input",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(status === "submitted" ? { submittedAt: serverTimestamp() } : {}),
    });
  }

  const savedSnap = await getDoc(ref);
  if (!savedSnap.exists()) {
    throw new Error("저장 후 문서를 확인할 수 없습니다.");
  }
  console.log("saved report:", savedSnap.data());

  return id;
}

export async function getReportsByBranch(
  branchId: string,
  fromDate: string,
  toDate: string
): Promise<DailyReport[]> {
  const snap = await getDocs(
    query(
      collection(db, "dailyReports"),
      where("branchId", "==", branchId),
      where("reportDate", ">=", fromDate),
      where("reportDate", "<=", toDate),
      orderBy("reportDate", "desc")
    )
  );
  return snap.docs.map((d) => d.data() as DailyReport);
}

export async function getRecentReports(
  branchId: string,
  count = 7
): Promise<DailyReport[]> {
  const snap = await getDocs(
    query(
      collection(db, "dailyReports"),
      where("branchId", "==", branchId),
      orderBy("reportDate", "desc"),
      limit(count)
    )
  );
  return snap.docs.map((d) => d.data() as DailyReport);
}

export async function getAllReports(
  fromDate: string,
  toDate: string
): Promise<DailyReport[]> {
  const snap = await getDocs(
    query(
      collection(db, "dailyReports"),
      where("reportDate", ">=", fromDate),
      where("reportDate", "<=", toDate),
      orderBy("reportDate", "desc")
    )
  );
  return snap.docs.map((d) => d.data() as DailyReport);
}

export async function getTodayAllReports(date: string): Promise<DailyReport[]> {
  const snap = await getDocs(
    query(collection(db, "dailyReports"), where("reportDate", "==", date))
  );
  return snap.docs.map((d) => d.data() as DailyReport);
}

/**
 * 관리자 전용: 보고 상태 변경 + 선택적 코멘트 저장
 */
export async function updateReportStatus(
  reportId: string,
  status: ReportStatus,
  adminUid: string,
  adminName: string,
  adminComment?: string
): Promise<void> {
  await updateDoc(doc(db, "dailyReports", reportId), {
    status,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (adminComment) {
    await addReportComment(
      reportId,
      adminUid,
      adminName,
      adminComment,
      "revision_request"
    );
  }
}

export async function reopenAbnormalSubmittedReport(reportId: string): Promise<void> {
  const ref = doc(db, "dailyReports", reportId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("report-not-found");
  }

  const report = snap.data() as DailyReport;
  if (!isAbnormalSubmittedReport(report)) {
    throw new Error("report-is-not-abnormal-submitted");
  }

  await updateDoc(ref, {
    status: "draft",
    updatedAt: serverTimestamp(),
  });
}

export async function addReportComment(
  reportId: string,
  authorUid: string,
  authorName: string,
  content: string,
  type: "revision_request" | "general" = "general"
): Promise<void> {
  const ref = doc(collection(db, "reportComments"));
  const comment: ReportComment = {
    id: ref.id,
    reportId,
    authorUid,
    authorName,
    content,
    type,
    createdAt: Timestamp.now(),
  };
  await setDoc(ref, comment);
}

export async function getReportComments(
  reportId: string
): Promise<ReportComment[]> {
  const snap = await getDocs(
    query(
      collection(db, "reportComments"),
      where("reportId", "==", reportId),
      orderBy("createdAt", "asc")
    )
  );
  return snap.docs.map((d) => d.data() as ReportComment);
}

// ─── 관리자 전용: 잘못 저장된 보고일 이동 ─────────────────────────────────────
// 21일 업무가 22일 문서로 잘못 저장된 사례를 복구하기 위한 기능.
// 새 문서를 만들고 연결 데이터(이슈/캠페인 실적/트레이너 세션)까지 모두 옮긴 뒤,
// 마지막에만 기존 문서를 삭제한다 — 중간에 실패하면 기존 문서는 그대로 남는다.

async function moveIssuesForReport(
  oldReportId: string,
  newReportId: string,
  newReportDate: string
): Promise<number> {
  const snap = await getDocs(collection(db, "dailyReports", oldReportId, "issues"));
  let moved = 0;
  for (const d of snap.docs) {
    const data = { ...(d.data() as Issue), reportId: newReportId, reportDate: newReportDate };
    await setDoc(doc(db, "dailyReports", newReportId, "issues", d.id), data);
    await setDoc(doc(db, "issues", d.id), data);
    await deleteDoc(d.ref);
    moved += 1;
  }
  return moved;
}

async function moveCampaignResultsForReport(
  oldReportId: string,
  newReportId: string,
  newReportDate: string
): Promise<number> {
  const snap = await getDocs(
    query(collection(db, "campaignResults"), where("reportId", "==", oldReportId))
  );
  let moved = 0;
  for (const d of snap.docs) {
    const data = d.data() as CampaignResult;
    const newId = `${data.campaignId}_${newReportId}`;
    await setDoc(doc(db, "campaignResults", newId), {
      ...data,
      id: newId,
      reportId: newReportId,
      reportDate: newReportDate,
    });
    await deleteDoc(d.ref);
    moved += 1;
  }
  return moved;
}

async function moveTrainerSessionsForDate(
  branchId: string,
  oldDate: string,
  newDate: string
): Promise<number> {
  const sessions = await getTrainerSessionsByBranchAndDate(branchId, oldDate);
  let moved = 0;
  for (const s of sessions) {
    const newId = trainerSessionId(branchId, newDate, s.trainerId);
    await setDoc(doc(db, "trainerSessions", newId), { ...s, id: newId, date: newDate });
    await deleteDoc(doc(db, "trainerSessions", s.id));
    moved += 1;
  }
  return moved;
}

async function deleteReportRelatedData(
  reportIdToClear: string,
  branchId: string,
  date: string
): Promise<void> {
  const issuesSnap = await getDocs(collection(db, "dailyReports", reportIdToClear, "issues"));
  for (const d of issuesSnap.docs) {
    await deleteDoc(d.ref);
    await deleteDoc(doc(db, "issues", d.id));
  }
  const campaignSnap = await getDocs(
    query(collection(db, "campaignResults"), where("reportId", "==", reportIdToClear))
  );
  for (const d of campaignSnap.docs) {
    await deleteDoc(d.ref);
  }
  const sessions = await getTrainerSessionsByBranchAndDate(branchId, date);
  for (const s of sessions) {
    await deleteDoc(doc(db, "trainerSessions", s.id));
  }
}

export interface MoveReportDateResult {
  status: "conflict" | "success";
  existingTarget?: DailyReport;
  newReportId?: string;
  movedIssues?: number;
  movedCampaignResults?: number;
  movedTrainerSessions?: number;
}

/**
 * 잘못 저장된 보고일을 이동한다 (admin 전용 — 호출부에서 admin 권한을 확인해야 함).
 * - 대상 날짜에 이미 보고서가 있으면 overwrite=false일 때 자동 덮어쓰기 없이 conflict를 반환한다.
 * - overwrite=true로 재호출하면 대상 보고서와 그 연결 데이터를 먼저 정리한 뒤 이동한다.
 * - 연결 데이터(이슈/캠페인 실적/트레이너 세션) 이전까지 모두 끝난 뒤에만 기존 문서를 삭제한다.
 *   중간 단계에서 예외가 발생하면 기존 문서는 삭제되지 않는다.
 */
export async function moveReportDate(
  reportId: string,
  newDate: string,
  overwrite = false
): Promise<MoveReportDateResult> {
  const oldSnap = await getDoc(doc(db, "dailyReports", reportId));
  if (!oldSnap.exists()) {
    throw new Error("report-not-found");
  }
  const oldReport = oldSnap.data() as DailyReport;

  if (oldReport.reportDate === newDate) {
    throw new Error("same-date");
  }

  const newReportId = getReportId(oldReport.branchId, newDate);
  const targetSnap = await getDoc(doc(db, "dailyReports", newReportId));

  if (targetSnap.exists() && !overwrite) {
    return { status: "conflict", existingTarget: targetSnap.data() as DailyReport };
  }

  if (targetSnap.exists() && overwrite) {
    await deleteReportRelatedData(newReportId, oldReport.branchId, newDate);
    await deleteDoc(doc(db, "dailyReports", newReportId));
  }

  const now = Timestamp.now();
  await setDoc(doc(db, "dailyReports", newReportId), {
    ...oldReport,
    id: newReportId,
    reportDate: newDate,
    updatedAt: now,
  });

  const verifySnap = await getDoc(doc(db, "dailyReports", newReportId));
  if (!verifySnap.exists()) {
    throw new Error("move-failed-new-doc-not-saved");
  }

  const movedIssues = await moveIssuesForReport(reportId, newReportId, newDate);
  const movedCampaignResults = await moveCampaignResultsForReport(reportId, newReportId, newDate);
  const movedTrainerSessions = await moveTrainerSessionsForDate(
    oldReport.branchId,
    oldReport.reportDate,
    newDate
  );

  // 연결 데이터까지 모두 이전된 뒤에만 기존 문서를 삭제한다.
  await deleteDoc(doc(db, "dailyReports", reportId));

  return {
    status: "success",
    newReportId,
    movedIssues,
    movedCampaignResults,
    movedTrainerSessions,
  };
}
