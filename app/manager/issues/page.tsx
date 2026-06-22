"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getAllIssues } from "@/services/issues";
import { IssueStatusBadge, SeverityBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import { formatDate } from "@/lib/utils";
import type { Issue } from "@/types";

const typeLabel = (t: Issue["type"]) =>
  t === "claim" ? "클레임" : t === "staff" ? "인력" : "시설";

export default function ManagerIssuesPage() {
  const { profile } = useAuth();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.branchIds.length) return;
    // Load issues for first branch; can extend to multiple
    getAllIssues({ branchId: profile.branchIds[0] }).then((iss) => {
      setIssues(iss);
      setLoading(false);
    });
  }, [profile]);

  if (loading) return <LoadingState />;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-base font-bold text-gray-900">운영 이슈</h1>

      {issues.length === 0 ? (
        <EmptyState title="운영 이슈가 없습니다" description="훌륭합니다!" />
      ) : (
        <div className="space-y-3">
          {issues.map((iss) => (
            <div key={iss.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    {typeLabel(iss.type)}
                  </span>
                  {iss.category && (
                    <span className="text-xs text-gray-500">{iss.category}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <SeverityBadge severity={iss.severity} />
                  <IssueStatusBadge status={iss.status} />
                </div>
              </div>
              <p className="text-sm text-gray-800 mb-1">{iss.description}</p>
              <p className="text-xs text-gray-400">{formatDate(iss.reportDate)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
