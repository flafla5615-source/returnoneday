"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import { getReport, getRecentReports } from "@/services/reports";
import { getActiveCampaigns } from "@/services/campaigns";
import { getAllIssues } from "@/services/issues";
import KpiCard from "@/components/dashboard/KpiCard";
import TrendChart from "@/components/dashboard/TrendChart";
import { ReportStatusBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import {
  todayYMD,
  formatDate,
  calcPtConversionRate,
  formatPercent,
  diffLabel,
} from "@/lib/utils";
import type { Branch, DailyReport, Campaign, Issue } from "@/types";
import { format, subDays } from "date-fns";
import { AlertCircleIcon, PlusCircleIcon } from "lucide-react";

export default function ManagerHomePage() {
  const { profile } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [todayReport, setTodayReport] = useState<DailyReport | null | undefined>(undefined);
  const [yesterdayReport, setYesterdayReport] = useState<DailyReport | null>(null);
  const [recentReports, setRecentReports] = useState<DailyReport[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const today = todayYMD();
  const yesterday = format(subDays(new Date(today), 1), "yyyy-MM-dd");

  useEffect(() => {
    if (!profile) return;
    console.log("manager home profile:", { uid: profile.uid, name: profile.name, branchIds: profile.branchIds });
    getBranchesByIds(profile.branchIds).then((bs) => {
      console.log("branches:", bs.length, bs.map((b) => b.name));
      setBranches(bs);
      if (bs.length > 0) setSelectedBranchId(bs[0].id);
      if (bs.length === 0) setLoading(false);
    }).catch((err) => {
      console.error("admin dashboard load error:", err);
      setLoadError("지점 정보를 불러오지 못했습니다. 관리자에게 지점 배정을 요청하세요.");
      setLoading(false);
    });
  }, [profile]);

  useEffect(() => {
    if (!selectedBranchId) return;
    let cancelled = false;

    async function loadData() {
      try {
        console.log("manager home loading:", { selectedBranchId, today });
        const [tr, yr, rr, ac, iss] = await Promise.all([
          getReport(selectedBranchId, today),
          getReport(selectedBranchId, yesterday),
          getRecentReports(selectedBranchId, 7),
          getActiveCampaigns(selectedBranchId),
          getAllIssues({ branchId: selectedBranchId, status: "open" }),
        ]);
        if (cancelled) return;
        console.log("loaded reports:", rr.length, "todayReport:", tr?.status ?? "없음");
        setTodayReport(tr);
        setYesterdayReport(yr);
        setRecentReports(rr);
        setCampaigns(ac);
        setIssues(iss);
      } catch (err) {
        console.error("admin dashboard load error:", err);
        if (!cancelled) setLoadError("데이터를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [selectedBranchId, today, yesterday]);

  const selectedBranch = branches.find((b) => b.id === selectedBranchId);

  const trendData = recentReports
    .slice()
    .reverse()
    .map((r) => ({
      date: formatDate(r.reportDate).slice(5),
      value: r.activeMembers ?? 0,
    }));

  const convRate = todayReport
    ? calcPtConversionRate(todayReport.ptConsultations, todayReport.ptRegistrations)
    : null;

  if (loading && todayReport === undefined) return <LoadingState />;

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-1">
        <p className="text-sm font-semibold text-red-700">데이터 로드 실패</p>
        <p className="text-sm text-red-500">{loadError}</p>
      </div>
    );
  }

  if (!loading && branches.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-1">
        <p className="text-sm font-semibold text-amber-700">배정된 지점 없음</p>
        <p className="text-sm text-amber-600">관리자에게 지점 배정을 요청하세요. 배정 후 다시 로그인해주세요.</p>
      </div>
    );
  }

  const reportStatus = todayReport?.status ?? null;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-bold text-gray-900">
            {profile?.name ?? "사용자"}님, 오늘도 화이팅입니다!
          </p>
          <p className="text-xs text-gray-400">{formatDate(today)} 기준</p>
        </div>
        {branches.length > 1 && (
          <select
            value={selectedBranchId}
            onChange={(e) => {
              setLoading(true);
              setSelectedBranchId(e.target.value);
            }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Today status */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">오늘 보고 상태</p>
            {reportStatus ? (
              <ReportStatusBadge status={reportStatus} />
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">미작성</span>
            )}
            {reportStatus === "revision_required" && (
              <p className="text-xs text-orange-600 mt-1">수정 요청이 있습니다.</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">오늘 날짜</p>
            <p className="font-bold text-gray-800">{formatDate(today)}</p>
            {selectedBranch && <p className="text-xs text-gray-400 mt-0.5">{selectedBranch.name}</p>}
          </div>
        </div>
        {(!reportStatus || reportStatus === "draft" || reportStatus === "revision_required") && (
          <Link
            href="/manager/report/new"
            className="mt-3 flex items-center justify-center gap-2 w-full py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors"
          >
            <PlusCircleIcon className="w-4 h-4" />
            오늘 보고 작성하기
          </Link>
        )}
      </div>

      {/* KPI Grid */}
      {todayReport && (
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2">오늘 주요 지표</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <KpiCard
              label="유효회원"
              value={todayReport.activeMembers ?? "-"}
              unit="명"
              subLabel={yesterdayReport ? `전일 ${yesterdayReport.activeMembers ?? "-"}명` : "전일 데이터 없음"}
              change={diffLabel(todayReport.activeMembers, yesterdayReport?.activeMembers ?? null)}
              changePositive={(todayReport.activeMembers ?? 0) >= (yesterdayReport?.activeMembers ?? 0)}
            />
            <KpiCard label="문의수" value={todayReport.inquiries ?? "-"} unit="건" />
            <KpiCard label="PT 상담" value={todayReport.ptConsultations ?? "-"} unit="건" />
            <KpiCard label="PT 등록" value={todayReport.ptRegistrations ?? "-"} unit="건" />
            <KpiCard label="PT 전환율" value={formatPercent(convRate)} />
            <KpiCard label="재등록" value={todayReport.reRegistrations ?? "-"} unit="명" />
            <KpiCard label="컴백회원" value={todayReport.comebackMembers ?? "-"} unit="명" />
            <KpiCard label="해피콜" value={todayReport.happyCalls ?? "-"} unit="건" />
          </div>
        </div>
      )}

      {/* Trend chart */}
      {trendData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">최근 7일 유효회원 추이</p>
          <TrendChart data={trendData} />
        </div>
      )}

      {/* Recent reports */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-700">최근 보고 내역</p>
          <Link href="/manager/reports" className="text-xs text-red-600 hover:underline">전체보기</Link>
        </div>
        {recentReports.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">보고 내역이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {recentReports.slice(0, 5).map((r) => (
              <Link
                key={r.id}
                href={`/manager/reports/${r.id}`}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 -mx-1 px-1 rounded"
              >
                <span className="text-sm text-gray-700">{formatDate(r.reportDate)}</span>
                <ReportStatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Active campaigns */}
      {campaigns.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">진행 중 캠페인</p>
          {campaigns.map((c) => (
            <div key={c.id} className="text-sm">
              <p className="font-medium text-gray-800">{c.name}</p>
              <p className="text-xs text-gray-400">기간: {formatDate(c.startDate)} ~ {formatDate(c.endDate)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Open issues */}
      {issues.length > 0 && (
        <div className="bg-white rounded-xl border border-red-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircleIcon className="w-4 h-4 text-red-500" />
            <p className="text-sm font-semibold text-gray-700">미해결 운영 이슈 ({issues.length}건)</p>
          </div>
          {issues.slice(0, 3).map((iss) => (
            <div key={iss.id} className="text-xs text-gray-600 py-1 border-b border-gray-100 last:border-0">
              <span className="font-medium">[{iss.type === "claim" ? "클레임" : iss.type === "staff" ? "인력" : "시설"}]</span>{" "}
              {iss.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
