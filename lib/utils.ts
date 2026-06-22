import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, toZonedTime } from "date-fns-tz";

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
  return `${branchId}_${date}`;
}
