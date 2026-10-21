import { Timestamp } from "firebase/firestore";

// ─── User ───────────────────────────────────────────────────────────────────

export type UserRole = "branch_manager" | "admin";
export type UserStatus = "pending" | "active" | "suspended";

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  active?: boolean;
  branchIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Branch ─────────────────────────────────────────────────────────────────

export interface Branch {
  id: string;
  name: string;
  brand: string;
  region: string;
  active: boolean;
  managerUids: string[];
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── TM & Promotion Breakdowns ──────────────────────────────────────────────

export interface TmBreakdown {
  phone: number;
  sms: number;
  kakao: number;
  other: number;
}

// Deprecated — 일일보고 2단계에서 입력하던 과거 오프라인 홍보 집계 구조.
// 신규 입력은 4단계 프로모션 관리(offlinePromotionActivities)로 대체되었으나,
// 기존 보고서 문서를 보존·조회하기 위해 타입은 그대로 유지한다.
export interface OfflinePromotionBreakdown {
  flyer: number;
  placard: number;
  banner: number;
  partnership: number;
  event: number;
  other: number;
}

// ─── Promotion (프로모션 관리) ────────────────────────────────────────────────
// 지점별·월별 프로모션 기본정보. 일일 실적은 이 문서가 아니라 dailyReports에 저장하고,
// 월간 수치는 dailyReports를 reportDate 기준으로 조회해 합산한다(이중 누적 방지).

export type PromotionStatus = "preparing" | "active" | "ended" | "stopped";

export const PROMOTION_STATUS_LABEL: Record<PromotionStatus, string> = {
  preparing: "준비 중",
  active: "진행 중",
  ended: "종료",
  stopped: "중단",
};

export interface Promotion {
  id: string;
  branchId: string;
  yearMonth: string; // YYYY-MM
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  purpose?: string;
  targetAudience?: string;
  benefitDescription?: string;
  productDescription?: string;
  targetInquiryCount?: number | null;
  targetRegistrationCount?: number | null;
  targetSalesAmount?: number | null;
  plannedOnlineBudget?: number | null;
  plannedOfflineBudget?: number | null;
  plannedTotalBudget?: number | null; // 온라인 + 오프라인 계획 예산 자동 계산
  status: PromotionStatus;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy?: string;
  updatedAt: Timestamp;
}

// 일일보고 4단계에 기록하는 그날의 온라인 홍보 실행 내역 (행 단위, 같은 채널 중복 허용)
export interface OnlinePromotionActivity {
  channel: string;
  count: number;
  cost: number;
  link?: string;
  memo?: string;
}

// 일일보고 4단계에 기록하는 그날의 오프라인 홍보 실행 내역 (행 단위)
export interface OfflinePromotionActivity {
  type: string;
  quantity: number;
  location?: string;
  cost: number;
  memo?: string;
}

export const ONLINE_PROMOTION_CHANNELS = [
  "네이버 플레이스 소식",
  "네이버 블로그",
  "네이버 검색광고",
  "인스타 피드",
  "인스타 릴스",
  "인스타 스토리",
  "메타 광고",
  "당근 게시물",
  "당근 광고",
  "문자 발송",
  "카카오톡 채널",
  "체험단",
  "인플루언서",
  "지역 커뮤니티",
  "기타",
] as const;

export const OFFLINE_PROMOTION_TYPES = [
  "전단지",
  "현수막",
  "X배너",
  "입간판",
  "센터 내부 포스터",
  "아파트 게시판",
  "엘리베이터 광고",
  "제휴처 홍보",
  "외부 행사",
  "거리 홍보",
  "기타",
] as const;

// ─── Daily Report ────────────────────────────────────────────────────────────

export type ReportStatus = "draft" | "submitted" | "revision_required" | "locked";

export interface DailyReport {
  id: string;
  branchId: string;
  reportDate: string; // YYYY-MM-DD
  writerUid: string;
  status: ReportStatus;

