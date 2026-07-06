"use client";

import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { DownloadIcon } from "lucide-react";
import { getAllBranches } from "@/services/branches";
import { getAllCampaigns, getCampaignResultsByDateRange } from "@/services/campaigns";
import { getAllIssues } from "@/services/issues";
import { getAllReports } from "@/services/reports";
import { getAllTrainerDailyReportsByPeriod } from "@/services/trainerDailyReports";
import { getAllTrainers } from "@/services/trainers";
import { getAllUsers } from "@/services/users";
import { calcPtConversionRate, formatDate, todayYMD, getExpiringTmTotal, getUnregisteredTmTotal, getOfflinePromoTotal } from "@/lib/utils";
import type { Worksheet } from "exceljs";
import type {
  Branch,
  Campaign,
  CampaignResult,
  DailyReport,
  Issue,
  ReportStatus,
  TrainerDailyReport,
  UserProfile,
} from "@/types";

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
  { header: "만료 전화TM", key: "etPhone", width: 10 },
  { header: "만료 문자TM", key: "etSms", width: 10 },
  { header: "만료 카카오TM", key: "etKakao", width: 12 },
  { header: "만료 기타TM", key: "etOther", width: 10 },
  { header: "만료TM 총합", key: "expiringTmTotal", width: 12 },
  { header: "미등록 전화TM", key: "utPhone", width: 12 },
  { header: "미등록 문자TM", key: "utSms", width: 12 },
  { header: "미등록 카카오TM", key: "utKakao", width: 14 },
  { header: "미등록 기타TM", key: "utOther", width: 12 },
  { header: "미등록TM 총합", key: "unregisteredTmTotal", width: 14 },
  { header: "전단지", key: "promoFlyer", width: 10 },
  { header: "현수막", key: "promoPlacard", width: 10 },
  { header: "배너", key: "promoBanner", width: 10 },
  { header: "제휴", key: "promoPartnership", width: 10 },
  { header: "외부 행사", key: "promoEvent", width: 10 },
  { header: "홍보 기타", key: "promoOther", width: 10 },
  { header: "홍보 총합", key: "offlinePromotionTotal", width: 12 },
  { header: "홍보 메모", key: "promotionMemo", width: 28 },
  { header: "제출 시간", key: "submittedAt", width: 22 },
  { header: "수정 시간", key: "updatedAt", width: 22 },
];

const issueColumns = [
  { header: "날짜", key: "date", width: 14 },
  { header: "브랜드", key: "brand", width: 16 },
  { header: "지역", key: "region", width: 16 },
  { header: "지점명", key: "branchName", width: 22 },
  { header: "유형", key: "type", width: 12 },
  { header: "카테고리", key: "category", width: 18 },
  { header: "중요도", key: "severity", width: 12 },
  { header: "처리 상태", key: "status", width: 12 },
  { header: "내용", key: "description", width: 40 },
  { header: "메모", key: "memo", width: 28 },
  { header: "생성 시간", key: "createdAt", width: 22 },
  { header: "해결 시간", key: "resolvedAt", width: 22 },
];

const campaignResultColumns = [
  { header: "날짜", key: "date", width: 14 },
  { header: "브랜드", key: "brand", width: 16 },
  { header: "지역", key: "region", width: 16 },
  { header: "지점명", key: "branchName", width: 22 },
  { header: "캠페인", key: "campaignName", width: 24 },
  { header: "지표", key: "metricLabel", width: 20 },
  { header: "값", key: "metricValue", width: 12 },
  { header: "수정 시간", key: "updatedAt", width: 22 },
];

// 트레이너 세션 시트 — 금액 컬럼은 절대 포함하지 않는다
const trainerMonthlyColumns = [
  { header: "기간", key: "period", width: 24 },
  { header: "브랜드", key: "brand", width: 16 },
  { header: "지점", key: "branchName", width: 22 },
  { header: "트레이너", key: "trainerName", width: 16 },
  { header: "PT 세션", key: "pt", width: 10 },
  { header: "OT / 체험 세션", key: "ot", width: 14 },
  { header: "그룹수업 세션", key: "group", width: 14 },
  { header: "기타 세션", key: "other", width: 10 },
  { header: "총 세션", key: "total", width: 10 },
  { header: "일 평균 세션", key: "avgPerDay", width: 12 },
];

const trainerDailyColumns = [
  { header: "날짜", key: "date", width: 14 },
  { header: "브랜드", key: "brand", width: 16 },
  { header: "지점", key: "branchName", width: 22 },
  { header: "트레이너", key: "trainerName", width: 16 },
  { header: "PT 세션", key: "pt", width: 10 },
  { header: "OT / 체험 세션", key: "ot", width: 14 },
  { header: "그룹수업 세션", key: "group", width: 14 },
  { header: "기타 세션", key: "other", width: 10 },
  { header: "총 세션", key: "total", width: 10 },
  { header: "메모", key: "memo", width: 28 },
];

const issueTypeLabel: Record<Issue["type"], string> = {
  claim: "클레임",
  staff: "인력",
  facility: "시설",
};

