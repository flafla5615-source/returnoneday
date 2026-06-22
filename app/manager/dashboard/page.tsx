"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import { getReportsByBranch } from "@/services/reports";
import { getAllIssues } from "@/services/issues";
import KpiCard from "@/components/dashboard/KpiCard";
import TrendChart from "@/components/dashboard/TrendChart";
import ConversionFunnel from "@/components/dashboard/ConversionFunnel";
import LoadingState from "@/components/common/LoadingState";
import { formatDate, todayYMD, calcPtConversionRate, formatPercent } from "@/lib/utils";
import type { Branch, DailyReport, Issue } from "@/types";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";

type FilterKey = "7days" | "thisMonth" | "lastMonth";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "7days", label: "최근 7일" },
  { key: "thisMonth", label: "이번 달" },
  { key: "lastMonth", label: "지난달" },
];

function getRange(filter: FilterKey): { from: string; to: string } {
  const today = new Date(todayYMD());
  if (filter === "7days") {
    return { from: format(subDays(today, 6), "yyyy-MM-dd"), to: todayYMD() };
  }
  if (filter === "thisMonth") {
    return {
      from: format(startOfMonth(today), "yyyy-MM-dd"),
      to: format(endOfMonth(today), "yyyy-MM-dd"),
    };
  }
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return {
    from: format(startOfMonth(lastMonth), "yyyy-MM-dd"),
    to: format(endOfMonth(lastMonth), "yyyy-MM-dd"),
  };
}

function sum(reports: DailyReport[], key: keyof DailyReport): number {
  return reports.reduce((acc, r) => acc + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
}

export default function ManagerDashboardPage() {
  const { profile } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [filter, setFilter] = useState<FilterKey>("7days");
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    getBranchesByIds(profile.branchIds).then((bs) => {
      setBranches(bs);
      if (bs.length > 0) setSelectedBranchId(bs[0].id);
    });
  }, [profile]);

  const loadData = useCallback(async () => {
    if (!selectedBranchId) return;
    setLoading(true);
    const { from, to } = getRange(filter);
    const [rs, iss] = await Promise.all([
      getReportsByBranch(selectedBranchId, from, to),
      getAllIssues({ branchId: selectedBranchId }),
    ]);
    setReports(rs);
    setIssues(iss);
    setLoading(false);
  }, [selectedBranchId, filter]);

  useEffect(() => { loadData(); }, [loadData]);

  const submitted = reports.filter((r) => r.activeMembers !== null);
  const latestReport = submitted[0];
  const prevReport = submitted[1];

  const totalInquiries = sum(submitted, "inquiries");
  const totalPtConsult = sum(submitted, "ptConsultations");
  const totalPtReg = sum(submitted, "ptRegistrations");
  const totalReReg = sum(submitted, "reRegistrations");
  const totalComeback = sum(submitted, "comebackMembers");
  const totalHappyCalls = sum(submitted, "happyCalls");

  const overallConvRate = calcPtConversionRate(totalPtConsult, totalPtReg);

  const trendData = submitted.slice().reverse().map((r) => ({
    date: formatDate(r.reportDate).slice(5),
    value: r.activeMembers ?? 0,
  }));

  const openIssues = issues.filter((i) => i.status === "open");
  const claims = openIssues.filter((i) => i.type === "claim").length;
  const staffIssues = openIssues.filter((i) => i.type === "staff").length;
  const facilityIssues = openIssues.filter((i) => i.type === "facility").length;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-base font-bold text-gray-900">지점 대시보드</h1>
        <div className="flex items-center gap-2">
          {branches.length > 1 && (
            <select value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${filter === f.key ? "bg-[#1e3a5f] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? <LoadingState /> : (
        <>
          {/* Member stats */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">회원 현황</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <KpiCard
                label="현재 유효회원"
                value={latestReport?.activeMembers ?? "-"}
                unit="명"
                change={latestReport && prevReport ? `전일 대비 ${latestReport.activeMembers! - (prevReport.activeMembers ?? 0) > 0 ? "▲" : "▼"} ${Math.abs(latestReport.activeMembers! - (prevReport.activeMembers ?? 0))}` : undefined}
              />
              <KpiCard label="재등록" value={totalReReg} unit="명" />
              <KpiCard label="컴백회원" value={totalComeback} unit="명" />
              <KpiCard label="총 해피콜" value={totalHappyCalls} unit="건" />
            </div>
          </div>

          {/* Trend */}
          {trendData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <p className="text-sm font-semibold text-gray-700 mb-3">유효회원 추이</p>
              <TrendChart data={trendData} />
            </div>
          )}

          {/* Funnel */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-sm font-semibold text-gray-700 mb-3">상담 퍼널</p>
            <ConversionFunnel
              inquiries={totalInquiries}
              consultations={totalPtConsult}
              registrations={totalPtReg}
            />
            <p className="text-xs text-gray-400 mt-2">전체 PT 전환율: <strong>{formatPercent(overallConvRate)}</strong></p>
          </div>

          {/* Issues summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-sm font-semibold text-gray-700 mb-3">미해결 운영 이슈</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className={`text-2xl font-bold ${claims > 0 ? "text-red-600" : "text-gray-400"}`}>{claims}</p>
                <p className="text-xs text-gray-500">클레임</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold ${staffIssues > 0 ? "text-orange-500" : "text-gray-400"}`}>{staffIssues}</p>
                <p className="text-xs text-gray-500">인력 이슈</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold ${facilityIssues > 0 ? "text-blue-500" : "text-gray-400"}`}>{facilityIssues}</p>
                <p className="text-xs text-gray-500">시설 이슈</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
