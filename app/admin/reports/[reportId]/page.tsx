"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getReportById, updateReportStatus } from "@/services/reports";
import { getIssuesByReport } from "@/services/issues";
import { getBranchesByIds } from "@/services/branches";
import { ReportStatusBadge, SeverityBadge, IssueStatusBadge } from "@/components/common/StatusBadge";
import PrintButton from "@/components/print/PrintButton";
import PrintHeader from "@/components/print/PrintHeader";
import PrintableSection from "@/components/print/PrintableSection";
import LoadingState from "@/components/common/LoadingState";
import { formatDate, formatDateTime, calcPtConversionRate, formatPercent, getExpiringTmTotal, getUnregisteredTmTotal, getOfflinePromoTotal, isAbnormalSubmittedReport } from "@/lib/utils";
import type { DailyReport, Issue, ReportStatus } from "@/types";
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
  const { profile } = useAuth();
  const [report, setReport] = useState<DailyReport | null | undefined>(undefined);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [branchName, setBranchName] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [comment, setComment] = useState("");
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [printSections, setPrintSections] = useState<string[]>(["report"]);

  useEffect(() => {
    if (!reportId) return;
    Promise.all([getReportById(reportId), getIssuesByReport(reportId)]).then(([r, iss]) => {
      setReport(r);
      setIssues(iss);
      if (r) {
        getBranchesByIds([r.branchId]).then((bs) => setBranchName(bs[0]?.name ?? r.branchId));
      }
    });
  }, [reportId]);

  async function handleAction(newStatus: ReportStatus, adminComment?: string) {
    if (!report || !profile) return;
    setActionLoading(true);
    try {
      await updateReportStatus(report.id, newStatus, profile.uid, profile.name, adminComment);
      setReport((prev) => prev ? { ...prev, status: newStatus } : prev);
      setShowRevisionModal(false);
      setComment("");
    } finally {
      setActionLoading(false);
    }
  }

  if (report === undefined) return <LoadingState />;
  if (!report) return <div className="p-6 text-gray-500">보고서를 찾을 수 없습니다.</div>;

  const convRate = calcPtConversionRate(report.ptConsultations, report.ptRegistrations);
  const isAbnormalSubmitted = isAbnormalSubmittedReport(report);
  const canRequestRevision = report.status === "submitted";
  const canLock = report.status === "submitted" || report.status === "revision_required";
  const canUnlock = report.status === "locked";

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <PrintHeader
        title="지점장 일일보고"
        subtitle={`${branchName || report.branchId} / ${report.reportDate}`}
      />

      <div className="flex items-center gap-3">
        <Link href="/admin/reports" className="p-1.5 rounded-lg hover:bg-gray-100 no-print">
          <ChevronLeftIcon className="w-5 h-5 text-gray-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-900">{formatDate(report.reportDate)} 보고서</h1>
          <p className="text-xs text-gray-400">{branchName || report.branchId}</p>
        </div>
        <PrintButton
          sections={[{ key: "report", label: "보고 상세" }]}
          selectedSections={printSections}
          onSelectionChange={setPrintSections}
        />
        <div className="flex flex-col items-end gap-1">
          <ReportStatusBadge status={report.status} />
          {isAbnormalSubmitted && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              비정상 제출 데이터
            </span>
          )}
        </div>
      </div>

      <PrintableSection sectionKey="report" selectedSections={printSections} className="space-y-4">
      {isAbnormalSubmitted && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          제출 기록은 있으나 주요 데이터가 비어 있습니다. 지점장에게 보고 다시 작성을 안내하세요.
        </div>
      )}

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
        {report.expiringTm ? (
          <>
            <p className="text-xs font-medium text-gray-500 mb-1">만료·홀드 TM</p>
            <div className="grid grid-cols-2 gap-x-4 pl-2 mb-2">
              <Row label="전화" value={`${report.expiringTm.phone}건`} />
              <Row label="문자" value={`${report.expiringTm.sms}건`} />
              <Row label="카카오톡" value={`${report.expiringTm.kakao}건`} />
              <Row label="기타" value={`${report.expiringTm.other}건`} />
            </div>
            <Row label="만료 TM 합계" value={`${getExpiringTmTotal(report)}건`} />
          </>
        ) : (
          <Row label="만료·홀드 TM" value={`${report.expiringTmCount ?? "-"}건`} />
        )}
        {report.unregisteredTm ? (
          <>
            <p className="text-xs font-medium text-gray-500 mt-3 mb-1">미등록 TM</p>
            <div className="grid grid-cols-2 gap-x-4 pl-2 mb-2">
              <Row label="전화" value={`${report.unregisteredTm.phone}건`} />
              <Row label="문자" value={`${report.unregisteredTm.sms}건`} />
              <Row label="카카오톡" value={`${report.unregisteredTm.kakao}건`} />
              <Row label="기타" value={`${report.unregisteredTm.other}건`} />
            </div>
            <Row label="미등록 TM 합계" value={`${getUnregisteredTmTotal(report)}건`} />
          </>
        ) : (
          <Row label="미등록 TM" value={`${report.unregisteredTmCount ?? "-"}건`} />
        )}
        {report.offlinePromotion ? (
          <>
            <p className="text-xs font-medium text-gray-500 mt-3 mb-1">오프라인 홍보</p>
            <div className="grid grid-cols-2 gap-x-4 pl-2 mb-2">
              <Row label="전단지" value={`${report.offlinePromotion.flyer}개`} />
              <Row label="현수막" value={`${report.offlinePromotion.placard}개`} />
              <Row label="배너" value={`${report.offlinePromotion.banner}개`} />
              <Row label="제휴" value={`${report.offlinePromotion.partnership}개`} />
              <Row label="외부 행사" value={`${report.offlinePromotion.event}개`} />
              <Row label="기타" value={`${report.offlinePromotion.other}개`} />
            </div>
            <Row label="홍보 합계" value={`${getOfflinePromoTotal(report)}개`} />
          </>
        ) : (
          <Row label="오프라인 홍보" value={`${report.offlinePromotionCount ?? "-"}개`} />
        )}
        {report.promotionMemo && <Row label="홍보 메모" value={report.promotionMemo} />}
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

      {(canRequestRevision || canLock || canUnlock) && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm no-print">
          <p className="text-sm font-semibold text-gray-800 mb-3">관리자 액션</p>
          <div className="flex flex-wrap gap-2">
            {canRequestRevision && (
              <button
                onClick={() => setShowRevisionModal(true)}
                className="px-4 py-2 text-sm border border-orange-300 text-orange-700 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors"
              >
                수정 요청
              </button>
            )}
            {canLock && (
              <button
                onClick={() => handleAction("locked")}
                disabled={actionLoading}
                className="px-4 py-2 text-sm border border-gray-300 text-gray-700 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {actionLoading ? "처리 중..." : "잠금"}
              </button>
            )}
            {canUnlock && (
              <button
                onClick={() => handleAction("submitted")}
                disabled={actionLoading}
                className="px-4 py-2 text-sm border border-blue-300 text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                {actionLoading ? "처리 중..." : "잠금 해제"}
              </button>
            )}
          </div>
        </div>
      )}
      </PrintableSection>

      {showRevisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowRevisionModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-semibold text-gray-900 mb-3">수정 요청</h3>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="수정 요청 사유를 입력해주세요 (선택)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <div className="flex gap-2 justify-end mt-3">
              <button
                onClick={() => setShowRevisionModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={() => handleAction("revision_required", comment || undefined)}
                disabled={actionLoading}
                className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                {actionLoading ? "처리 중..." : "수정 요청"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
