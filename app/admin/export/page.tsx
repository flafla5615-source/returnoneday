"use client";

import { useState } from "react";
import { getAllBranches } from "@/services/branches";
import { getAllReports } from "@/services/reports";
import { getAllUsers } from "@/services/users";
import { calcPtConversionRate, todayYMD, formatDate } from "@/lib/utils";
import type { DailyReport, Branch, UserProfile } from "@/types";
import { DownloadIcon } from "lucide-react";
import { format, subDays } from "date-fns";

export default function AdminExportPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(todayYMD());
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [branchesLoaded, setBranchesLoaded] = useState(false);

  async function loadBranches() {
    if (branchesLoaded) return;
    const bs = await getAllBranches();
    setBranches(bs);
    setBranchesLoaded(true);
  }

  async function handleExport() {
    setLoading(true);
    try {
      const [reports, bs, users] = await Promise.all([
        getAllReports(fromDate, toDate),
        getAllBranches(),
        getAllUsers(),
      ]);

      const branchMap = Object.fromEntries(bs.map((b) => [b.id, b]));
      const userMap = Object.fromEntries(users.map((u: UserProfile) => [u.uid, u]));

      const filtered = selectedBranch
        ? reports.filter((r) => r.branchId === selectedBranch)
        : reports;

      const statusLabel: Record<string, string> = {
        draft: "임시저장",
        submitted: "제출완료",
        revision_required: "수정요청",
        locked: "잠금",
      };

      const rows = filtered.map((r: DailyReport) => {
        const branch = branchMap[r.branchId];
        const writer = userMap[r.writerUid];
        const convRate = calcPtConversionRate(r.ptConsultations, r.ptRegistrations);
        return {
          날짜: formatDate(r.reportDate),
          지점명: branch?.name ?? r.branchId,
          지점장: writer?.name ?? "-",
          보고상태: statusLabel[r.status] ?? r.status,
          유효회원: r.activeMembers ?? "",
          문의수: r.inquiries ?? "",
          PT상담: r.ptConsultations ?? "",
          PT등록: r.ptRegistrations ?? "",
          PT전환율: convRate !== null ? `${convRate.toFixed(1)}%` : "-",
          재등록: r.reRegistrations ?? "",
          컴백회원: r.comebackMembers ?? "",
          해피콜: r.happyCalls ?? "",
          신규해피콜: r.newHappyCalls ?? "",
          기존해피콜: r.existingHappyCalls ?? "",
          만료TM: r.expiringTmCount ?? "",
          TM방식: r.expiringTmMethods.join(", "),
          미등록TM: r.unregisteredTmCount ?? "",
          오프라인홍보: r.offlinePromotionCount ?? "",
          홍보방식: r.offlinePromotionMethods.join(", "),
          제출시간: r.submittedAt ? r.submittedAt.toDate().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "",
        };
      });

      // Convert to CSV (no external lib needed for basic export)
      if (rows.length === 0) {
        alert("내보낼 데이터가 없습니다.");
        return;
      }

      const headers = Object.keys(rows[0]);
      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          headers.map((h) => {
            const val = String(row[h as keyof typeof row] ?? "");
            return `"${val.replace(/"/g, '""')}"`;
          }).join(",")
        ),
      ].join("\n");

      const BOM = "﻿";
      const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RETURNLIFE_보고서_${fromDate}_${toDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <h1 className="text-base font-bold text-gray-900">데이터 내보내기</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">시작일</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">종료일</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">지점 선택 (선택사항)</label>
          <select
            value={selectedBranch}
            onFocus={loadBranches}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">전체 지점</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        <div className="bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700">
          선택한 기간의 보고 데이터를 CSV 형식으로 내보냅니다. Excel에서 열 때 UTF-8 인코딩으로 열어주세요.
        </div>

        <button
          onClick={handleExport}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-[#1e3a5f] text-white rounded-lg text-sm font-semibold hover:bg-[#16304f] transition-colors disabled:opacity-50"
        >
          <DownloadIcon className="w-4 h-4" />
          {loading ? "내보내는 중..." : "CSV 내보내기"}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <p className="text-xs font-medium text-gray-700 mb-2">포함 항목</p>
        <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
          {["날짜", "지점명", "지점장", "보고상태", "유효회원", "문의수", "PT상담", "PT등록", "PT전환율", "재등록", "컴백회원", "해피콜", "TM", "오프라인홍보", "제출시간"].map((item) => (
            <div key={item} className="flex items-center gap-1">
              <div className="w-1 h-1 rounded-full bg-gray-300" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
