"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getReportById } from "@/services/reports";
import { getIssuesByReport } from "@/services/issues";
import { ReportStatusBadge, SeverityBadge, IssueStatusBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import { formatDate, formatDateTime, calcPtConversionRate, formatPercent } from "@/lib/utils";
import type { DailyReport, Issue } from "@/types";
import { ChevronLeftIcon } from "lucide-react";

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

const issueTypeLabel = (t: Issue["type"]) =>
  t === "claim" ? "클레임" : t === "staff" ? "인력 이슈" : "시설 이슈";

export default function AdminReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const [report, setReport] = useState<DailyReport | null | undefined>(undefined);
  const [issues, setIssues] = useState<Issue[]>([]);

  useEffect(() => {
    if (!reportId) return;
    Promise.all([getReportById(reportId), getIssuesByReport(reportId)]).then(([r, iss]) => {
      setReport(r);
      setIssues(iss);
    });
  }, [reportId]);

  if (report === undefined) return <LoadingState />;
  if (!report) return <div className="p-6 text-gray-500">보고서를 찾을 수 없습니다.</div>;

  const convRate = calcPtConversionRate(report.ptConsultations, report.ptRegistrations);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/reports" className="p-1.5 rounded-lg hover:bg-gray-100">
          <ChevronLeftIcon className="w-5 h-5 text-gray-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-900">{formatDate(report.reportDate)} 보고서</h1>
          <p className="text-xs text-gray-400">{report.branchId}</p>
        </div>
        <ReportStatusBadge status={report.status} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <Row label="보고 날짜" value={formatDate(report.reportDate)} />
        <Row label="제출 시간" value={report.submittedAt ? formatDateTime(report.submittedAt.toDate()) : "-"} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">영업 지표</h2>
        <Row label="유효회원" value={`${report.activeMembers ?? "-"}명`} />
        <Row label="문의수" value={`${report.inquiries ?? "-"}건`} />
        <Row label="PT 신규 상담" value={`${report.ptConsultations ?? "-"}건`} />
        <Row label="PT 전환 등록" value={`${report.ptRegistrations ?? "-"}건`} />
        <Row label="PT 전환율" value={formatPercent(convRate)} />
        <Row label="재등록" value={`${report.reRegistrations ?? "-"}명`} />
        <Row label="컴백회원" value={`${report.comebackMembers ?? "-"}명`} />
        <Row label="전체 해피콜" value={`${report.happyCalls ?? "-"}건`} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">TM·홍보</h2>
        <Row label="만료·홀드 TM" value={`${report.expiringTmCount ?? "-"}명`} />
        <Row label="TM 방식" value={report.expiringTmMethods.join(", ") || "-"} />
        <Row label="미등록 TM" value={`${report.unregisteredTmCount ?? "-"}명`} />
        <Row label="오프라인 홍보" value={`${report.offlinePromotionCount ?? "-"}개`} />
      </div>

      {issues.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">운영 이슈</h2>
          <div className="space-y-3">
            {issues.map((iss) => (
              <div key={iss.id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-600">{issueTypeLabel(iss.type)}</span>
                  <SeverityBadge severity={iss.severity} />
                  <IssueStatusBadge status={iss.status} />
                </div>
                <p className="text-sm text-gray-800">{iss.description}</p>
                {iss.category && <p className="text-xs text-gray-400 mt-0.5">{iss.category}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
