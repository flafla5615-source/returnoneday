import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, toZonedTime } from "date-fns-tz";
import type { DailyReport } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const KST = "Asia/Seoul";

export function nowKST(): Date {
  return toZonedTime(new Date(), KST);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(toZonedTime(d, KST), "yyyy.MM.dd", { timeZone: KST });
}

export function formatDateYMD(date: Date): string {
  return format(toZonedTime(date, KST), "yyyy-MM-dd", { timeZone: KST });
}

export function formatDateTime(date: Date): string {
  return format(toZonedTime(date, KST), "yyyy.MM.dd HH:mm", { timeZone: KST });
}

export function formatTime(date: Date): string {
  return format(toZonedTime(date, KST), "HH:mm:ss", { timeZone: KST });
}

export function todayYMD(): string {
  return formatDateYMD(nowKST());
}

export function calcPtConversionRate(
  ptConsultations: number | null,
  ptRegistrations: number | null
): number | null {
  if (ptConsultations === null || ptRegistrations === null) return null;
  if (ptConsultations === 0) return null;
  return (ptRegistrations / ptConsultations) * 100;
}

export function formatPercent(value: number | null): string {
  if (value === null) return "-";
  return `${value.toFixed(1)}%`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString("ko-KR");
}

export function diffLabel(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "";
  const diff = current - previous;
  if (diff > 0) return `▲ ${diff}`;
  if (diff < 0) return `▼ ${Math.abs(diff)}`;
  return "±0";
}

export function getReportId(branchId: string, date: string): string {
  return `${branchId}_${date}`.replaceAll("/", "-");
}

const REQUIRED_REPORT_FIELDS = [
  "activeMembers",
  "inquiries",
  "ptConsultations",
  "ptRegistrations",
  "reRegistrations",
  "comebackMembers",
  "happyCalls",
] as const;

export function isAbnormalSubmittedReport(
  report: Pick<DailyReport, "status" | (typeof REQUIRED_REPORT_FIELDS)[number]> | null | undefined
): boolean {
  return !!report &&
    report.status === "submitted" &&
    REQUIRED_REPORT_FIELDS.every((field) => report[field] === null);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

export function removeUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => removeUndefinedDeep(item)) as T;
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefinedDeep(item)])
    ) as T;
  }
  return value;
}

export function normalizeNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatPhoneNumber(value: unknown): string {
  const digits = normalizePhone(value);
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits || "-";
}

// ─── TM & Promotion aggregation helpers ─────────────────────────────────────

type TmLike = { phone: number; sms: number; kakao: number; other: number };
type PromoLike = { flyer: number; placard: number; banner: number; partnership: number; event: number; other: number };

export function calcTmTotal(tm: TmLike): number {
  return tm.phone + tm.sms + tm.kakao + tm.other;
}

export function calcOfflinePromoTotal(p: PromoLike): number {
  return p.flyer + p.placard + p.banner + p.partnership + p.event + p.other;
}

export function getExpiringTmTotal(r: {
  expiringTm?: TmLike;
  expiringTmTotal?: number;
  expiringTmCount?: number | null;
}): number {
  if (r.expiringTm) return r.expiringTmTotal ?? calcTmTotal(r.expiringTm);
  return r.expiringTmCount ?? 0;
}

export function getUnregisteredTmTotal(r: {
  unregisteredTm?: TmLike;
  unregisteredTmTotal?: number;
  unregisteredTmCount?: number | null;
}): number {
  if (r.unregisteredTm) return r.unregisteredTmTotal ?? calcTmTotal(r.unregisteredTm);
  return r.unregisteredTmCount ?? 0;
}

export function getOfflinePromoTotal(r: {
  offlinePromotion?: PromoLike;
  offlinePromotionTotal?: number;
  offlinePromotionCount?: number | null;
}): number {
  if (r.offlinePromotion) return r.offlinePromotionTotal ?? calcOfflinePromoTotal(r.offlinePromotion);
  return r.offlinePromotionCount ?? 0;
}
