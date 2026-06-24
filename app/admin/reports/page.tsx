"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, subDays } from "date-fns";
import { getAllBranches } from "@/services/branches";
import { getAllIssues } from "@/services/issues";
import { getAllReports, updateReportStatus } from "@/services/reports";
import { getAllUsers } from "@/services/users";
import { useAuth } from "@/contexts/AuthContext";
import { ReportStatusBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import {
  calcPtConversionRate,
  formatDate,
  formatDateTime,
  formatPercent,
  todayYMD,
} from "@/lib/utils";
import type { Branch, DailyReport, Issue, ReportStatus, UserProfile } from "@/types";

const statusLabel: Record<ReportStatus, string> = {
  draft: "임시저장",
  submitted: "제출완료",
  revision_required: "수정요청",
  locked: "잠금",
};

function uniqueSorted(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) =>
    a.localeCompare(b, "ko-KR")
  );
}

export default function AdminReportsPage() {
  const { profile } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterBrand, setFilterBrand] = useState("");
  const [filterRegion, setFilterRegion] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  const [filterStatus, setFilterStatus] = useState<ReportStatus | "">("");
  const [filterFrom, setFilterFrom] = useState(format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [filterTo, setFilterTo] = useState(todayYMD());

  const [actionReport, setActionReport] = useState<DailyReport | null>(null);
  const [actionType, setActionType] = useState<"revision" | "lock" | "unlock" | null>(null);
  const [comment, setComment] = useState("");
  const [actionSaving, setActionSaving] = useState(false);

  useEffect(() => {
    Promise.all([getAllBranches(), getAllUsers(), getAllIssues()])
      .then(([bs, us, iss]) => {
        console.log("branches:", bs.length, bs.map((b) => b.name));
        setBranches(bs);
        setUsers(us);
        setIssues(iss);
      })
      .catch((err) => {
        console.error("admin dashboard load error:", err);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAllReports(filterFrom, filterTo)
      .then((rs) => {
        if (cancelled) return;
        console.log("loaded reports:", rs.length, rs.map((r) => r.id));
        const submitted = rs.filter((r) => r.status === "submitted" || r.status === "locked");
        console.log("submitted reports:", submitted.length);
        setReports(rs);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("admin dashboard load error:", err);
        const code: string = (err as { code?: string })?.code ?? "unknown";
        setError(
          code === "permission-denied"
            ? "데이터 접근 권한이 없습니다. Firestore 관리자 문서의 role/status를 확인하세요. (permission-denied)"
            : `데이터 로드 오류: ${code}`
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterFrom, filterTo]);

  const branchMap = useMemo(() => Object.fromEntries(branches.map((branch) => [branch.id, branch])), [branches]);
  const userMap = useMemo(() => Object.fromEntries(users.map((user) => [user.uid, user])), [users]);

  const brands = useMemo(() => uniqueSorted(branches.map((branch) => branch.brand)), [branches]);
  const regions = useMemo(
    () =>
      uniqueSorted(
        branches
          .filter((branch) => !filterBrand || branch.brand === filterBrand)
          .map((branch) => branch.region)
      ),
    [branches, filterBrand]
  );
  const visibleBranches = useMemo(
    () =>
      branches.filter(
        (branch) =>
          (!filterBrand || branch.brand === filterBrand) &&
          (!filterRegion || branch.region === filterRegion)
      ),
    [branches, filterBrand, filterRegion]
  );

  const issueCountByReport = useMemo(() => {
    const counts: Record<string, number> = {};
    issues
      .filter((issue) => issue.status !== "resolved")
      .forEach((issue) => {
        counts[issue.reportId] = (counts[issue.reportId] ?? 0) + 1;
      });
    return counts;
  }, [issues]);

  const filtered = useMemo(
    () =>
      reports.filter((report) => {
        const branch = branchMap[report.branchId];
        if (filterBrand && branch?.brand !== filterBrand) return false;
        if (filterRegion && branch?.region !== filterRegion) return false;
        if (filterBranch && report.branchId !== filterBranch) return false;
        if (filterStatus && report.status !== filterStatus) return false;
        return true;
      }),
    [reports, branchMap, filterBrand, filterRegion, filterBranch, filterStatus]
  );

  const summary = useMemo(() => {
    const submitted = filtered.filter((report) => report.status === "submitted" || report.status === "locked");
    const totalActiveMembers = submitted.reduce((sum, report) => sum + (report.activeMembers ?? 0), 0);
    const totalInquiries = submitted.reduce((sum, report) => sum + (report.inquiries ?? 0), 0);
    const totalPtConsultations = submitted.reduce((sum, report) => sum + (report.ptConsultations ?? 0), 0);
    const totalPtRegistrations = submitted.reduce((sum, report) => sum + (report.ptRegistrations ?? 0), 0);
    const reportIds = new Set(filtered.map((report) => report.id));
    const openIssues = issues.filter((issue) => reportIds.has(issue.reportId) && issue.status !== "resolved").length;

    return {
      totalReports: filtered.length,
      submitted: submitted.length,
      revisionRequired: filtered.filter((report) => report.status === "revision_required").length,
      locked: filtered.filter((report) => report.status === "locked").length,
      totalActiveMembers,
      totalInquiries,
      ptConversionRate: calcPtConversionRate(totalPtConsultations, totalPtRegistrations),
      openIssues,
    };
  }, [filtered, issues]);

  function resetBranchIfHidden(nextBrand: string, nextRegion: string) {
    const branch = branches.find((b) => b.id === filterBranch);
    if (!branch) return;
    if ((nextBrand && branch.brand !== nextBrand) || (nextRegion && branch.region !== nextRegion)) {
      setFilterBranch("");
    }
  }

  function resetFilters() {
    setFilterBrand("");
    setFilterRegion("");
    setFilterBranch("");
    setFilterStatus("");
  }

  async function handleAction() {
    if (!actionReport || !actionType || !profile) return;
    setActionSaving(true);
    try {
      const newStatus: ReportStatus =
        actionType === "revision"
          ? "revision_required"
          : actionType === "lock"
            ? "locked"
            : "submitted";

      await updateReportStatus(
        actionReport.id,
        newStatus,
        profile.uid,
        profile.name,
        comment.trim() || undefined
      );
      setReports((prev) =>
        prev.map((report) => (report.id === actionReport.id ? { ...report, status: newStatus } : report))
      );
      setActionReport(null);
      setActionType(null);
      setComment("");
    } finally {
      setActionSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-bold text-gray-900">보고 관리</h1>
        <p className="text-xs text-gray-400 mt-1">기간, 브랜드, 지역, 지점, 상태별로 보고서를 조회하고 후속 조치합니다.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <input
            type="date"
            value={filterFrom}
            onChange={(event) => {
              setLoading(true);
              setFilterFrom(event.target.value);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={filterTo}
            onChange={(event) => {
              setLoading(true);
              setFilterTo(event.target.value);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={filterBrand}
            onChange={(event) => {
              const nextBrand = event.target.value;
              setFilterBrand(nextBrand);
              resetBranchIfHidden(nextBrand, filterRegion);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">전체 브랜드</option>
            {brands.map((brand) => (
              <option key={brand} value={brand}>{brand}</option>
            ))}
          </select>
          <select
            value={filterRegion}
            onChange={(event) => {
              const nextRegion = event.target.value;
              setFilterRegion(nextRegion);
              resetBranchIfHidden(filterBrand, nextRegion);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">전체 지역</option>
            {regions.map((region) => (
              <option key={region} value={region}>{region}</option>
            ))}
          </select>
          <select
            value={filterBranch}
            onChange={(event) => setFilterBranch(event.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">전체 지점</option>
            {visibleBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value as ReportStatus | "")}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">전체 상태</option>
            {Object.entries(statusLabel).map(([status, label]) => (
              <option key={status} value={status}>{label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 flex-1">
            <SummaryPill label="보고" value={`${summary.totalReports}건`} />
            <SummaryPill label="제출" value={`${summary.submitted}건`} />
            <SummaryPill label="수정요청" value={`${summary.revisionRequired}건`} tone="orange" />
            <SummaryPill label="잠금" value={`${summary.locked}건`} />
            <SummaryPill label="운영이슈" value={`${summary.openIssues}건`} tone={summary.openIssues > 0 ? "red" : "gray"} />
            <SummaryPill label="유효회원" value={`${summary.totalActiveMembers.toLocaleString()}명`} />
            <SummaryPill label="PT 전환율" value={formatPercent(summary.ptConversionRate)} />
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="px-3 py-2 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
          >
            필터 초기화
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-1">
          <p className="text-sm font-semibold text-red-700">데이터 로드 실패</p>
          <p className="text-sm text-red-500">{error}</p>
        </div>
      ) : loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState title="조건에 맞는 보고 데이터가 없습니다" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[1040px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["날짜", "브랜드", "지역", "지점", "담당자", "상태", "유효회원", "문의", "PT 상담", "PT 등록", "전환율", "이슈", "제출시간", "액션"].map((header) => (
                  <th key={header} className="px-3 py-3 text-left text-xs font-medium text-gray-500">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((report) => {
                const branch = branchMap[report.branchId];
                const writer = userMap[report.writerUid];
                const convRate = calcPtConversionRate(report.ptConsultations, report.ptRegistrations);
                const openIssueCount = issueCountByReport[report.id] ?? 0;

                return (
                  <tr key={report.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Link href={`/admin/reports/${report.id}`} className="text-blue-600 hover:underline">
                        {formatDate(report.reportDate)}
                      </Link>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{branch?.brand ?? "-"}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{branch?.region ?? "-"}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{branch?.name ?? report.branchId}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{writer?.name ?? "-"}</td>
                    <td className="px-3 py-3"><ReportStatusBadge status={report.status} /></td>
                    <td className="px-3 py-3">{report.activeMembers ?? "-"}</td>
                    <td className="px-3 py-3">{report.inquiries ?? "-"}</td>
                    <td className="px-3 py-3">{report.ptConsultations ?? "-"}</td>
                    <td className="px-3 py-3">{report.ptRegistrations ?? "-"}</td>
                    <td className="px-3 py-3">{formatPercent(convRate)}</td>
                    <td className="px-3 py-3">
                      <span className={openIssueCount > 0 ? "font-semibold text-red-600" : "text-gray-400"}>
                        {openIssueCount}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-400">
                      {report.submittedAt ? formatDateTime(report.submittedAt.toDate()) : "-"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {report.status === "submitted" && (
                          <>
                            <button
                              type="button"
                              onClick={() => { setActionReport(report); setActionType("revision"); }}
                              className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                            >
                              수정요청
                            </button>
                            <button
                              type="button"
                              onClick={() => { setActionReport(report); setActionType("lock"); }}
                              className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                            >
                              잠금
                            </button>
                          </>
                        )}
                        {report.status === "locked" && (
                          <button
                            type="button"
                            onClick={() => { setActionReport(report); setActionType("unlock"); }}
                            className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          >
                            잠금해제
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {actionReport && actionType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setActionReport(null); setActionType(null); }} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900">
              {actionType === "revision" ? "수정 요청" : actionType === "lock" ? "보고 잠금" : "잠금 해제"}
            </h3>
            <p className="text-sm text-gray-500">
              {branchMap[actionReport.branchId]?.name ?? actionReport.branchId} · {formatDate(actionReport.reportDate)}
            </p>
            {actionType === "revision" && (
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">수정 요청 내용</label>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                  placeholder="지점장에게 전달할 내용을 입력하세요"
                />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setActionReport(null); setActionType(null); setComment(""); }}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleAction}
                disabled={actionSaving}
                className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50"
              >
                {actionSaving ? "처리 중..." : "확인"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone = "gray",
}: {
  label: string;
  value: string;
  tone?: "gray" | "orange" | "red";
}) {
  const toneClass =
    tone === "red"
      ? "bg-red-50 text-red-700"
      : tone === "orange"
        ? "bg-orange-50 text-orange-700"
        : "bg-gray-50 text-gray-700";

  return (
    <div className={`rounded-lg px-3 py-2 ${toneClass}`}>
      <p className="text-[11px] opacity-70">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