const issueSeverityLabel: Record<Issue["severity"], string> = {
  low: "낮음",
  medium: "중간",
  high: "높음",
  critical: "긴급",
};

const issueStatusLabel: Record<Issue["status"], string> = {
  open: "미해결",
  in_progress: "처리 중",
  resolved: "해결됨",
};

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

function styleWorksheet(sheet: Worksheet) {
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

      const [reports, bs, users, issues, campaigns, campaignResults, trainerReports, trainers] = await Promise.all([
        getAllReports(fromDate, toDate),
        getAllBranches(),
        getAllUsers(),
        getAllIssues({ fromDate, toDate }),
        getAllCampaigns(),
        getCampaignResultsByDateRange(fromDate, toDate),
        getAllTrainerDailyReportsByPeriod(fromDate, toDate),
        getAllTrainers(),
      ]);

      const branchMap = Object.fromEntries(bs.map((branch) => [branch.id, branch]));
      const userMap = Object.fromEntries(users.map((user: UserProfile) => [user.uid, user]));
      const campaignMap = Object.fromEntries(campaigns.map((campaign) => [campaign.id, campaign]));

      const filtered = reports.filter((report) => {
        if (report.isTestData === true) return false;
        const branch = branchMap[report.branchId];
        if (selectedBranch && report.branchId !== selectedBranch) return false;
        if (selectedBrand && branch?.brand !== selectedBrand) return false;
        if (selectedRegion && branch?.region !== selectedRegion) return false;
        if (selectedStatus && report.status !== selectedStatus) return false;
        return true;
      });

      const filteredIssues = issues.filter((issue) => {
        const branch = branchMap[issue.branchId];
        if (selectedBranch && issue.branchId !== selectedBranch) return false;
        if (selectedBrand && branch?.brand !== selectedBrand) return false;
        if (selectedRegion && branch?.region !== selectedRegion) return false;
        return true;
      });

      const filteredCampaignResults = campaignResults.filter((result) => {
        const branch = branchMap[result.branchId];
        if (selectedBranch && result.branchId !== selectedBranch) return false;
        if (selectedBrand && branch?.brand !== selectedBrand) return false;
        if (selectedRegion && branch?.region !== selectedRegion) return false;
        return true;
      });

      // 트레이너 세션: 테스트 제외 + submitted/locked 보고 연결분만 운영 집계
      // (branchMap은 활성 지점만 담고 있으므로 삭제/비활성 지점도 자동 제외)
      const trainerNameMap = Object.fromEntries(trainers.map((t) => [t.id, t.name]));
      const validReportKeys = new Set(
        reports
          .filter(
            (r) => !r.isTestData && (r.status === "submitted" || r.status === "locked")
          )
          .map((r) => `${r.branchId}_${r.reportDate}`)
      );
      const filteredTrainerReports = trainerReports.filter((r) => {
        if (r.isTestData === true) return false;
        if (!validReportKeys.has(`${r.branchId}_${r.reportDate}`)) return false;
        const branch = branchMap[r.branchId];
        if (!branch) return false;
        if (selectedBranch && r.branchId !== selectedBranch) return false;
        if (selectedBrand && branch.brand !== selectedBrand) return false;
        if (selectedRegion && branch.region !== selectedRegion) return false;
        return true;
      });

      if (
        filtered.length === 0 &&
        filteredIssues.length === 0 &&
        filteredCampaignResults.length === 0 &&
        filteredTrainerReports.length === 0
      ) {
        setError("선택한 조건에 해당하는 보고, 이슈, 캠페인, 트레이너 세션 데이터가 없습니다.");
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
          etPhone: report.expiringTm?.phone ?? "",
          etSms: report.expiringTm?.sms ?? "",
          etKakao: report.expiringTm?.kakao ?? "",
          etOther: report.expiringTm?.other ?? "",
          expiringTmTotal: getExpiringTmTotal(report) || "",
          utPhone: report.unregisteredTm?.phone ?? "",
          utSms: report.unregisteredTm?.sms ?? "",
          utKakao: report.unregisteredTm?.kakao ?? "",
          utOther: report.unregisteredTm?.other ?? "",
          unregisteredTmTotal: getUnregisteredTmTotal(report) || "",
          promoFlyer: report.offlinePromotion?.flyer ?? "",
          promoPlacard: report.offlinePromotion?.placard ?? "",
          promoBanner: report.offlinePromotion?.banner ?? "",
          promoPartnership: report.offlinePromotion?.partnership ?? "",
          promoEvent: report.offlinePromotion?.event ?? "",
          promoOther: report.offlinePromotion?.other ?? "",
          offlinePromotionTotal: getOfflinePromoTotal(report) || "",
          promotionMemo: report.promotionMemo ?? "",
          submittedAt: toKoreanDateTime(report.submittedAt),
          updatedAt: toKoreanDateTime(report.updatedAt),
        });
      });

      styleWorksheet(sheet);

      if (filteredIssues.length > 0) {
        const issueSheet = workbook.addWorksheet("운영 이슈");
        issueSheet.columns = issueColumns;
        issueSheet.views = [{ state: "frozen", ySplit: 1 }];

        filteredIssues.forEach((issue: Issue) => {
          const branch = branchMap[issue.branchId];
          issueSheet.addRow({
            date: formatDate(issue.reportDate),
            brand: branch?.brand ?? "",
            region: branch?.region ?? "",
            branchName: branch?.name ?? issue.branchId,
            type: issueTypeLabel[issue.type],
            category: issue.category,
            severity: issueSeverityLabel[issue.severity],
            status: issueStatusLabel[issue.status],
            description: issue.description,
            memo: issue.memo ?? "",
            createdAt: toKoreanDateTime(issue.createdAt),
            resolvedAt: toKoreanDateTime(issue.resolvedAt),
          });
        });

        styleWorksheet(issueSheet);
      }

      if (filteredCampaignResults.length > 0) {
        const campaignSheet = workbook.addWorksheet("캠페인 실적");
        campaignSheet.columns = campaignResultColumns;
        campaignSheet.views = [{ state: "frozen", ySplit: 1 }];

        filteredCampaignResults.forEach((result: CampaignResult) => {
          const branch = branchMap[result.branchId];
          const campaign = campaignMap[result.campaignId] as Campaign | undefined;

          Object.entries(result.metrics).forEach(([metricKey, value]) => {
            const metricLabel =
              campaign?.metricDefinitions.find((metric) => metric.key === metricKey)?.label ??
              metricKey;

            campaignSheet.addRow({
              date: formatDate(result.reportDate),
              brand: branch?.brand ?? "",
              region: branch?.region ?? "",
              branchName: branch?.name ?? result.branchId,
              campaignName: campaign?.name ?? result.campaignId,
              metricLabel,
              metricValue: value ?? "",
              updatedAt: toKoreanDateTime(result.updatedAt),
            });
          });
        });

        styleWorksheet(campaignSheet);
      }

      if (filteredTrainerReports.length > 0) {
        const pt = (r: TrainerDailyReport) => r.ptSessionCount ?? 0;
        const ot = (r: TrainerDailyReport) => r.otSessionCount ?? 0;
        const grp = (r: TrainerDailyReport) => r.groupSessionCount ?? 0;
        const oth = (r: TrainerDailyReport) => r.otherSessionCount ?? 0;
        const tot = (r: TrainerDailyReport) => r.totalSessionCount ?? 0;

        // 시트 1: 트레이너 세션 월 누적 (지점 × 트레이너 기준, 기간 내 합산)
        const monthlySheet = workbook.addWorksheet("트레이너 세션 월 누적");
        monthlySheet.columns = trainerMonthlyColumns;
        monthlySheet.views = [{ state: "frozen", ySplit: 1 }];

        const aggMap = new Map<string, {
          branchId: string; trainerId: string; trainerName: string;
          pt: number; ot: number; group: number; other: number; total: number;
          days: Set<string>;
        }>();
        filteredTrainerReports.forEach((r) => {
          const key = `${r.branchId}_${r.trainerId}`;
          let agg = aggMap.get(key);
          if (!agg) {
            agg = {
              branchId: r.branchId,
              trainerId: r.trainerId,
              trainerName: trainerNameMap[r.trainerId] ?? r.trainerName,
              pt: 0, ot: 0, group: 0, other: 0, total: 0,
              days: new Set(),
            };
            aggMap.set(key, agg);
          }
          agg.pt += pt(r);
          agg.ot += ot(r);
          agg.group += grp(r);
          agg.other += oth(r);
          agg.total += tot(r);
          agg.days.add(r.reportDate);
        });

        Array.from(aggMap.values())
          .sort((a, b) => b.total - a.total)
          .forEach((agg) => {
            const branch = branchMap[agg.branchId];
            monthlySheet.addRow({
              period: `${fromDate} ~ ${toDate}`,
              brand: branch?.brand ?? "",
              branchName: branch?.name ?? agg.branchId,
              trainerName: agg.trainerName,
              pt: agg.pt,
              ot: agg.ot,
              group: agg.group,
              other: agg.other,
              total: agg.total,
              avgPerDay: agg.days.size > 0 ? Number((agg.total / agg.days.size).toFixed(1)) : "",
            });
          });

        styleWorksheet(monthlySheet);

        // 시트 2: 트레이너 세션 일별 상세
        const dailySheet = workbook.addWorksheet("트레이너 세션 일별 상세");
        dailySheet.columns = trainerDailyColumns;
        dailySheet.views = [{ state: "frozen", ySplit: 1 }];

        [...filteredTrainerReports]
          .sort((a, b) =>
            a.reportDate !== b.reportDate
              ? a.reportDate.localeCompare(b.reportDate)
              : a.branchId.localeCompare(b.branchId)
          )
          .forEach((r) => {
            const branch = branchMap[r.branchId];
            dailySheet.addRow({
              date: formatDate(r.reportDate),
              brand: branch?.brand ?? "",
              branchName: branch?.name ?? r.branchId,
              trainerName: trainerNameMap[r.trainerId] ?? r.trainerName,
              pt: pt(r),
              ot: ot(r),
              group: grp(r),
              other: oth(r),
              total: tot(r),
              memo: r.memo ?? "",
            });
          });

        styleWorksheet(dailySheet);
      }

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
