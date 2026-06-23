"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import { getReportsByBranch } from "@/services/reports";
import { ReportStatusBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import { formatDate, formatDateTime, todayYMD } from "@/lib/utils";
import type { Branch, DailyReport } from "@/types";
import { format, subDays } from "date-fns";

export default function ReportsPage() {
  const { profile } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);

  const today = todayYMD();
  const from = format(subDays(new Date(today), 30), "yyyy-MM-dd");

  useEffect(() => {
    if (!profile) return;
    getBranchesByIds(profile.branchIds).then((bs) => {
      setBranches(bs);
      if (bs.length > 0) setSelectedBranchId(bs[0].id);
      if (bs.length === 0) setLoading(false);
    });
  }, [profile]);

  useEffect(() => {
    if (!selectedBranchId) return;
    let cancelled = false;
    getReportsByBranch(selectedBranchId, from, today).then((rs) => {
      if (cancelled) return;
      setReports(rs);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedBranchId, today, from]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-gray-900">보고 내역</h1>
        {branches.length > 1 && (
          <select
            value={selectedBranchId}
            onChange={(e) => {
              setLoading(true);
              setSelectedBranchId(e.target.value);
            }}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white"
          >
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {loading ? <LoadingState /> : reports.length === 0 ? (
        <EmptyState title="보고 내역이 없습니다" description="최근 30일 데이터 기준" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">날짜</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">상태</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">제출시간</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reports.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link href={`/manager/reports/${r.id}`} className="block">
                      <span className="font-medium text-gray-800">{formatDate(r.reportDate)}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <ReportStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-400">
                    {r.submittedAt ? formatDateTime(r.submittedAt.toDate()) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
