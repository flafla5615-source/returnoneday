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

// ─── Trainer ─────────────────────────────────────────────────────────────────

export interface Trainer {
  id: string;
  name: string;
  branchIds: string[];
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Trainer Daily Report ────────────────────────────────────────────────────

export interface TrainerDailyReport {
  id: string;
  branchId: string;
  reportDate: string; // YYYY-MM-DD
  trainerId: string;
  trainerName: string;

  // 수업 세션 수 (금액 관리는 하지 않음)
  ptSessionCount: number;
  otSessionCount: number;
  groupSessionCount: number;
  otherSessionCount: number;
  totalSessionCount: number; // 자동 계산 (pt + ot + group + other)

  memo?: string;

  writerUid: string;
  isTestData?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // Legacy 금액 필드 — 과거 저장 문서와의 호환용. 신규 입력·표시에 사용 금지.
  walkInSales?: number;
  personalSales?: number;
  totalSales?: number;
  classCount?: number;
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
