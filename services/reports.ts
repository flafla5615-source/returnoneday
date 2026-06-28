import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DailyReport, ReportStatus, ReportComment } from "@/types";
import { getReportId, isAbnormalSubmittedReport, removeUndefinedDeep } from "@/lib/utils";

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
