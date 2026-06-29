"use client";

import { useEffect, useState } from "react";
import { getAllBranches } from "@/services/branches";
import { getTodayAllReports } from "@/services/reports";
import { getAllIssues } from "@/services/issues";
import { getAllCampaigns } from "@/services/campaigns";
import KpiCard from "@/components/dashboard/KpiCard";
import SubmissionDonut from "@/components/dashboard/SubmissionDonut";
import ConversionFunnel from "@/components/dashboard/ConversionFunnel";
import LoadingState from "@/components/common/LoadingState";
import { formatDate, todayYMD, calcPtConversionRate, formatPercent, getExpiringTmTotal, getUnregisteredTmTotal, getOfflinePromoTotal } from "@/lib/utils";
import { getAllReports } from "@/services/reports";
import type { Branch, DailyReport, Issue, Campaign } from "@/types";
import { format, subDays } from "date-fns";

export default function AdminDashboardPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [reports7d, setReports7d] = useState<DailyReport[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = todayYMD();
  const from7 = format(subDays(new Date(today), 6), "yyyy-MM-dd");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      console.log("admin today:", today, "from7:", from7);
      try {
        const [bs, rs, iss, cps, rs7d] = await Promise.all([
          getAllBranches(),
          getTodayAllReports(today),
          getAllIssues(),
          getAllCampaigns(),
          getAllReports(from7, today),
        ]);
        if (cancelled) return;
        const submitted = rs.filter((r) => r.status === "submitted" || r.status === "locked");
        console.log("branches:", bs.length, bs.map((b) => b.name));
        console.log("loaded reports:", rs.length, rs.map((r) => r.id));
        console.log("submitted reports:", submitted.length, submitted.map((r) => r.id));
        console.log("7d reports:", rs7d.length);
        console.log("dashboard totals:", {
          branches: bs.length,
          submittedToday: submitted.length,
          reports7d: rs7d.length,
        });
        setBranches(bs);
        setReports(rs);
        setReports7d(rs7d);
        setIssues(iss);
        setCampaigns(cps.filter((c) => c.status === "active"));
      } catch (err) {
        if (cancelled) return;
        console.error("dashboard load failed:", err);
        const code: string = (err as { code?: string })?.code ?? "unknown";
        setError(
          code === "permission-denied"
            ? "데이터 접근 권한이 없습니다. Firestore 관리자 문서의 role/status를 확인하세요. (permission-denied)"
            : `데이터 로드 오류: ${code}`
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [today, from7]);

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-1">
        <p className="text-sm font-semibold text-red-700">데이터 로드 실패</p>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  const submitted = reports.filter((r) => (r.status === "submitted" || r.status === "locked") && r.isTestData !== true);
  const revisionNeeded = reports.filter((r) => r.status === "revision_required");
  const submitMap = new Set(submitted.map((r) => r.branchId));
  const notSubmitted = branches.filter((b) => !submitMap.has(b.id));

  const totalActiveMembers = submitted.reduce((acc, r) => acc + (r.activeMembers ?? 0), 0);
  const totalInquiries = submitted.reduce((acc, r) => acc + (r.inquiries ?? 0), 0);
  const totalPtConsult = submitted.reduce((acc, r) => acc + (r.ptConsultations ?? 0), 0);
  const totalPtReg = submitted.reduce((acc, r) => acc + (r.ptRegistrations ?? 0), 0);
  const totalReReg = submitted.reduce((acc, r) => acc + (r.reRegistrations ?? 0), 0);
  const totalComeback = submitted.reduce((acc, r) => acc + (r.comebackMembers ?? 0), 0);

  const overallConvRate = calcPtConversionRate(totalPtConsult, totalPtReg);

  // 7일 집계 — 중복 보고 방지: 지점+날짜 기준 최신 1건만 유효
  const uniqueKey = (r: DailyReport) => `${r.branchId}_${r.reportDate}`;
  const seen7d = new Map<string, DailyReport>();
  for (const r of reports7d) {
    const k = uniqueKey(r);
    if (!seen7d.has(k)) seen7d.set(k, r);
  }
  const submitted7d = [...seen7d.values()].filter(
    (r) => (r.status === "submitted" || r.status === "locked") && r.isTestData !== true
  );
  const total7dPtConsult = submitted7d.reduce((acc, r) => acc + (r.ptConsultations ?? 0), 0);
  const total7dPtReg = submitted7d.reduce((acc, r) => acc + (r.ptRegistrations ?? 0), 0);
  const total7dReReg = submitted7d.reduce((acc, r) => acc + (r.reRegistrations ?? 0), 0);
  const total7dComeback = submitted7d.reduce((acc, r) => acc + (r.comebackMembers ?? 0), 0);
  const convRate7d = calcPtConversionRate(total7dPtConsult, total7dPtReg);

  // 7일 TM 방식별 집계
  const tm7dPhone   = submitted7d.reduce((a, r) => a + (r.expiringTm?.phone ?? 0) + (r.unregisteredTm?.phone ?? 0), 0);
  const tm7dSms     = submitted7d.reduce((a, r) => a + (r.expiringTm?.sms ?? 0) + (r.unregisteredTm?.sms ?? 0), 0);
  const tm7dKakao   = submitted7d.reduce((a, r) => a + (r.expiringTm?.kakao ?? 0) + (r.unregisteredTm?.kakao ?? 0), 0);
  const tm7dOther   = submitted7d.reduce((a, r) => a + (r.expiringTm?.other ?? 0) + (r.unregisteredTm?.other ?? 0), 0);
  const tm7dTotal   = submitted7d.reduce((a, r) => a + getExpiringTmTotal(r) + getUnregisteredTmTotal(r), 0);
  const promo7dFlyer       = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.flyer ?? 0), 0);
  const promo7dPlacard     = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.placard ?? 0), 0);
  const promo7dBanner      = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.banner ?? 0), 0);
  const promo7dPartnership = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.partnership ?? 0), 0);
  const promo7dEvent       = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.event ?? 0), 0);
  const promo7dOther       = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.other ?? 0), 0);
  const promo7dTotal       = submitted7d.reduce((a, r) => a + getOfflinePromoTotal(r), 0);
  const hasNew7dTmData     = submitted7d.some((r) => r.expiringTm || r.unregisteredTm);

  const openIssues = issues.filter((i) => i.status !== "resolved");
  const criticalIssues = openIssues.filter((i) => i.severity === "critical");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-gray-900">관리자 ({formatDate(today)})</h1>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="전체 지점" value={branches.length} unit="개" />
        <KpiCard label="제출 완료" value={submitted.length} unit="개"
          subLabel={`${branches.length > 0 ? Math.round((submitted.length / branches.length) * 100) : 0}%`} />
        <KpiCard label="미제출" value={notSubmitted.length} unit="개" />
        <KpiCard label="수정 요청" value={revisionNeeded.length} unit="건" />
        <KpiCard label="운영 이슈" value={openIssues.length} unit="건"
          subLabel={criticalIssues.length > 0 ? `긴급 ${criticalIssues.length}건` : undefined} />
        <KpiCard label="전체 유효회원" value={totalActiveMembers.toLocaleString()} unit="명" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Submission donut */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">제출 현황</p>
          <div className="flex items-center gap-6">
            <SubmissionDonut submitted={submitted.length} total={branches.length} />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-600" />
                <span className="text-xs text-gray-600">제출 완료 {submitted.length}개</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-200" />
                <span className="text-xs text-gray-600">미제출 {notSubmitted.length}개</span>
              </div>
            </div>
          </div>
        </div>

        {/* Not submitted list */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">미제출 지점</p>
          {notSubmitted.length === 0 ? (
            <p className="text-sm text-green-600 font-medium">전체 제출 완료 🎉</p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {notSubmitted.map((b) => (
                <div key={b.id} className="flex items-center gap-2 py-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="text-sm text-gray-700">{b.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Today overall metrics */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-700 mb-3">오늘 지표 (전체)</p>
        <div className="mb-4">
          <ConversionFunnel
            inquiries={totalInquiries}
            consultations={totalPtConsult}
            registrations={totalPtReg}
          />
          <p className="text-xs text-gray-400 mt-2">오늘 PT 전환율: <strong>{formatPercent(overallConvRate)}</strong></p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="재등록" value={totalReReg} unit="명" />
          <KpiCard label="컴백회원" value={totalComeback} unit="명" />
        </div>
      </div>

      {/* 7-day aggregate */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-700">최근 7일 실적 (전 지점 합산)</p>
          <span className="text-xs text-gray-400">{formatDate(from7)} ~ {formatDate(today)}</span>
        </div>
        <div className="mb-4">
          <ConversionFunnel
            inquiries={submitted7d.reduce((acc, r) => acc + (r.inquiries ?? 0), 0)}
            consultations={total7dPtConsult}
            registrations={total7dPtReg}
          />
          <p className="text-xs text-gray-400 mt-2">
            7일 PT 전환율:{" "}
            <strong className="text-gray-700">{formatPercent(convRate7d)}</strong>
            <span className="ml-2 text-gray-400">
              ({total7dPtReg}/{total7dPtConsult} × 100)
            </span>
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="PT 상담" value={total7dPtConsult} unit="건" />
          <KpiCard label="PT 등록" value={total7dPtReg} unit="건" />
          <KpiCard label="재등록" value={total7dReReg} unit="명" />
          <KpiCard label="컴백회원" value={total7dComeback} unit="명" />
        </div>

        {(tm7dTotal > 0 || hasNew7dTmData) && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-600 mb-2">TM 방식별 합계 (전 지점)</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <KpiCard label="전화" value={tm7dPhone} unit="건" />
              <KpiCard label="문자" value={tm7dSms} unit="건" />
              <KpiCard label="카카오톡" value={tm7dKakao} unit="건" />
              <KpiCard label="기타" value={tm7dOther} unit="건" />
              <KpiCard label="TM 총합" value={tm7dTotal} unit="건" />
            </div>
          </div>
        )}

        {promo7dTotal > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-600 mb-2">오프라인 홍보 방식별 합계 (전 지점)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <KpiCard label="전단지" value={promo7dFlyer} unit="개" />
              <KpiCard label="현수막" value={promo7dPlacard} unit="개" />
              <KpiCard label="배너" value={promo7dBanner} unit="개" />
              <KpiCard label="제휴" value={promo7dPartnership} unit="개" />
              <KpiCard label="외부 행사" value={promo7dEvent} unit="개" />
              <KpiCard label="기타" value={promo7dOther} unit="개" />
              <KpiCard label="홍보 총합" value={promo7dTotal} unit="개" />
            </div>
          </div>
        )}
      </div>

      {/* Issues summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-700 mb-3">운영 이슈 요약</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "클레임", type: "claim" as const, color: "text-red-600" },
            { label: "인력 이슈", type: "staff" as const, color: "text-orange-500" },
            { label: "시설 이슈", type: "facility" as const, color: "text-blue-500" },
          ].map((item) => {
            const count = openIssues.filter((i) => i.type === item.type).length;
            return (
              <div key={item.type} className="text-center">
                <p className={`text-2xl font-bold ${count > 0 ? item.color : "text-gray-300"}`}>{count}</p>
                <p className="text-xs text-gray-500">{item.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active campaigns */}
      {campaigns.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">진행 중 캠페인</p>
          <div className="space-y-2">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">{c.name}</p>
                  <p className="text-xs text-gray-400">{formatDate(c.startDate)} ~ {formatDate(c.endDate)}</p>
                </div>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">진행중</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
