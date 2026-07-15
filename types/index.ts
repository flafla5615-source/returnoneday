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

export interface OfflinePromotionBreakdown {
  flyer: number;
  placard: number;
  banner: number;
  partnership: number;
  event: number;
  other: number;
}

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

  // Step 2 - TM & Promotion (new per-channel structure)
  expiringTm?: TmBreakdown;
  expiringTmTotal?: number;
  unregisteredTm?: TmBreakdown;
  unregisteredTmTotal?: number;
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

// ─── Campaign ─────────────────────────────────────────────────────────────────

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
