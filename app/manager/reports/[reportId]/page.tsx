"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getReportById } from "@/services/reports";
import { ReportStatusBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import { formatDate, formatDateTime, formatPercent, calcPtConversionRate } from "@/lib/utils";
import type { DailyReport } from "@/types";
import { ChevronLeftIcon } from "lucide-react";

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

export default function ReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const [report, setReport] = useState<DailyReport | null | undefined>(undefined);

  useEffect(() => {
    if (!reportId) return;
    getReportById(reportId).then(setReport);
  }, [reportId]);

  if (report === undefined) return <LoadingState />;
  if (!report) return <EmptyState title="보고서를 찾을 수 없습니다" />;

  const convRate = calcPtConversionRate(report.ptConsultations, report.ptRegistrations);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/manager/reports" className="p-1.5 rounded-lg hover:bg-gray-100">
          <ChevronLeftIcon className="w-5 h-5 text-gray-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-900">{formatDate(report.reportDate)} 보고서</h1>
        </div>
        <ReportStatusBadge status={report.status} />
      </div>

      {/* Timestamps */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <Row label="작성일" value={formatDate(report.reportDate)} />
        <Row label="제출 시간" value={report.submittedAt ? formatDateTime(report.submittedAt.toDate()) : "-"} />
        <Row label="마지막 수정" value={formatDateTime(report.updatedAt.toDate())} />
      </div>

      {/* Sales */}
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
        <Row label="신규 해피콜" value={`${report.newHappyCalls ?? "-"}명`} />
        <Row label="기존 해피콜" value={`${report.existingHappyCalls ?? "-"}명`} />
      </div>

      {/* TM */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">TM·홍보 활동</h2>
        <Row label="만료·홀드 TM" value={`${report.expiringTmCount ?? "-"}명`} />
        <Row label="TM 방식" value={report.expiringTmMethods.join(", ") || "-"} />
        <Row label="미등록 TM" value={`${report.unregisteredTmCount ?? "-"}명`} />
        <Row label="미등록 TM 방식" value={report.unregisteredTmMethods.join(", ") || "-"} />
        <Row label="오프라인 홍보" value={`${report.offlinePromotionCount ?? "-"}개`} />
        <Row label="홍보 방식" value={report.offlinePromotionMethods.join(", ") || "-"} />
        {report.promotionMemo && <Row label="홍보 메모" value={report.promotionMemo} />}
      </div>

      {report.status === "revision_required" && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <p className="text-sm font-medium text-orange-700 mb-1">수정 요청</p>
          <p className="text-sm text-orange-600">관리자가 수정을 요청했습니다. 보고서를 수정해주세요.</p>
          <Link
            href="/manager/report/new"
            className="mt-2 inline-block px-4 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700"
          >
            수정하기
          </Link>
        </div>
      )}
    </div>
  );
}
