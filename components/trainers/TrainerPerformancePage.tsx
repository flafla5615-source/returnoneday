"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getAllBranchesIncludingInactive, getBranchesByIds } from "@/services/branches";
import { getAllTrainers } from "@/services/trainers";
import { getAllTrainerSessionsByPeriod, getTrainerSessionsByPeriod } from "@/services/trainerSessions";
import {
  resolvePeriod,
  sumSessions,
  aggregateByTrainer,
  aggregateByBranch,
  rankWithTies,
  RANK_TABS,
  PERIOD_LABELS,
  ptOf, otOf, groupOf, otherOf, totalSessionOf,
  walkInSalesOf, personalSalesOf, totalSalesOf, totalRegOf,
  type PeriodPreset,
  type RankMetric,
  type TrainerPerformanceRow,
} from "@/services/trainerPerformance";
import LoadingState from "@/components/common/LoadingState";
import PrintButton from "@/components/print/PrintButton";
import PrintHeader from "@/components/print/PrintHeader";
import PrintableSection from "@/components/print/PrintableSection";
import { cn, formatDate, formatNumber, getKoreaToday } from "@/lib/utils";
import type { Branch, Trainer, TrainerSession } from "@/types";
import {
  ChevronDownIcon, ChevronRightIcon, SearchIcon, DownloadIcon,
} from "lucide-react";

type Mode = "admin" | "manager";

const PERIOD_ORDER: PeriodPreset[] = ["today", "thisWeek", "thisMonth", "lastMonth", "custom"];

function fmtAvg(v: number | null): string {
  return v === null ? "-" : v.toFixed(1).replace(/\.0$/, "");
}

