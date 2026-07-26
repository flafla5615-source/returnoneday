import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DailyReport, Promotion, PromotionStatus } from "@/types";

// 프로모션 기본정보(promotions)는 지점별·월별 메타데이터만 담는다.
// 일일 실적은 dailyReports에 저장하고, 월간 수치는 dailyReports를 reportDate로
// 조회해 합산한다 — 월 누적 숫자를 별도 문서에 더하지 않으므로 이중 누적이 없다.

// ── Sanitizers ────────────────────────────────────────────────────────────────

// 0 이상의 정수만 허용. 빈 값/NaN/음수/소수점은 안전하게 보정한다.
export function sanitizeAmount(value: number | null | undefined): number {
  if (value === null || value === undefined || isNaN(value) || !isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function sanitizeNullableAmount(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (isNaN(value) || !isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

export function yearMonthOf(date: string): string {
  return date.slice(0, 7);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export type PromotionInput = {
  branchId: string;
  yearMonth: string;
  name: string;
  startDate: string;
  endDate: string;
  purpose?: string;
  targetAudience?: string;
  benefitDescription?: string;
  productDescription?: string;
  targetInquiryCount?: number | null;
  targetRegistrationCount?: number | null;
  targetSalesAmount?: number | null;
  plannedOnlineBudget?: number | null;
  plannedOfflineBudget?: number | null;
  status: PromotionStatus;
};

function buildPromotionPayload(input: PromotionInput): Record<string, unknown> {
  const plannedOnlineBudget = sanitizeNullableAmount(input.plannedOnlineBudget);
  const plannedOfflineBudget = sanitizeNullableAmount(input.plannedOfflineBudget);
  // 계획 총예산은 항상 온라인 + 오프라인 합계로 계산한다 (직접 입력받지 않음).
  const plannedTotalBudget =
    plannedOnlineBudget === null && plannedOfflineBudget === null
      ? null
      : (plannedOnlineBudget ?? 0) + (plannedOfflineBudget ?? 0);

  return {
    branchId: input.branchId,
    yearMonth: input.yearMonth,
    name: input.name.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    purpose: input.purpose?.trim() ?? "",
    targetAudience: input.targetAudience?.trim() ?? "",
    benefitDescription: input.benefitDescription?.trim() ?? "",
    productDescription: input.productDescription?.trim() ?? "",
    targetInquiryCount: sanitizeNullableAmount(input.targetInquiryCount),
    targetRegistrationCount: sanitizeNullableAmount(input.targetRegistrationCount),
    targetSalesAmount: sanitizeNullableAmount(input.targetSalesAmount),
    plannedOnlineBudget,
    plannedOfflineBudget,
    plannedTotalBudget,
    status: input.status,
  };
}

export async function createPromotion(
  input: PromotionInput,
  createdBy: string
): Promise<string> {
  const ref = doc(collection(db, "promotions"));
  const now = Timestamp.now();
  await setDoc(ref, {
    ...buildPromotionPayload(input),
    id: ref.id,
    createdBy,
    createdAt: now,
    updatedBy: createdBy,
    updatedAt: now,
  });
  return ref.id;
}

export async function updatePromotion(
  id: string,
  input: PromotionInput,
  updatedBy: string
): Promise<void> {
  await updateDoc(doc(db, "promotions", id), {
    ...buildPromotionPayload(input),
    updatedBy,
    updatedAt: Timestamp.now(),
  });
}

export async function updatePromotionStatus(
  id: string,
  status: PromotionStatus,
  updatedBy: string
): Promise<void> {
  await updateDoc(doc(db, "promotions", id), {
    status,
    updatedBy,
    updatedAt: Timestamp.now(),
  });
}

export async function getPromotionById(id: string): Promise<Promotion | null> {
  const snap = await getDoc(doc(db, "promotions", id));
  return snap.exists() ? (snap.data() as Promotion) : null;
}

// ── Queries ───────────────────────────────────────────────────────────────────
// 모든 조회는 equality 필터만 사용하고 정렬은 클라이언트에서 처리한다.
// (Firestore는 equality-only 쿼리를 단일 필드 색인 병합으로 처리하므로 복합 색인이 필요없다.)

function sortPromotions(list: Promotion[]): Promotion[] {
  return list.sort((a, b) =>
    a.startDate !== b.startDate
      ? b.startDate.localeCompare(a.startDate)
      : a.name.localeCompare(b.name, "ko")
  );
}

// admin 전용 — 해당 월 전 지점 프로모션
export async function getPromotionsByMonth(yearMonth: string): Promise<Promotion[]> {
  const snap = await getDocs(
    query(collection(db, "promotions"), where("yearMonth", "==", yearMonth))
  );
  return sortPromotions(snap.docs.map((d) => d.data() as Promotion));
}

// branch_manager 전용 — 본인 지점의 해당 월 프로모션만
export async function getPromotionsByBranchAndMonth(
  branchId: string,
  yearMonth: string
): Promise<Promotion[]> {
  const snap = await getDocs(
    query(
      collection(db, "promotions"),
      where("branchId", "==", branchId),
      where("yearMonth", "==", yearMonth)
    )
  );
  return sortPromotions(snap.docs.map((d) => d.data() as Promotion));
}

export async function getPromotionsByBranches(
  branchIds: string[],
  yearMonth: string
): Promise<Promotion[]> {
  if (branchIds.length === 0) return [];
  const results = await Promise.all(
    branchIds.map((branchId) => getPromotionsByBranchAndMonth(branchId, yearMonth))
  );
  return sortPromotions(results.flat());
}

/**
 * 일일보고에서 선택할 수 있는 프로모션 목록.
 * 지점이 일치하고, 보고일이 기간 안에 있고, status가 active인 것만 반환한다.
 * 프로모션이 월을 걸쳐 있을 수 있으므로 yearMonth로 좁히지 않고 지점+active로 조회한 뒤
 * 날짜 범위는 클라이언트에서 비교한다.
 */
export async function getActivePromotionsForDate(
  branchId: string,
  reportDate: string
): Promise<Promotion[]> {
  const snap = await getDocs(
    query(
      collection(db, "promotions"),
      where("branchId", "==", branchId),
      where("status", "==", "active")
    )
  );
  return sortPromotions(
    snap.docs
      .map((d) => d.data() as Promotion)
      .filter((p) => p.startDate <= reportDate && p.endDate >= reportDate)
  );
}

// admin 대시보드용 — 전 지점 기준 해당 날짜에 진행 중인 프로모션
export async function getActivePromotionsAcrossBranches(
  reportDate: string
): Promise<Promotion[]> {
  const snap = await getDocs(
    query(collection(db, "promotions"), where("status", "==", "active"))
  );
  return sortPromotions(
    snap.docs
      .map((d) => d.data() as Promotion)
      .filter((p) => p.startDate <= reportDate && p.endDate >= reportDate)
  );
}

// ── 월간 실적 집계 (dailyReports 원본 합산) ────────────────────────────────────

export interface PromotionPerformance {
  onlineCost: number;
  offlineCost: number;
  totalCost: number;
  inquiryCount: number;
  visitCount: number;
  registrationCount: number;
  salesAmount: number;
  reportCount: number; // 집계에 포함된 일일보고 수
}

export const EMPTY_PROMOTION_PERFORMANCE: PromotionPerformance = {
  onlineCost: 0,
  offlineCost: 0,
  totalCost: 0,
  inquiryCount: 0,
  visitCount: 0,
  registrationCount: 0,
  salesAmount: 0,
  reportCount: 0,
};

/**
 * 일일보고 목록을 합산해 프로모션 실적을 만든다.
 * 같은 날짜 보고서는 문서 1개(branchId_reportDate)뿐이므로 중복 누적이 발생하지 않는다.
 */
export function aggregatePromotionPerformance(reports: DailyReport[]): PromotionPerformance {
  return reports.reduce<PromotionPerformance>(
    (acc, r) => ({
      onlineCost: acc.onlineCost + sanitizeAmount(r.onlinePromotionCost),
      offlineCost: acc.offlineCost + sanitizeAmount(r.offlinePromotionCost),
      totalCost: acc.totalCost + sanitizeAmount(r.totalPromotionCost),
      inquiryCount: acc.inquiryCount + sanitizeAmount(r.promotionInquiryCount),
      visitCount: acc.visitCount + sanitizeAmount(r.promotionVisitCount),
      registrationCount: acc.registrationCount + sanitizeAmount(r.promotionRegistrationCount),
      salesAmount: acc.salesAmount + sanitizeAmount(r.promotionSalesAmount),
      reportCount: acc.reportCount + 1,
    }),
    { ...EMPTY_PROMOTION_PERFORMANCE }
  );
}

// 특정 프로모션에 연결된 보고서만 골라 합산
export function aggregatePerformanceForPromotion(
  reports: DailyReport[],
  promotionId: string
): PromotionPerformance {
  return aggregatePromotionPerformance(reports.filter((r) => r.promotionId === promotionId));
}

// ── 성과 지표 (분모 0이면 null → 화면에서 "-") ──────────────────────────────────

export function registrationConversionRate(p: PromotionPerformance): number | null {
  if (p.inquiryCount === 0) return null;
  return (p.registrationCount / p.inquiryCount) * 100;
}

export function costPerRegistration(p: PromotionPerformance): number | null {
  if (p.registrationCount === 0) return null;
  return p.totalCost / p.registrationCount;
}

export function returnOnAdSpend(p: PromotionPerformance): number | null {
  if (p.totalCost === 0) return null;
  return p.salesAmount / p.totalCost;
}
