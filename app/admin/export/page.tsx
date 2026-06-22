"use client";

import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { DownloadIcon } from "lucide-react";
import { getAllBranches } from "@/services/branches";
import { getAllReports } from "@/services/reports";
import { getAllUsers } from "@/services/users";
import { calcPtConversionRate, formatDate, todayYMD } from "@/lib/utils";
import type { Branch, DailyReport, ReportStatus, UserProfile } from "@/types";

const statusLabel: Record<ReportStatus, string> = {
  draft: "임시저장",
  submitted: "제출완료",
  revision_required: "수정요청",
  locked: "잠금",
};

const exportColumns = [
  { header: "날짜", key: "date", width: 14 },
  { header: "브랜드", key: "brand", width: 16 },
  { header: "지역", key: "region", width: 16 },
  { header: "지점명", key: "branchName", width: 22 },
  { header: "지점장", key: "writerName", width: 16 },
  { header: "보고상태", key: "status", width: 14 },
  { header: "유효회원", key: "activeMembers", width: 12 },
  { header: "문의", key: "inquiries", width: 10 },
  { header: "PT 상담", key: "ptConsultations", width: 10 },
  { header: "PT 등록", key: "ptRegistrations", width: 10 },
  { header: "PT 전환율", key: "ptConversionRate", width: 12 },
  { header: "재등록", key: "reRegistrations", width: 10 },
  { header: "컴백회원", key: "comebackMembers", width: 10 },
  { header: "전체 해피콜", key: "happyCalls", width: 12 },
  { header: "신규 해피콜", key: "newHappyCalls", width: 12 },
  { header: "기존 해피콜", key: "existingHappyCalls", width: 12 },
  { header: "만료 TM", key: "expiringTmCount", width: 10 },
  { header: "만료 TM 방식", key: "expiringTmMethods", width: 20 },
  { header: "미등록 TM", key: "unregisteredTmCount", width: 10 },
  { header: "미등록 TM 방식", key: "unregisteredTmMethods", width: 20 },
  { header: "오프라인 홍보", key: "offlinePromotionCount", width: 14 },
  { header: "홍보 방식", key: "offlinePromotionMethods", width: 20 },
  { header: "홍보 메모", key: "promotionMemo", width: 28 },
  { header: "제출 시간", key: "submittedAt", width: 22 },
  { header: "수정 시간", key: "updatedAt", width: 22 },
];

function uniqueSorted(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) =>
    a.localeCompare(b, "ko-KR")
  );
}

function toKoreanDateTime(date?: { toDate: () => Date }) {
  return date
    ? date.toDate().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "";
}