  // Step 1 - Sales
  activeMembers: number | null;
  inquiries: number | null;
  ptConsultations: number | null;
  ptRegistrations: number | null;
  reRegistrations: number | null;
  comebackMembers: number | null;
  happyCalls: number | null;
  newHappyCalls: number | null;
  existingHappyCalls: number | null;

  // Step 2 - TM (per-channel structure)
  expiringTm?: TmBreakdown;
  expiringTmTotal?: number;
  unregisteredTm?: TmBreakdown;
  unregisteredTmTotal?: number;

  // Deprecated — 과거 2단계 "오프라인 홍보 활동" 입력값.
  // 신규 작성 화면에서는 더 이상 입력하지 않지만, 기존 보고서 조회를 위해 보존한다.
  // 절대 삭제하거나 신규 프로모션 필드로 자동 이전하지 않는다.
  offlinePromotion?: OfflinePromotionBreakdown;
  offlinePromotionTotal?: number;
  promotionMemo?: string;

  // Legacy TM & Promotion fields (optional — kept for backward compat)
  expiringTmCount?: number | null;
  expiringTmMethods?: string[];
  unregisteredTmCount?: number | null;
  unregisteredTmMethods?: string[];
  offlinePromotionCount?: number | null;
  offlinePromotionMethods?: string[];

  // Step 4 - 프로모션 관리 (신규). 위 legacy 홍보 필드와 이름이 겹치지 않게 분리했다.
  promotionId?: string;
  promotionName?: string;
  onlinePromotionActivities?: OnlinePromotionActivity[];
  offlinePromotionActivities?: OfflinePromotionActivity[];
  onlinePromotionCost?: number;      // onlinePromotionActivities cost 합계 (자동 계산)
  offlinePromotionCost?: number;     // offlinePromotionActivities cost 합계 (자동 계산)
  totalPromotionCost?: number;       // onlinePromotionCost + offlinePromotionCost (자동 계산)
  promotionInquiryCount?: number | null;
  promotionVisitCount?: number | null;
  promotionRegistrationCount?: number | null;
  promotionSalesAmount?: number | null;
  promotionNote?: string;            // 프로모션 메모
  promotionEvidenceLinks?: string;   // 게시물·광고 링크 (줄바꿈 구분)
  promotionEvidenceMemo?: string;    // 증빙 메모
  hasNoPromotionActivity?: boolean;  // "오늘 프로모션 활동 없음" — 미작성 상태와 구분

  // 실제 입력자 추적 — 운영계정이 지점명 기준이라 개인 식별용으로 선택 입력
  actualWriterName?: string;
  actualWriterMemo?: string;

  // Data provenance
  isTestData?: boolean;
  source?: "manager-input" | "dashboard-seed" | string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  submittedAt?: Timestamp;
  reviewedAt?: Timestamp;
}

// ─── Issue ───────────────────────────────────────────────────────────────────

export type IssueType = "claim" | "staff" | "facility";
export type IssueSeverity = "low" | "medium" | "high" | "critical";
export type IssueStatus = "open" | "in_progress" | "resolved";

export interface Issue {
  id: string;
  reportId: string;
  branchId: string;
  reportDate: string;
  type: IssueType;
  category: string;
  description: string;
  severity: IssueSeverity;
  status: IssueStatus;
  memo?: string;
  resolvedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Branch Monthly Target (지점 월 목표) ─────────────────────────────────────
// 문서 ID: {branchId}_{yearMonth} — 지점·월 조합당 1건만 존재한다.
// 목표를 입력하지 않은 항목은 null로 두고, 화면에서 "목표 미설정"으로 구분한다
// (0으로 저장해 달성률 0%처럼 보이게 하지 않는다).

export interface BranchMonthlyTarget {
  id: string;
  branchId: string;
  yearMonth: string; // YYYY-MM

  targetSalesAmount?: number | null;
  targetNewMembers?: number | null;
  targetRenewals?: number | null;
  targetComebacks?: number | null;
  targetRegistrations?: number | null;
  targetInquiries?: number | null;
  targetPtSalesAmount?: number | null;
  targetTrainerSalesAmount?: number | null;

