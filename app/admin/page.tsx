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
import { formatDate, todayYMD, calcPtConversionRate, formatPercent } from "@/lib/utils";
import type { Branch, DailyReport, Issue, Campaign } from "@/types";

export default function AdminDashboardPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const today = todayYMD();

  useEffect(() => {
    Promise.all([
      getAllBranches(),
      getTodayAllReports(today),
      getAllIssues(),
      getAllCampaigns(),
    ]).then(([bs, rs, iss, cps]) => {
      setBranches(bs);
      setReports(rs);
      setIssues(iss);
      setCampaigns(cps.filter((c) => c.status === "active"));
      setLoading(false);
    });
  }, [today]);

  if (loading) return <LoadingState />;

  const submitted = reports.filter((r) => r.status === "submitted" || r.status === "locked");
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
        <p className="text-sm font-semibold text-gray-700 mb-3">오늘 주요 지표 (전체)</p>
        <div className="mb-4">
          <ConversionFunnel
            inquiries={totalInquiries}
            consultations={totalPtConsult}
            registrations={totalPtReg}
          />
          <p className="text-xs text-gray-400 mt-2">전체 PT 전환율: <strong>{formatPercent(overallConvRate)}</strong></p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="재등록" value={totalReReg} unit="명" />
          <KpiCard label="컴백회원" value={totalComeback} unit="명" />
        </div>
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
