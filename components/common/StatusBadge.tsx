import { cn } from "@/lib/utils";
import type { ReportStatus, IssueSeverity, IssueStatus } from "@/types";

const reportStatusMap: Record<ReportStatus, { label: string; className: string }> = {
  draft: { label: "임시저장", className: "bg-gray-100 text-gray-600" },
  submitted: { label: "제출완료", className: "bg-green-100 text-green-700" },
  revision_required: { label: "수정요청", className: "bg-orange-100 text-orange-700" },
  locked: { label: "잠금", className: "bg-gray-200 text-gray-500" },
};

const severityMap: Record<IssueSeverity, { label: string; className: string }> = {
  low: { label: "낮음", className: "bg-blue-100 text-blue-700" },
  medium: { label: "중간", className: "bg-yellow-100 text-yellow-700" },
  high: { label: "높음", className: "bg-orange-100 text-orange-700" },
  critical: { label: "긴급", className: "bg-red-100 text-red-700" },
};

const issueStatusMap: Record<IssueStatus, { label: string; className: string }> = {
  open: { label: "미해결", className: "bg-red-100 text-red-700" },
  in_progress: { label: "처리중", className: "bg-blue-100 text-blue-700" },
  resolved: { label: "해결됨", className: "bg-green-100 text-green-700" },
};

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const cfg = reportStatusMap[status];
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium", cfg.className)}>
      {cfg.label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  const cfg = severityMap[severity];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.className)}>
      {cfg.label}
    </span>
  );
}

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const cfg = issueStatusMap[status];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.className)}>
      {cfg.label}
    </span>
  );
}
