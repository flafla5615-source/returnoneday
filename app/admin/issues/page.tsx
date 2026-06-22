"use client";

import { useEffect, useState } from "react";
import { getAllIssues, updateIssueStatus } from "@/services/issues";
import { getAllBranches } from "@/services/branches";
import { SeverityBadge, IssueStatusBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import { formatDate } from "@/lib/utils";
import type { Issue, IssueStatus, IssueType, Branch } from "@/types";

const typeLabel = (t: IssueType) =>
  t === "claim" ? "클레임" : t === "staff" ? "인력" : "시설";

export default function AdminIssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<IssueType | "">("");
  const [filterStatus, setFilterStatus] = useState<IssueStatus | "">("");

  useEffect(() => {
    Promise.all([getAllIssues(), getAllBranches()]).then(([iss, bs]) => {
      setIssues(iss);
      setBranches(bs);
      setLoading(false);
    });
  }, []);

  const branchMap = Object.fromEntries(branches.map((b) => [b.id, b.name]));

  const filtered = issues.filter((i) => {
    if (filterType && i.type !== filterType) return false;
    if (filterStatus && i.status !== filterStatus) return false;
    return true;
  });

  async function handleStatusChange(issueId: string, newStatus: IssueStatus) {
    await updateIssueStatus(issueId, newStatus);
    setIssues((prev) =>
      prev.map((i) => (i.id === issueId ? { ...i, status: newStatus } : i))
    );
  }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <h1 className="text-base font-bold text-gray-900">운영 이슈 관리</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value as IssueType | "")} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">전체 유형</option>
          <option value="claim">클레임</option>
          <option value="staff">인력 이슈</option>
          <option value="facility">시설 이슈</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as IssueStatus | "")} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">전체 상태</option>
          <option value="open">미해결</option>
          <option value="in_progress">처리중</option>
          <option value="resolved">해결됨</option>
        </select>
      </div>

      {filtered.length === 0 ? <EmptyState title="이슈가 없습니다" /> : (
        <div className="space-y-3">
          {filtered.map((iss) => (
            <div key={iss.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      {typeLabel(iss.type)}
                    </span>
                    {iss.category && <span className="text-xs text-gray-500">{iss.category}</span>}
                    <span className="text-xs text-gray-400">{branchMap[iss.branchId] ?? iss.branchId}</span>
                  </div>
                  <p className="text-sm text-gray-800 mb-1">{iss.description}</p>
                  <p className="text-xs text-gray-400">{formatDate(iss.reportDate)}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-1">
                    <SeverityBadge severity={iss.severity} />
                    <IssueStatusBadge status={iss.status} />
                  </div>
                  <select
                    value={iss.status}
                    onChange={(e) => handleStatusChange(iss.id, e.target.value as IssueStatus)}
                    className="border border-gray-200 rounded text-xs px-2 py-1 bg-white"
                  >
                    <option value="open">미해결</option>
                    <option value="in_progress">처리중</option>
                    <option value="resolved">해결됨</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
