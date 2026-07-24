"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getReportById, updateReportStatus, moveReportDate, type MoveReportDateResult } from "@/services/reports";
import { getIssuesByReport } from "@/services/issues";
import { getBranchesByIds } from "@/services/branches";
import { ReportStatusBadge, SeverityBadge, IssueStatusBadge } from "@/components/common/StatusBadge";
import PrintButton from "@/components/print/PrintButton";
import PrintHeader from "@/components/print/PrintHeader";
import PrintableSection from "@/components/print/PrintableSection";
import LoadingState from "@/components/common/LoadingState";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { formatDate, formatDateTime, calcPtConversionRate, formatPercent, getExpiringTmTotal, getUnregisteredTmTotal, getOfflinePromoTotal, isAbnormalSubmittedReport, canManageReportDate, getKoreaToday } from "@/lib/utils";
import type { DailyReport, Issue, ReportStatus } from "@/types";
import { ChevronLeftIcon, CalendarClockIcon, XIcon, AlertTriangleIcon } from "lucide-react";

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
  const router = useRouter();
  const { profile } = useAuth();
  const [report, setReport] = useState<DailyReport | null | undefined>(undefined);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [branchName, setBranchName] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [comment, setComment] = useState("");
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [printSections, setPrintSections] = useState<string[]>(["report"]);

  // 보고일 변경
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const [moveConfirmOpen, setMoveConfirmOpen] = useState(false);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveConflict, setMoveConflict] = useState<DailyReport | null>(null);
  const [moveOverwriteConfirmOpen, setMoveOverwriteConfirmOpen] = useState(false);
  const [moveResult, setMoveResult] = useState<MoveReportDateResult | null>(null);

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

  function openMoveModal() {
    if (!report) return;
    setMoveDate(report.reportDate);
    setMoveError(null);
    setMoveConflict(null);
    setMoveResult(null);
    setMoveOpen(true);
  }

  function closeMoveModal() {
    setMoveOpen(false);
    setMoveConflict(null);
    setMoveError(null);
    setMoveConfirmOpen(false);
    setMoveOverwriteConfirmOpen(false);
  }

  function requestMove() {
    if (!report) return;
    setMoveError(null);
    if (!moveDate) {
      setMoveError("변경할 날짜를 선택해주세요.");
      return;
    }
    if (moveDate === report.reportDate) {
      setMoveError("현재 보고일과 동일합니다.");
      return;
    }
    if (canManageReportDate("admin", moveDate) === "future_blocked") {
      setMoveError("미래 날짜로는 변경할 수 없습니다.");
      return;
    }
    setMoveConfirmOpen(true);
  }

  async function executeMove(overwrite: boolean) {
    if (!report) return;
    setMoveLoading(true);
    setMoveError(null);
    try {
      const result = await moveReportDate(report.id, moveDate, overwrite);
      if (result.status === "conflict") {
        setMoveConflict(result.existingTarget ?? null);
        return;
      }
      setMoveResult(result);
      setMoveConflict(null);
    } catch (err) {
      console.error("[AdminReportDetail] moveReportDate failed", err);
      const code = (err as { message?: string })?.message ?? "";
      setMoveError(
        code === "report-not-found"
          ? "보고서를 찾을 수 없습니다."
          : code === "same-date"
            ? "현재 보고일과 동일합니다."
            : "보고일 변경 중 오류가 발생했습니다. 데이터는 안전하게 보존되었습니다."
      );
    } finally {
      setMoveLoading(false);
      setMoveConfirmOpen(false);
      setMoveOverwriteConfirmOpen(false);
    }
  }

  function finishMove() {
    if (!moveResult?.newReportId) return;
    router.push(`/admin/reports/${moveResult.newReportId}`);
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
        <button
          type="button"
          onClick={openMoveModal}
          className="no-print flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[#1e3a5f] text-[#1e3a5f] rounded-lg hover:bg-[#1e3a5f]/5"
        >
          <CalendarClockIcon className="w-3.5 h-3.5" />
          보고일 변경
        </button>
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

      {moveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeMoveModal} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">보고일 변경</h3>
              <button onClick={closeMoveModal} className="text-gray-400 hover:text-gray-600">
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            {moveResult ? (
              <>
                <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  보고일을 {report.reportDate} → {moveDate}(으)로 이동했습니다.
                </p>
                <div className="text-xs text-gray-500 space-y-1">
                  <p>이전된 운영 이슈: {moveResult.movedIssues ?? 0}건</p>
                  <p>이전된 캠페인 실적: {moveResult.movedCampaignResults ?? 0}건</p>
                  <p>이전된 트레이너 세션: {moveResult.movedTrainerSessions ?? 0}건</p>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={finishMove}
                    className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f]"
                  >
                    이동된 보고서로 이동
                  </button>
                </div>
              </>
            ) : moveConflict ? (
              <>
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  <AlertTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>대상 날짜({moveDate})에 이미 보고서가 있습니다. 자동으로 덮어쓰지 않습니다. 두 보고서를 비교한 뒤 덮어쓰기 또는 취소를 선택해주세요.</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="border border-gray-200 rounded-lg p-3">
                    <p className="text-xs font-medium text-gray-500 mb-2">현재 보고서 ({report.reportDate})</p>
                    <Row label="상태" value={report.status} />
                    <Row label="유효회원" value={`${report.activeMembers ?? "-"}명`} />
                    <Row label="문의" value={`${report.inquiries ?? "-"}건`} />
                    <Row label="PT 상담" value={`${report.ptConsultations ?? "-"}건`} />
                  </div>
                  <div className="border border-amber-200 rounded-lg p-3">
                    <p className="text-xs font-medium text-amber-600 mb-2">기존 대상 보고서 ({moveDate})</p>
                    <Row label="상태" value={moveConflict.status} />
                    <Row label="유효회원" value={`${moveConflict.activeMembers ?? "-"}명`} />
                    <Row label="문의" value={`${moveConflict.inquiries ?? "-"}건`} />
                    <Row label="PT 상담" value={`${moveConflict.ptConsultations ?? "-"}건`} />
                  </div>
                </div>
                {moveError && <p className="text-xs text-red-600">{moveError}</p>}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={closeMoveModal}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => setMoveOverwriteConfirmOpen(true)}
                    disabled={moveLoading}
                    className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    {moveLoading ? "처리 중..." : "기존 대상 삭제 후 덮어쓰기"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500">
                  현재 보고일: <span className="font-medium text-gray-800">{report.reportDate}</span>
                </p>
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">변경할 보고일</label>
                  <input
                    type="date"
                    value={moveDate}
                    max={getKoreaToday()}
                    onChange={(e) => setMoveDate(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  />
                </div>
                <p className="text-xs text-gray-400">
                  운영 이슈, 캠페인 실적, 트레이너 세션 기록도 함께 이전됩니다. 이동 중 문제가 생기면 기존 보고서는 삭제되지 않습니다.
                </p>
                {moveError && <p className="text-xs text-red-600">{moveError}</p>}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={closeMoveModal}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={requestMove}
                    disabled={moveLoading}
                    className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50"
                  >
                    {moveLoading ? "처리 중..." : "보고일 변경"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={moveConfirmOpen}
        title={`보고일을 ${report.reportDate}에서 ${moveDate}(으)로 변경하시겠습니까?`}
        description="운영 이슈, 캠페인 실적, 트레이너 세션 기록도 함께 이전됩니다."
        confirmLabel="변경"
        onConfirm={() => void executeMove(false)}
        onCancel={() => setMoveConfirmOpen(false)}
      />

      <ConfirmDialog
        open={moveOverwriteConfirmOpen}
        title="기존 대상 날짜의 보고서를 덮어쓰시겠습니까?"
        description={`${moveDate}에 이미 존재하는 보고서와 연결 데이터가 모두 삭제된 뒤 현재 보고서로 대체됩니다. 되돌릴 수 없습니다.`}
        confirmLabel="덮어쓰기"
        danger
        onConfirm={() => void executeMove(true)}
        onCancel={() => setMoveOverwriteConfirmOpen(false)}
      />
    </div>
  );
}
