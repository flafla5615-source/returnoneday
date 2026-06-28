"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getReportById, getReportComments } from "@/services/reports";
import { getBranchesByIds } from "@/services/branches";
import { ReportStatusBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import { formatDate, formatDateTime, formatPercent, calcPtConversionRate, getExpiringTmTotal, getUnregisteredTmTotal, getOfflinePromoTotal } from "@/lib/utils";
import type { DailyReport, ReportComment } from "@/types";
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
  const { profile } = useAuth();
  const [report, setReport] = useState<DailyReport | null | undefined>(undefined);
  const [comments, setComments] = useState<ReportComment[]>([]);
  const [branchName, setBranchName] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!reportId) return;
    let cancelled = false;

    Promise.all([getReportById(reportId), getReportComments(reportId)])
      .then(([r, cs]) => {
        if (cancelled) return;
        if (r && profile && !profile.branchIds.includes(r.branchId)) {
          setLoadError("이 보고서에 접근할 권한이 없습니다.");
          setReport(null);
          return;
        }
        setLoadError("");
        setReport(r);
        setComments(cs);
        if (r) {
          getBranchesByIds([r.branchId]).then((bs) => {
            if (!cancelled) setBranchName(bs[0]?.name ?? "");
          });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        if (process.env.NODE_ENV === "development") {
          console.error("[Report Detail Error]", error);
        }
        setLoadError("보고서를 찾을 수 없거나 접근 권한이 없습니다.");
        setReport(null);
        setComments([]);
      });

    return () => {
      cancelled = true;
    };
  }, [reportId]);

  if (report === undefined) return <LoadingState />;
  if (!report) return <EmptyState title={loadError || "보고서를 찾을 수 없습니다"} />;

  const convRate = calcPtConversionRate(report.ptConsultations, report.ptRegistrations);
  const revisionComments = comments.filter((comment) => comment.type === "revision_request");

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/manager/reports" className="p-1.5 rounded-lg hover:bg-gray-100">
          <ChevronLeftIcon className="w-5 h-5 text-gray-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-900">{formatDate(report.reportDate)} 보고서</h1>
          {branchName && <p className="text-xs text-gray-400">{branchName}</p>}
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
        {report.expiringTm ? (
          <>
            <p className="text-xs font-medium text-gray-500 mt-1 mb-1">만료·홀드 TM</p>
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

      {report.status === "revision_required" && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <p className="text-sm font-medium text-orange-700 mb-1">수정 요청</p>
          <p className="text-sm text-orange-600">관리자가 수정을 요청했습니다. 보고서를 수정해주세요.</p>
          {revisionComments.length > 0 && (
            <div className="mt-3 space-y-2">
              {revisionComments.map((comment) => (
                <div key={comment.id} className="rounded-lg bg-white/70 border border-orange-100 px-3 py-2">
                  <p className="text-xs text-orange-500">
                    {comment.authorName} · {formatDateTime(comment.createdAt.toDate())}
                  </p>
                  <p className="mt-1 text-sm text-orange-800 whitespace-pre-wrap">{comment.content}</p>
                </div>
              ))}
            </div>
          )}
          <Link
            href={`/manager/report/new?branchId=${report.branchId}&date=${report.reportDate}`}
            className="mt-2 inline-block px-4 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700"
          >
            수정하기
          </Link>
        </div>
      )}
    </div>
  );
}
