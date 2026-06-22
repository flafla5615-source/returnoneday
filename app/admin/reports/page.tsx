"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAllBranches } from "@/services/branches";
import { getAllReports, updateReportStatus } from "@/services/reports";
import { getAllUsers } from "@/services/users";
import { useAuth } from "@/contexts/AuthContext";
import { ReportStatusBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import {
  formatDate,
  formatDateTime,
  todayYMD,
  calcPtConversionRate,
  formatPercent,
} from "@/lib/utils";
import type { Branch, DailyReport, UserProfile, ReportStatus } from "@/types";
import { format, subDays } from "date-fns";

export default function AdminReportsPage() {
  const { profile } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterBranch, setFilterBranch] = useState("");
  const [filterStatus, setFilterStatus] = useState<ReportStatus | "">("");
  const [filterFrom, setFilterFrom] = useState(format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [filterTo, setFilterTo] = useState(todayYMD());

  const [actionReport, setActionReport] = useState<DailyReport | null>(null);
  const [actionType, setActionType] = useState<"revision" | "lock" | "unlock" | null>(null);
  const [comment, setComment] = useState("");

  useEffect(() => {
    Promise.all([getAllBranches(), getAllUsers()]).then(([bs, us]) => {
      setBranches(bs);
      setUsers(us);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    getAllReports(filterFrom, filterTo).then((rs) => {
      setReports(rs);
      setLoading(false);
    });
  }, [filterFrom, filterTo]);

  const branchMap = Object.fromEntries(branches.map((b) => [b.id, b]));
  const userMap = Object.fromEntries(users.map((u) => [u.uid, u]));

  const filtered = reports.filter((r) => {
    if (filterBranch && r.branchId !== filterBranch) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    return true;
  });

  async function handleAction() {
    if (!actionReport || !actionType) return;
    let newStatus: ReportStatus;
    if (actionType === "revision") newStatus = "revision_required";
    else if (actionType === "lock") newStatus = "locked";
    else newStatus = "submitted";
    await updateReportStatus(actionReport.id, newStatus, profile!.uid, profile!.name, comment || undefined);
    setReports((prev) => prev.map((r) => r.id === actionReport.id ? { ...r, status: newStatus } : r));
    setActionReport(null);
    setActionType(null);
    setComment("");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-base font-bold text-gray-900">보고 관리</h1>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-wrap gap-3">
        <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <span className="self-center text-gray-400">~</span>
        <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">전체 지점</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as ReportStatus | "")} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">전체 상태</option>
          <option value="draft">임시저장</option>
          <option value="submitted">제출완료</option>
          <option value="revision_required">수정요청</option>
          <option value="locked">잠금</option>
        </select>
      </div>

      {loading ? <LoadingState /> : filtered.length === 0 ? <EmptyState title="보고 데이터가 없습니다" /> : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["날짜", "지점", "담당자", "상태", "유효회원", "문의", "PT상담", "PT등록", "전환율", "이슈", "제출시간", "액션"].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => {
                const branch = branchMap[r.branchId];
                const writer = userMap[r.writerUid];
                const convRate = calcPtConversionRate(r.ptConsultations, r.ptRegistrations);
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Link href={`/admin/reports/${r.id}`} className="text-blue-600 hover:underline">
                        {formatDate(r.reportDate)}
                      </Link>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{branch?.name ?? r.branchId}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{writer?.name ?? "-"}</td>
                    <td className="px-3 py-3"><ReportStatusBadge status={r.status} /></td>
                    <td className="px-3 py-3">{r.activeMembers ?? "-"}</td>
                    <td className="px-3 py-3">{r.inquiries ?? "-"}</td>
                    <td className="px-3 py-3">{r.ptConsultations ?? "-"}</td>
                    <td className="px-3 py-3">{r.ptRegistrations ?? "-"}</td>
                    <td className="px-3 py-3">{formatPercent(convRate)}</td>
                    <td className="px-3 py-3">-</td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-400">
                      {r.submittedAt ? formatDateTime(r.submittedAt.toDate()) : "-"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {r.status === "submitted" && (
                          <>
                            <button onClick={() => { setActionReport(r); setActionType("revision"); }} className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200">수정요청</button>
                            <button onClick={() => { setActionReport(r); setActionType("lock"); }} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200">잠금</button>
                          </>
                        )}
                        {r.status === "locked" && (
                          <button onClick={() => { setActionReport(r); setActionType("unlock"); }} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">재오픈</button>
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
              {actionType === "revision" ? "수정 요청" : actionType === "lock" ? "보고 잠금" : "보고 재오픈"}
            </h3>
            {actionType === "revision" && (
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">수정 요청 내용</label>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" placeholder="지점장에게 전달할 내용을 입력하세요" />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setActionReport(null); setActionType(null); }} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={handleAction} className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f]">확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