export default function AdminExportPage() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(todayYMD());
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<ReportStatus | "">("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const brands = useMemo(() => uniqueSorted(branches.map((branch) => branch.brand)), [branches]);
  const regions = useMemo(
    () =>
      uniqueSorted(
        branches
          .filter((branch) => !selectedBrand || branch.brand === selectedBrand)
          .map((branch) => branch.region)
      ),
    [branches, selectedBrand]
  );
  const visibleBranches = useMemo(
    () =>
      branches.filter(
        (branch) =>
          (!selectedBrand || branch.brand === selectedBrand) &&
          (!selectedRegion || branch.region === selectedRegion)
      ),
    [branches, selectedBrand, selectedRegion]
  );

  async function loadBranches() {
    if (branchesLoaded) return;
    const bs = await getAllBranches();
    setBranches(bs);
    setBranchesLoaded(true);
  }

  function resetBranchIfHidden(nextBrand: string, nextRegion: string) {
    const branch = branches.find((b) => b.id === selectedBranch);
    if (!branch) return;
    if ((nextBrand && branch.brand !== nextBrand) || (nextRegion && branch.region !== nextRegion)) {
      setSelectedBranch("");
    }
  }

  async function handleExport() {
    setLoading(true);
    setError("");
    try {
      if (fromDate > toDate) {
        setError("시작일은 종료일보다 늦을 수 없습니다.");
        return;
      }

      const [reports, bs, users] = await Promise.all([
        getAllReports(fromDate, toDate),
        getAllBranches(),
        getAllUsers(),
      ]);

      const branchMap = Object.fromEntries(bs.map((branch) => [branch.id, branch]));
      const userMap = Object.fromEntries(users.map((user: UserProfile) => [user.uid, user]));

      const filtered = reports.filter((report) => {
        const branch = branchMap[report.branchId];
        if (selectedBranch && report.branchId !== selectedBranch) return false;
        if (selectedBrand && branch?.brand !== selectedBrand) return false;
        if (selectedRegion && branch?.region !== selectedRegion) return false;
        if (selectedStatus && report.status !== selectedStatus) return false;
        return true;
      });

      if (filtered.length === 0) {
        setError("선택한 조건에 해당하는 보고 데이터가 없습니다.");
        return;
      }

      const { Workbook } = await import("exceljs");
      const workbook = new Workbook();
      workbook.creator = "RETURN LIFE";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet("일일보고");
      sheet.columns = exportColumns;
      sheet.views = [{ state: "frozen", ySplit: 1 }];

      filtered.forEach((report: DailyReport) => {
        const branch = branchMap[report.branchId];
        const writer = userMap[report.writerUid];
        const convRate = calcPtConversionRate(report.ptConsultations, report.ptRegistrations);
        sheet.addRow({
          date: formatDate(report.reportDate),
          brand: branch?.brand ?? "",
          region: branch?.region ?? "",
          branchName: branch?.name ?? report.branchId,
          writerName: writer?.name ?? "-",
          status: statusLabel[report.status],
          activeMembers: report.activeMembers ?? "",
          inquiries: report.inquiries ?? "",
          ptConsultations: report.ptConsultations ?? "",
          ptRegistrations: report.ptRegistrations ?? "",
          ptConversionRate: convRate !== null ? `${convRate.toFixed(1)}%` : "-",
          reRegistrations: report.reRegistrations ?? "",
          comebackMembers: report.comebackMembers ?? "",
          happyCalls: report.happyCalls ?? "",
          newHappyCalls: report.newHappyCalls ?? "",
          existingHappyCalls: report.existingHappyCalls ?? "",
          expiringTmCount: report.expiringTmCount ?? "",
          expiringTmMethods: report.expiringTmMethods.join(", "),
          unregisteredTmCount: report.unregisteredTmCount ?? "",
          unregisteredTmMethods: report.unregisteredTmMethods.join(", "),
          offlinePromotionCount: report.offlinePromotionCount ?? "",
          offlinePromotionMethods: report.offlinePromotionMethods.join(", "),
          promotionMemo: report.promotionMemo ?? "",
          submittedAt: toKoreanDateTime(report.submittedAt),
          updatedAt: toKoreanDateTime(report.updatedAt),
        });
      });

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E3A5F" },
      };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };

      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFE5E7EB" } },
            left: { style: "thin", color: { argb: "FFE5E7EB" } },
            bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
            right: { style: "thin", color: { argb: "FFE5E7EB" } },
          };
          cell.alignment = { vertical: "middle" };
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `RETURNLIFE_일일보고_${fromDate}_${toDate}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      console.error("[Export] Failed to create workbook", exportError);
      setError("엑셀 파일을 만드는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-base font-bold text-gray-900">데이터 다운로드</h1>
        <p className="text-xs text-gray-400 mt-1">기간, 브랜드, 지역, 지점, 상태별로 일일보고를 엑셀로 내려받습니다.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">시작일</label>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">종료일</label>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">브랜드</label>
            <select
              value={selectedBrand}
              onFocus={loadBranches}
              onChange={(event) => {
                const nextBrand = event.target.value;
                setSelectedBrand(nextBrand);
                resetBranchIfHidden(nextBrand, selectedRegion);
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">전체 브랜드</option>
              {brands.map((brand) => (
                <option key={brand} value={brand}>{brand}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">지역</label>
            <select
              value={selectedRegion}
              onFocus={loadBranches}
              onChange={(event) => {
                const nextRegion = event.target.value;
                setSelectedRegion(nextRegion);
                resetBranchIfHidden(selectedBrand, nextRegion);
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">전체 지역</option>
              {regions.map((region) => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">지점</label>
            <select
              value={selectedBranch}
              onFocus={loadBranches}
              onChange={(event) => setSelectedBranch(event.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">전체 지점</option>
              {visibleBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">보고 상태</label>
            <select
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value as ReportStatus | "")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">전체 상태</option>
              {Object.entries(statusLabel).map(([status, label]) => (
                <option key={status} value={status}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <button
          type="button"
          onClick={handleExport}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-[#1e3a5f] text-white rounded-lg text-sm font-semibold hover:bg-[#16304f] transition-colors disabled:opacity-50"
        >
          <DownloadIcon className="w-4 h-4" />
          {loading ? "엑셀 생성 중..." : "엑셀 다운로드"}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <p className="text-xs font-medium text-gray-700 mb-2">포함 항목</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs text-gray-500">
          {exportColumns.map((column) => (
            <div key={column.key} className="flex items-center gap-1">
              <div className="w-1 h-1 rounded-full bg-gray-300" />
              {column.header}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