export default function TrainerPerformancePage({ mode }: { mode: Mode }) {
  const { profile } = useAuth();
  const today = getKoreaToday();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [sessions, setSessions] = useState<TrainerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // 기본값: 이번달 · 전체 지점
  const [preset, setPreset] = useState<PeriodPreset>("thisMonth");
  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 7)}-01`);
  const [customTo, setCustomTo] = useState(today);
  const [branchFilter, setBranchFilter] = useState("");
  const [search, setSearch] = useState("");
  const [rankMetric, setRankMetric] = useState<RankMetric>("totalSessions");
  const [expandedTrainerId, setExpandedTrainerId] = useState<string | null>(null);
  const [printSections, setPrintSections] = useState<string[]>(["trainer"]);

  // branch_manager는 담당 지점 데이터만 조회한다 (타 지점 차단)
  const managerBranchIds = useMemo(
    () => (mode === "manager" ? profile?.branchIds ?? [] : []),
    [mode, profile]
  );

  const { from, to } = useMemo(
    () => resolvePeriod(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const [bs, ts] = await Promise.all([
          mode === "admin" ? getAllBranchesIncludingInactive() : getBranchesByIds(managerBranchIds),
          getAllTrainers(),
        ]);
        if (cancelled) return;
        setBranches(bs);
        setTrainers(ts);
      } catch (err) {
        console.error("[TrainerPerformance] base load failed", err);
        if (!cancelled) setError("지점·트레이너 정보를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile, mode, managerBranchIds]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      setPeriodLoading(true);
      setError(null);
      try {
        const rows =
          mode === "admin"
            ? await getAllTrainerSessionsByPeriod(from, to)
            : (await Promise.all(
                managerBranchIds.map((id) => getTrainerSessionsByPeriod(id, from, to))
              )).flat();
        if (cancelled) return;
        setSessions(rows.filter((r) => !r.isTestData));
      } catch (err) {
        if (cancelled) return;
        console.error("[TrainerPerformance] period load failed", err);
        const code = (err as { code?: string })?.code ?? "unknown";
        setError(
          code === "permission-denied"
            ? "트레이너 실적 조회 권한이 없습니다."
            : `데이터 로드 오류: ${code}`
        );
      } finally {
        if (!cancelled) setPeriodLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile, mode, managerBranchIds, from, to]);

  const branchNameOf = useMemo(() => {
    const m = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string) => m.get(id) ?? id;
  }, [branches]);

  const branchBrandOf = useMemo(() => {
    const m = new Map(branches.map((b) => [b.id, b.brand]));
    return (id: string) => m.get(id) ?? "-";
  }, [branches]);

  // trainers 컬렉션의 최신 이름을 우선 사용 (세션 문서의 이름은 저장 시점 스냅샷)
  const trainerNameOf = useMemo(() => {
    const m = new Map(trainers.map((t) => [t.id, t.name]));
    return (r: TrainerSession) => m.get(r.trainerId) ?? r.trainerName;
  }, [trainers]);

  const visibleBranchIds = useMemo(
    () => new Set(branches.map((b) => b.id)),
    [branches]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((r) => {
      if (!visibleBranchIds.has(r.branchId)) return false;
      if (branchFilter && r.branchId !== branchFilter) return false;
      if (q) {
        const name = trainerNameOf(r).toLowerCase();
        const bName = branchNameOf(r.branchId).toLowerCase();
        if (!name.includes(q) && !bName.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, visibleBranchIds, branchFilter, search, trainerNameOf, branchNameOf]);

  // 모든 수치는 여기서 조회 시 계산한다 (누적 저장 없음)
  const totals = useMemo(() => sumSessions(filtered), [filtered]);
  const trainerRows = useMemo(
    () => aggregateByTrainer(filtered, trainerNameOf),
    [filtered, trainerNameOf]
  );
  const branchRows = useMemo(() => aggregateByBranch(filtered), [filtered]);

  const rankedRows = useMemo(
    () => rankWithTies(trainerRows, (r) => r[rankMetric]),
    [trainerRows, rankMetric]
  );

  const detailRows = useMemo(() => {
    if (!expandedTrainerId) return [];
    return filtered
      .filter((r) => r.trainerId === expandedTrainerId)
      .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.branchId.localeCompare(b.branchId)));
  }, [filtered, expandedTrainerId]);

  async function handleDownload() {
    setDownloading(true);
    try {
      const { Workbook } = await import("exceljs");
      const wb = new Workbook();
      wb.creator = "RETURN LIFE";
      wb.created = new Date();

      const styleSheet = (sheet: import("exceljs").Worksheet) => {
        const header = sheet.getRow(1);
        header.font = { bold: true, color: { argb: "FFFFFFFF" } };
        header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        header.alignment = { vertical: "middle", horizontal: "center" };
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
      };

      // 시트1 — 트레이너 순위 (현재 선택한 순위 기준, 공동순위 반영)
      const s1 = wb.addWorksheet("트레이너 순위");
      s1.columns = [
        { header: "순위", key: "rank", width: 8 },
        { header: "트레이너", key: "trainerName", width: 18 },
        { header: "총 세션", key: "totalSessions", width: 12 },
        { header: "총 등록", key: "totalReg", width: 12 },
        { header: "워크인 매출", key: "walkInSales", width: 16 },
        { header: "개인 매출", key: "personalSales", width: 16 },
        { header: "총 매출", key: "totalSales", width: 16 },
        { header: "활동 지점수", key: "branchCount", width: 12 },
        { header: "활동 지점", key: "branchNames", width: 30 },
      ];
      s1.views = [{ state: "frozen", ySplit: 1 }];
      rankedRows.forEach(({ rank, row }) => {
        s1.addRow({
          rank,
          trainerName: row.trainerName,
          totalSessions: row.totalSessions,
          totalReg: row.totalReg,
          walkInSales: row.walkInSales,
          personalSales: row.personalSales,
          totalSales: row.totalSales,
          branchCount: row.branchCount,
          branchNames: row.branchIds.map(branchNameOf).join(", "),
        });
      });
      styleSheet(s1);

      // 시트2 — 일별 상세 (원본 trainerSessions 그대로)
      const s2 = wb.addWorksheet("일별 상세");
      s2.columns = [
        { header: "날짜", key: "date", width: 14 },
        { header: "지점", key: "branchName", width: 20 },
        { header: "브랜드", key: "brand", width: 16 },
        { header: "트레이너", key: "trainerName", width: 18 },
        { header: "PT", key: "pt", width: 8 },
        { header: "OT/체험", key: "ot", width: 10 },
        { header: "GX/그룹", key: "group", width: 10 },
        { header: "기타", key: "other", width: 8 },
        { header: "총 세션", key: "totalSessions", width: 10 },
        { header: "워크인 등록", key: "walkInReg", width: 12 },
        { header: "워크인 매출", key: "walkInSales", width: 16 },
        { header: "개인 등록", key: "personalReg", width: 12 },
        { header: "개인 매출", key: "personalSales", width: 16 },
        { header: "총 등록", key: "totalReg", width: 10 },
        { header: "총 매출", key: "totalSales", width: 16 },
        { header: "메모", key: "memo", width: 30 },
      ];
      s2.views = [{ state: "frozen", ySplit: 1 }];
      [...filtered]
        .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.branchId.localeCompare(b.branchId)))
        .forEach((r) => {
          s2.addRow({
            date: r.date,
            branchName: branchNameOf(r.branchId),
            brand: branchBrandOf(r.branchId),
            trainerName: trainerNameOf(r),
            pt: ptOf(r),
            ot: otOf(r),
            group: groupOf(r),
            other: otherOf(r),
            totalSessions: totalSessionOf(r),
            walkInReg: r.walkInRegistrationCount ?? 0,
            walkInSales: walkInSalesOf(r),
            personalReg: r.personalRegistrationCount ?? 0,
            personalSales: personalSalesOf(r),
            totalReg: totalRegOf(r),
            totalSales: totalSalesOf(r),
            memo: r.memo ?? "",
          });
        });
      styleSheet(s2);

      // 시트3 — 지점별 요약
      const s3 = wb.addWorksheet("지점별 요약");
      s3.columns = [
        { header: "지점", key: "branchName", width: 20 },
        { header: "브랜드", key: "brand", width: 16 },
        { header: "총 세션", key: "totalSessions", width: 12 },
        { header: "총 등록", key: "totalReg", width: 12 },
        { header: "워크인 매출", key: "walkInSales", width: 16 },
        { header: "개인 매출", key: "personalSales", width: 16 },
        { header: "총 매출", key: "totalSales", width: 16 },
        { header: "트레이너 수", key: "trainerCount", width: 12 },
      ];
      s3.views = [{ state: "frozen", ySplit: 1 }];
      branchRows.forEach((b) => {
        s3.addRow({
          branchName: branchNameOf(b.branchId),
          brand: branchBrandOf(b.branchId),
          totalSessions: b.totalSessions,
          totalReg: b.totalReg,
          walkInSales: b.walkInSales,
          personalSales: b.personalSales,
          totalSales: b.totalSales,
          trainerCount: b.trainerCount,
        });
      });
      styleSheet(s3);

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `트레이너실적_${getKoreaToday().replace(/-/g, "")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[TrainerPerformance] excel download failed", err);
      setError("엑셀 다운로드에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <LoadingState />;

  const kpis = [
    { label: "총 세션", value: `${formatNumber(totals.totalSessions)}회`, highlight: true },
    { label: "총 등록", value: `${formatNumber(totals.totalReg)}건` },
    { label: "워크인 매출", value: `${formatNumber(totals.walkInSales)}원` },
    { label: "개인 매출", value: `${formatNumber(totals.personalSales)}원` },
    { label: "총 매출", value: `${formatNumber(totals.totalSales)}원`, highlight: true },
    { label: "활동 트레이너", value: `${formatNumber(trainerRows.length)}명` },
  ];

  return (
    <div className="space-y-5">
      <PrintHeader title="트레이너 실적" subtitle={`${formatDate(from)} ~ ${formatDate(to)}`} />

      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-gray-900">트레이너 실적</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatDate(from)} ~ {formatDate(to)} ·{" "}
            {mode === "admin" ? "전 지점" : "담당 지점"} · 세션 + 등록 + 매출
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            disabled={downloading || filtered.length === 0}
            className="no-print flex items-center gap-1.5 px-3 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-40"
          >
            <DownloadIcon className="w-4 h-4" />
            {downloading ? "생성 중..." : "엑셀 다운로드"}
          </button>
          <PrintButton
            sections={[{ key: "trainer", label: "트레이너 실적" }]}
            selectedSections={printSections}
            onSelectionChange={setPrintSections}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3 no-print">
        <div className="flex flex-wrap gap-2">
          {PERIOD_ORDER.map((key) => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs border transition-colors",
                preset === key
                  ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              )}
            >
              {PERIOD_LABELS[key]}
            </button>
          ))}
          {preset === "custom" && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <input
                type="date" value={customFrom} max={today}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs"
              />
              <span className="text-xs text-gray-400">~</span>
              <input
                type="date" value={customTo} max={today}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
          >
            <option value="">전체 지점</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <div className="relative">
            <SearchIcon className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text" value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="트레이너명·지점명 검색"
              className="border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-xs w-44 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            />
          </div>
        </div>
      </div>

      <PrintableSection sectionKey="trainer" selectedSections={printSections} className="space-y-5">
        {periodLoading ? (
          <LoadingState />
        ) : (
          <>
            {/* KPI */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {kpis.map((c) => (
                <div
                  key={c.label}
                  className={cn(
                    "bg-white rounded-xl border shadow-sm px-4 py-3",
                    c.highlight ? "border-[#1e3a5f]/40" : "border-gray-200"
                  )}
                >
                  <p className="text-xs text-gray-500">{c.label}</p>
                  <p className={cn("text-sm font-bold mt-1", c.highlight ? "text-[#1e3a5f]" : "text-gray-800")}>
                    {c.value}
                  </p>
                </div>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-14 text-center text-sm text-gray-400">
                선택한 기간에 등록된 트레이너 실적이 없습니다.
              </div>
            ) : (
              <>
                {/* 순위 탭 + 표 */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 space-y-2">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-800">트레이너 순위</h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        행 클릭 → 일별·지점별 상세 · 동점은 공동순위
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 no-print">
                      {RANK_TABS.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => setRankMetric(t.key)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs border transition-colors",
                            rankMetric === t.key
                              ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Desktop */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          {["순위", "트레이너", "총 세션", "워크인 매출", "개인 매출", "총 매출", "활동 지점수"].map((h) => (
                            <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rankedRows.map(({ rank, row }) => {
                          const open = expandedTrainerId === row.trainerId;
                          return (
                            <Fragment key={row.trainerId}>
                              <tr
                                onClick={() => setExpandedTrainerId(open ? null : row.trainerId)}
                                className={cn("cursor-pointer hover:bg-gray-50", open && "bg-blue-50/50")}
                              >
                                <td className="px-3 py-2.5 font-semibold text-gray-600">{rank}</td>
                                <td className="px-3 py-2.5 font-medium text-gray-900">
                                  <span className="inline-flex items-center gap-1">
                                    {open ? <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400" />}
                                    {row.trainerName}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-gray-700">{formatNumber(row.totalSessions)}회</td>
                                <td className="px-3 py-2.5 text-gray-700">{formatNumber(row.walkInSales)}원</td>
                                <td className="px-3 py-2.5 text-gray-700">{formatNumber(row.personalSales)}원</td>
                                <td className="px-3 py-2.5 font-semibold text-gray-900">{formatNumber(row.totalSales)}원</td>
                                <td className="px-3 py-2.5 text-gray-700">{row.branchCount}곳</td>
                              </tr>
                              {open && (
                                <tr>
                                  <td colSpan={7} className="px-4 py-3 bg-gray-50/70">
                                    <TrainerDetail
                                      row={row}
                                      rows={detailRows}
                                      branchNameOf={branchNameOf}
                                    />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t border-gray-200">
                        <tr className="text-xs font-semibold text-gray-700">
                          <td className="px-3 py-2.5" colSpan={2}>합계</td>
                          <td className="px-3 py-2.5">{formatNumber(totals.totalSessions)}회</td>
                          <td className="px-3 py-2.5">{formatNumber(totals.walkInSales)}원</td>
                          <td className="px-3 py-2.5">{formatNumber(totals.personalSales)}원</td>
                          <td className="px-3 py-2.5">{formatNumber(totals.totalSales)}원</td>
                          <td className="px-3 py-2.5">-</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Mobile */}
                  <div className="md:hidden divide-y divide-gray-100">
                    {rankedRows.map(({ rank, row }) => {
                      const open = expandedTrainerId === row.trainerId;
                      return (
                        <div key={row.trainerId}>
                          <button
                            onClick={() => setExpandedTrainerId(open ? null : row.trainerId)}
                            className="w-full text-left px-4 py-3 space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-900">
                                <span className="text-gray-400 mr-1.5">{rank}.</span>
                                {row.trainerName}
                              </span>
                              <span className="text-sm font-bold text-[#1e3a5f]">
                                {formatNumber(row.totalSales)}원
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                              <span>세션 {formatNumber(row.totalSessions)}회</span>
                              <span>워크인 {formatNumber(row.walkInSales)}원</span>
                              <span>개인 {formatNumber(row.personalSales)}원</span>
                              <span>지점 {row.branchCount}곳</span>
                            </div>
                          </button>
                          {open && (
                            <div className="px-4 pb-3">
                              <TrainerDetail row={row} rows={detailRows} branchNameOf={branchNameOf} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 지점별 요약 */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h2 className="text-sm font-semibold text-gray-800">지점별 요약</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[720px]">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          {["지점", "브랜드", "총 세션", "총 등록", "워크인 매출", "개인 매출", "총 매출", "트레이너 수"].map((h) => (
                            <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {branchRows.map((b) => (
                          <tr key={b.branchId} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{branchNameOf(b.branchId)}</td>
                            <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{branchBrandOf(b.branchId)}</td>
                            <td className="px-3 py-2.5 text-gray-700">{formatNumber(b.totalSessions)}회</td>
                            <td className="px-3 py-2.5 text-gray-700">{formatNumber(b.totalReg)}건</td>
                            <td className="px-3 py-2.5 text-gray-700">{formatNumber(b.walkInSales)}원</td>
                            <td className="px-3 py-2.5 text-gray-700">{formatNumber(b.personalSales)}원</td>
                            <td className="px-3 py-2.5 font-semibold text-gray-900">{formatNumber(b.totalSales)}원</td>
                            <td className="px-3 py-2.5 text-gray-700">{b.trainerCount}명</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t border-gray-200">
                        <tr className="text-xs font-semibold text-gray-700">
                          <td className="px-3 py-2.5" colSpan={2}>합계</td>
                          <td className="px-3 py-2.5">{formatNumber(totals.totalSessions)}회</td>
                          <td className="px-3 py-2.5">{formatNumber(totals.totalReg)}건</td>
                          <td className="px-3 py-2.5">{formatNumber(totals.walkInSales)}원</td>
                          <td className="px-3 py-2.5">{formatNumber(totals.personalSales)}원</td>
                          <td className="px-3 py-2.5">{formatNumber(totals.totalSales)}원</td>
                          <td className="px-3 py-2.5">-</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <p className="text-xs text-gray-400">
                  모든 수치는 trainerSessions 원본(지점 + 날짜 + 트레이너)을 조회 시 합산한 값입니다.
                  누적값을 따로 저장하지 않으므로 같은 날 여러 지점 근무도 정확히 합산됩니다.
                </p>
              </>
            )}
          </>
        )}
      </PrintableSection>
    </div>
  );
}

// ── 트레이너 상세: 기간 요약 + 일별·지점별 원본 ────────────────────────────────
function TrainerDetail({
  row,
  rows,
  branchNameOf,
}: {
  row: TrainerPerformanceRow;
  rows: TrainerSession[];
  branchNameOf: (id: string) => string;
}) {
  // 지점별 집계 (같은 트레이너가 여러 지점에서 근무한 경우)
  const byBranch = useMemo(() => {
    const map = new Map<string, { branchId: string; sessions: number; sales: number; days: Set<string> }>();
    for (const r of rows) {
      let agg = map.get(r.branchId);
      if (!agg) {
        agg = { branchId: r.branchId, sessions: 0, sales: 0, days: new Set() };
        map.set(r.branchId, agg);
      }
      agg.sessions += totalSessionOf(r);
      agg.sales += totalSalesOf(r);
      agg.days.add(r.date);
    }
    return Array.from(map.values()).sort((a, b) => b.sessions - a.sessions);
  }, [rows]);

  return (
    <div className="space-y-3">
      {/* 기간 요약 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "기간 총 세션", value: `${formatNumber(row.totalSessions)}회` },
          { label: "기간 총 등록", value: `${formatNumber(row.totalReg)}건` },
          { label: "기간 총 매출", value: `${formatNumber(row.totalSales)}원` },
          { label: "일 평균 세션", value: `${fmtAvg(row.avgSessionsPerDay)}회` },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-lg border border-gray-200 px-3 py-2">
            <p className="text-[11px] text-gray-500">{c.label}</p>
            <p className="text-xs font-bold text-gray-800">{c.value}</p>
          </div>
        ))}
      </div>

      {/* 지점별 */}
      <div>
        <p className="text-[11px] font-medium text-gray-500 mb-1">지점별</p>
        <div className="flex flex-wrap gap-1.5">
          {byBranch.map((b) => (
            <span key={b.branchId} className="text-[11px] bg-white border border-gray-200 rounded-full px-2 py-1 text-gray-600">
              {branchNameOf(b.branchId)} · {formatNumber(b.sessions)}회 · {formatNumber(b.sales)}원 · {b.days.size}일
            </span>
          ))}
        </div>
      </div>

      {/* 일별 원본 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[760px]">
          <thead>
            <tr className="text-gray-400">
              {["날짜", "지점", "PT", "OT/체험", "GX/그룹", "기타", "총 세션", "워크인 매출", "개인 매출", "총 매출", "메모"].map((h) => (
                <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{formatDate(r.date)}</td>
                <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{branchNameOf(r.branchId)}</td>
                <td className="px-2 py-1.5 text-gray-600">{ptOf(r)}</td>
                <td className="px-2 py-1.5 text-gray-600">{otOf(r)}</td>
                <td className="px-2 py-1.5 text-gray-600">{groupOf(r)}</td>
                <td className="px-2 py-1.5 text-gray-600">{otherOf(r)}</td>
                <td className="px-2 py-1.5 font-medium text-gray-800">{totalSessionOf(r)}회</td>
                <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{formatNumber(walkInSalesOf(r))}원</td>
                <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{formatNumber(personalSalesOf(r))}원</td>
                <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap">{formatNumber(totalSalesOf(r))}원</td>
                <td className="px-2 py-1.5 text-gray-500">{r.memo || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
