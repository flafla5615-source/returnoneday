"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import { getShiftReportsForDay, resolveSubmissionState } from "@/services/shiftReports";
import ShiftNotice from "@/components/reports/ShiftNotice";
import { ShiftStateBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import { formatDate, formatDateTime, getKoreaToday } from "@/lib/utils";
import {
  SHIFT_DEADLINE,
  SHIFT_LABEL,
  SHIFT_TYPES,
  type Branch,
  type BranchShiftReport,
  type ShiftType,
} from "@/types";
import { ClipboardListIcon } from "lucide-react";

type ReportMap = Record<ShiftType, BranchShiftReport | null>;

export default function ManagerHomePage() {
  const { profile } = useAuth();
  const today = getKoreaToday();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [reports, setReports] = useState<ReportMap>({ morning: null, closing: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    getBranchesByIds(profile.branchIds)
      .then((bs) => {
        setBranches(bs);
        if (bs.length > 0) setBranchId((prev) => prev || bs[0].id);
        else setLoading(false);
      })
      .catch((err) => {
        console.error("manager home branches load failed:", err);
        setError("지점 정보를 불러오지 못했습니다. 관리자에게 지점 배정을 요청하세요.");
        setLoading(false);
      });
  }, [profile]);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const loaded = await getShiftReportsForDay(branchId, today);
        if (!cancelled) setReports(loaded);
      } catch (err) {
        console.error("manager home shift reports load failed:", err);
        if (!cancelled) setError("오늘 보고 현황을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId, today]);

  if (!profile) return <LoadingState />;

  if (error) {
    return (
      <div className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm font-semibold text-red-700">데이터 로드 실패</p>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (!loading && branches.length === 0) {
    return (
      <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <p className="text-sm font-semibold text-amber-700">배정된 지점 없음</p>
        <p className="text-sm text-amber-600">
          관리자에게 지점 배정을 요청하세요. 배정 후 다시 로그인해주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold text-gray-900">{profile.name}님, 오늘도 화이팅입니다!</p>
          <p className="text-xs text-gray-400">{formatDate(today)} 기준</p>
        </div>
        {branches.length > 1 && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <ShiftNotice />

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-gray-700">오늘 보고 현황</p>

        {loading ? (
          <LoadingState />
        ) : (
          <div className="space-y-2">
            {SHIFT_TYPES.map((shift) => {
              const report = reports[shift];
              const state = resolveSubmissionState(report, today, shift);
              return (
                <div
                  key={shift}
                  className="flex items-center justify-between gap-3 border-b border-gray-100 py-2 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">{SHIFT_LABEL[shift]}</p>
                    <p className="text-xs text-gray-400">
                      기한 {SHIFT_DEADLINE[shift]}
                      {report?.submittedAt &&
                        ` · 제출 ${formatDateTime(report.submittedAt.toDate())}`}
                    </p>
                  </div>
                  <ShiftStateBadge state={state} />
                </div>
              );
            })}
          </div>
        )}

        <Link
          href="/manager/shift-reports"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
        >
          <ClipboardListIcon className="h-4 w-4" />
          지점별 일일보고 작성하기
        </Link>
      </div>
    </div>
  );
}