  createdBy: string;
  createdAt: Timestamp;
  updatedBy?: string;
  updatedAt: Timestamp;
}

// ─── Campaign (deprecated — Promotion으로 대체됨) ──────────────────────────────
// 신규 등록·입력에는 사용하지 않는다. 과거 보고서의 "기존 캠페인 기록"을
// 읽기 전용으로 조회하기 위해서만 유지한다.

export type CampaignStatus = "draft" | "active" | "ended";

export interface MetricDefinition {
  key: string;
  label: string;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  targetBranchIds: string[];
  metricDefinitions: MetricDefinition[];
  status: CampaignStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CampaignResult {
  id: string;
  campaignId: string;
  reportId: string;
  branchId: string;
  reportDate: string;
  metrics: Record<string, number | null>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Report Comment ───────────────────────────────────────────────────────────

export interface ReportComment {
  id: string;
  reportId: string;
  authorUid: string;
  authorName: string;
  content: string;
  type: "revision_request" | "general";
  createdAt: Timestamp;
}

// ─── Derived / UI ────────────────────────────────────────────────────────────

export interface DailyReportWithBranch extends DailyReport {
  branchName: string;
  branchBrand: string;
  writerName: string;
}

export type DateFilter = "7days" | "thisMonth" | "lastMonth" | "custom";

export interface DateRange {
  from: Date;
  to: Date;
}

// ─── Trainer (전사 공용 — 특정 지점 소속 없음) ─────────────────────────────────
// 트레이너는 회사 전체에서 공용으로 사용하는 프로필 1개만 존재한다.
// 지점 정보는 트레이너 프로필이 아니라 TrainerSession(세션 기록)에만 저장한다.

export interface Trainer {
  id: string;
  name: string;
  phoneLast4?: string;              // 동명이인 식별용 — 전화번호 뒤 4자리
  identifierMemo?: string;          // 동명이인 식별용 — 참고 메모
  firstRegisteredBranchId?: string; // 소속이 아니라 최초 등록 지점 참고값 (동명이인 식별용)
  active: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // Deprecated — 더 이상 사용하지 않음. 과거 문서 호환을 위해서만 optional로 남겨둠.
  // 신규 조회·UI에서는 참조 금지 (트레이너는 지점 소속 개념이 없음).
  branchIds?: string[];
}

// ─── Trainer Session (트레이너의 지점·날짜별 세션 기록) ────────────────────────
// 트레이너 자체는 전사 공용이며, 지점 구분은 이 세션 기록에만 존재한다.
// 같은 트레이너가 같은 날 여러 지점의 세션에 동시에 등장할 수 있다.
// 문서 ID: {branchId}_{date}_{trainerId} — 같은 지점·날짜·트레이너 조합은 1건만 존재.

export interface TrainerSession {
  id: string;
  trainerId: string;
  trainerName: string; // 저장 시점 스냅샷 — 이후 트레이너 이름이 바뀌어도 과거 기록은 유지
  branchId: string;
  date: string; // YYYY-MM-DD

  ptSessionCount: number;
  otSessionCount: number;
  groupSessionCount: number;
  otherSessionCount: number;
  totalSessionCount: number; // 자동 계산 (pt + ot + group + other)

  // ── 등록·매출 ──────────────────────────────────────────────────────────────
  // 워크인 = 센터 유입 (센터광고 / 전화 / 방문 / 인스타 / 네이버 등)
  // 개인   = 트레이너 개인 유입 (소개 / 기존회원소개 / 개인SNS / 개인영업 등)
  // 기존 문서에는 이 필드가 없으므로 optional이며, 조회 시 0으로 취급한다.
  // (마이그레이션하지 않는다 — types/index.ts의 legacy 정책과 동일)
  walkInRegistrationCount?: number;
  walkInSalesAmount?: number;
  personalRegistrationCount?: number;
  personalSalesAmount?: number;
  totalRegistrationCount?: number; // 자동 계산 (워크인 + 개인 등록건수)
  totalSalesAmount?: number;       // 자동 계산 (워크인 + 개인 매출)

  memo?: string;

  createdBy: string;
  isTestData?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Manager Invite ──────────────────────────────────────────────────────────

export type ManagerInviteStatus =
  | "email_required"
  | "account_pending"
  | "account_created"
  | "password_pending"
  | "active"
  | "suspended";

export interface ManagerInvite {
  name: string;
  email: string;
  branchIds: string[];
  status: ManagerInviteStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Member CRM ──────────────────────────────────────────────────────────────

export type MemberStatus =
  | "active"
  | "expiring"
  | "expired"
  | "unregistered"
  | "unknown";

export type MemberImportType = "members" | "satisfaction";

export interface Member {
  id: string;
  branchId: string;
  branchName: string;
  name: string;
  phone: string;
  status: MemberStatus;
  startDate?: string;
  endDate?: string;
  lastVisitDate?: string;
  productName?: string;
  managerName?: string;
  memo?: string;
  source: "bodycodi_excel";
  sourceFileName?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type MemberSatisfactionFollowUpStatus =
  | "pending"
  | "in_progress"
  | "done";

export interface MemberSatisfactionSurvey {
  id: string;
  memberId?: string;
  branchId: string;
  branchName: string;
  memberName: string;
  phone: string;
  responseDate?: string;
  score?: number;
  responseText?: string;
  needsFollowUp: boolean;
  followUpStatus: MemberSatisfactionFollowUpStatus;
  memo?: string;
  source: "bodycodi_excel";
  sourceFileName?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MemberImportJob {
  id: string;
  importType: MemberImportType;
  fileName: string;
  uploadedByUid: string;
  uploadedByRole: UserRole;
  branchId?: string;
  branchName?: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  status: "preview" | "imported" | "failed";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── branchShiftReports (지점별 일일보고 — 오전/마감 교대 보고) ─────────────────
// 기존 dailyReports(수치 기반 보고)와는 완전히 별개인 신규 컬렉션이다.
// dailyReports / promotions / KPI 데이터는 그대로 보존하며 이 컬렉션과 섞지 않는다.
//
// Doc ID: {branchId}_{reportDate}_{shift}
//   → 같은 지점·같은 날짜·같은 보고 유형은 문서가 하나뿐이므로 중복 제출이 불가능하다.

export type ShiftType = "morning" | "closing";

export const SHIFT_LABEL: Record<ShiftType, string> = {
  morning: "오전 보고",
  closing: "마감 보고",
};

/** 보고 유형별 제출 기한 (KST, HH:mm) */
export const SHIFT_DEADLINE: Record<ShiftType, string> = {
  morning: "09:30",
  closing: "21:00",
};

export const SHIFT_TYPES: ShiftType[] = ["morning", "closing"];

export type ShiftReportStatus = "draft" | "submitted";

/** 자유형식 본문 최대 길이 — Firestore 문서 크기(1MB) 안에서 수정 이력까지 보관하기 위한 상한 */
export const SHIFT_CONTENT_MAX_LENGTH = 5000;

/** 문서에 보관하는 수정 이력 최대 개수 (초과 시 오래된 것부터 버리고 editCount로 총횟수를 유지) */
export const SHIFT_EDIT_HISTORY_LIMIT = 20;

export interface ShiftReportEdit {
  /**
   * 이 버전이 저장된 서버 시각.
   * Firestore 는 배열 원소에 serverTimestamp() 를 넣을 수 없어서, 수정 시점에
   * 문서에 이미 저장돼 있던 updatedAt(서버 시각)을 그대로 복사해 넣는다.
   * → 기기 시계와 무관하게 정확하다.
   */
  previousVersionAt?: Timestamp;
  /**
   * @deprecated 기기(브라우저) 시각이라 신뢰할 수 없어 더 이상 기록하지 않는다.
   * 이 필드만 있는 기존 문서를 읽기 위해 남겨둔다.
   */
  editedAt?: Timestamp;
  editedByUid: string;
  editedByName: string;
  /** 수정 직전 본문 — 무엇이 바뀌었는지 본사에서 확인할 수 있게 남긴다 */
  previousContent: string;
}

export interface BranchShiftReport {
  id: string;
  branchId: string;
  branchName: string;
  reportDate: string; // YYYY-MM-DD (KST)
  shift: ShiftType;
  content: string; // 자유형식 텍스트
  status: ShiftReportStatus;
  writerUid: string;
  writerName: string;
  /** 제출 시각 (serverTimestamp). 정시/지연은 저장하지 않고 이 값으로 조회 시 계산한다. */
  submittedAt?: Timestamp;
  /** 제출 이후 수정 횟수 (이력 배열이 잘려도 총횟수는 유지된다) */
  editCount: number;
  edits: ShiftReportEdit[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** 제출 현황 — 저장값이 아니라 submittedAt과 기한을 비교해 조회 시 계산한다. */
export type ShiftSubmissionState =
  | "on_time" // 기한 내 제출
  | "late" // 기한 넘겨 제출
  | "draft" // 임시저장만 된 상태
  | "pending" // 아직 기한 전, 미작성
  | "missing"; // 기한이 지났는데 제출 없음

export const SHIFT_SUBMISSION_STATE_LABEL: Record<ShiftSubmissionState, string> = {
  on_time: "정시 제출",
  late: "지연 제출",
  draft: "임시저장",
  pending: "작성 전",
  missing: "미제출",
};

// ─── branchWeeklyReports (주간보고) ──────────────────────────────────────────
// 오전/마감 일일보고(branchShiftReports)와는 별개인 신규 컬렉션이다.
// dailyReports / promotions / KPI 와도 섞지 않는다.
//
// Doc ID: {branchId}_{weekStartDate}
//   → 같은 지점·같은 주차는 문서가 하나뿐이라 중복 생성이 구조적으로 불가능하다.
//
// 제출 마감시간이 아직 없어서 정시/지연 개념이 없다.
// 상태는 "미작성 / 임시저장 / 제출" 세 가지뿐이다.

export type WeeklyReportStatus = "draft" | "submitted";

/** 자유형식 본문 최대 길이 — 수정 이력까지 포함해 Firestore 문서 한도(1MB) 안에 두기 위한 상한 */
export const WEEKLY_CONTENT_MAX_LENGTH = 10000;

/** 문서에 보관하는 수정 이력 최대 개수 (초과 시 오래된 것부터 버리고 총횟수는 editCount로 유지) */
export const WEEKLY_EDIT_HISTORY_LIMIT = 20;

export interface WeeklyReportEdit {
  /**
   * 이 버전이 저장된 서버 시각.
   * Firestore 는 배열 원소에 serverTimestamp() 를 넣을 수 없어서,
   * 수정 시점에 문서에 이미 저장돼 있던 updatedAt(서버 시각)을 복사해 넣는다.
   */
  previousVersionAt?: Timestamp;
  editedByUid: string;
  editedByName: string;
  previousContent: string;
}

export interface BranchWeeklyReport {
  id: string;
  branchId: string;
  branchName: string;
  weekStartDate: string; // YYYY-MM-DD (월요일, KST)
  weekEndDate: string;   // YYYY-MM-DD (일요일, KST)
  content: string;       // 자유형식 텍스트
  status: WeeklyReportStatus;
  /** 최초 제출 시각 (serverTimestamp). 수정해도 바뀌지 않는다. */
  submittedAt?: Timestamp;
  submittedBy?: string;
  submittedByName?: string;
  updatedAt: Timestamp;
  updatedBy: string;
  updatedByName: string;
  createdAt: Timestamp;
  /** 제출 이후 수정 횟수 (이력 배열이 잘려도 총횟수는 유지된다) */
  editCount: number;
  editHistory: WeeklyReportEdit[];
}

/** 주차별 작성 상태 — 저장값이 아니라 문서 상태로 조회 시 판단한다. */
export type WeeklyReportState = "submitted" | "draft" | "none";

export const WEEKLY_STATE_LABEL: Record<WeeklyReportState, string> = {
  submitted: "제출 완료",
  draft: "임시저장",
  none: "미작성",
};
