"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { format, subDays, startOfMonth } from "date-fns";
import { getAllBranchesIncludingInactive } from "@/services/branches";
import { getAllTrainers } from "@/services/trainers";
import { getAllTrainerDailyReportsByPeriod } from "@/services/trainerDailyReports";
import { getAllReports } from "@/services/reports";
import LoadingState from "@/components/common/LoadingState";
import { cn, todayYMD, formatDate } from "@/lib/utils";
import type { Branch, Trainer, TrainerDailyReport } from "@/types";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "lucide-react";

type Preset = "today" | "7days" | "thisMonth" | "custom";

type SortKey =
  | "walkInSales"
  | "personalSales"
  | "totalSales"
  | "personalRate"
  | "classCount"
  | "salesPerClass";

type TrainerAgg = {
  trainerId: string;
  trainerName: string;
  branchIds: string[];
  walkInSales: number;
  personalSales: number;
  totalSales: number;
  classCount: number;
  personalRate: number | null;
  salesPerClass: number | null;
};

type BranchAgg = {
  branchId: string;
  walkInSales: number;
  personalSales: number;
  totalSales: number;
  classCount: number;
  trainerCount: number;
};

const SORT_LABELS: Record<SortKey, string> = {
  walkInSales: "워크인 매출",
  personalSales: "개인역량 매출",
  totalSales: "총매출",
  personalRate: "개인역량 비율",
  classCount: "수업 수",
  salesPerClass: "수업당 매출",
};

function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

function personalSalesRate(personal: number, total: number): number | null {
  return total === 0 ? null : (personal / total) * 100;
}

function salesPerClassOf(total: number, classes: number): number | null {
  return classes === 0 ? null : total / classes;
}

function fmtRate(rate: number | null): string {
  return rate === null ? "-" : `${Math.round(rate)}%`;
}

function fmtPerClass(v: number | null): string {
  return v === null ? "-" : won(Math.round(v));
}

function reportKey(r: { branchId: string; reportDate: string }): string {
  return `${r.branchId}_${r.reportDate}`;
}

export default function TrainerDashboardPage() {
  const today = todayYMD();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodLoading, setPeriodLoading] = useState(false);

  // Raw period data (test data already removed) + validity info for draft filtering
  const [rawReports, setRawReports] = useState<TrainerDailyReport[]>([]);
  const [validKeys, setValidKeys] = useState<Set<string>>(new Set());
  const [fetchedCount, setFetchedCount] = useState(0);
  const [testExcludedCount, setTestExcludedCount] = useState(0);

  // Filters
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [customFrom, setCustomFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(today);
  const [brandFilter, setBrandFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [trainerFilter, setTrainerFilter] = useState("");
  const [search, setSearch] = useState("");
  const [includeDrafts, setIncludeDrafts] = useState(false);

  // Sorting (trainer table)
  const [sortKey, setSortKey] = useState<SortKey>("totalSales");
  const [sortDesc, setSortDesc] = useState(true);

  // Expansion
  const [expandedBranchId, setExpandedBranchId] = useState<string | null>(null);
  const [expandedTrainerId, setExpandedTrainerId] = useState<string | null>(null);

  const { from, to } = useMemo(() => {
    switch (preset) {
      case "today":
        return { from: today, to: today };
      case "7days":
        return { from: format(subDays(new Date(), 6), "yyyy-MM-dd"), to: today };
      case "thisMonth":
        return { from: format(startOfMonth(new Date()), "yyyy-MM-dd"), to: today };
      case "custom":
        return customFrom <= customTo
          ? { from: customFrom, to: customTo }
          : { from: customTo, to: customFrom };
    }
  }, [preset, customFrom, customTo, today]);

  useEffect(() => {
    Promise.all([getAllBranchesIncludingInactive(), getAllTrainers()]).then(([bs, ts]) => {
      setBranches(bs);
      setTrainers(ts);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPeriod() {
      setPeriodLoading(true);
      try {
        const [trainerReports, dailyReports] = await Promise.all([
          getAllTrainerDailyReportsByPeriod(from, to),
          getAllReports(from, to),
        ]);
        if (cancelled) return;
        const nonTest = trainerReports.filter((r) => !r.isTestData);
        // Reports linked to a submitted/locked, non-test daily report count as operational.
        const keys = new Set(
          dailyReports
            .filter(
              (r) =>
                !r.isTestData && (r.status === "submitted" || r.status === "locked")
            )
            .map(reportKey)
        );
        setRawReports(nonTest);
        setValidKeys(keys);
        setFetchedCount(trainerReports.length);
        setTestExcludedCount(trainerReports.length - nonTest.length);
      } catch (err) {
        console.error("[TrainerDashboard] load failed", err);
      } finally {
        if (!cancelled) setPeriodLoading(false);
      }
    }

    loadPeriod();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  // Draft filtering (togglable)
  const baseReports = useMemo(
    () =>
      includeDrafts
        ? rawReports
        : rawReports.filter((r) => validKeys.has(reportKey(r))),
    [rawReports, validKeys, includeDrafts]
  );

  // Branch / brand / trainer-name lookups
  const branchNameOf = useMemo(() => {
    const m = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string) => m.get(id) ?? id;
  }, [branches]);

  const branchBrandOf = useMemo(() => {
    const m = new Map(branches.map((b) => [b.id, b.brand]));
    return (id: string) => m.get(id) ?? "-";
  }, [branches]);

  // Prefer the latest name from trainers collection over the snapshot in the report
  const trainerNameOf = useMemo(() => {
    const m = new Map(trainers.map((t) => [t.id, t.name]));
    return (r: TrainerDailyReport) => m.get(r.trainerId) ?? r.trainerName;
  }, [trainers]);

  const brands = useMemo(
    () => Array.from(new Set(branches.map((b) => b.brand).filter(Boolean))).sort(),
    [branches]
  );

  const branchOptions = useMemo(
    () => (brandFilter ? branches.filter((b) => b.brand === brandFilter) : branches),
    [branches, brandFilter]
  );

  // Filtered reports (brand → branch → trainer → search).
  // Summary cards and both tables all derive from this one array, so totals always match.
  const filtered = useMemo(() => {
    const brandBranchIds = brandFilter
      ? new Set(branches.filter((b) => b.brand === brandFilter).map((b) => b.id))
      : null;
    const q = search.trim().toLowerCase();
    return baseReports.filter((r) => {
      if (brandBranchIds && !brandBranchIds.has(r.branchId)) return false;
      if (branchFilter && r.branchId !== branchFilter) return false;
      if (trainerFilter && r.trainerId !== trainerFilter) return false;
      if (q) {
        const name = trainerNameOf(r).toLowerCase();
        const bName = branchNameOf(r.branchId).toLowerCase();
        if (!name.includes(q) && !bName.includes(q)) return false;
      }
      return true;
    });
  }, [baseReports, branches, brandFilter, branchFilter, trainerFilter, search, trainerNameOf, branchNameOf]);

  // Summary totals
  const summary = useMemo(() => {
    let walkIn = 0, personal = 0, classes = 0;
    for (const r of filtered) {
      walkIn += r.walkInSales;
      personal += r.personalSales;
      classes += r.classCount;
    }
    const total = walkIn + personal;
    return {
      walkIn,
      personal,
      total,
      classes,
      rate: personalSalesRate(personal, total),
      perClass: salesPerClassOf(total, classes),
    };
  }, [filtered]);

  // Verification logging (dev aid)
  useEffect(() => {
    if (loading || periodLoading) return;
    const operationalCount = rawReports.filter((r) => validKeys.has(reportKey(r))).length;
    const draftExcluded = rawReports.length - operationalCount;
    console.log("[TrainerDashboard] 집계 검증", {
      조회기간: `${from} ~ ${to}`,
      trainerDailyReports_조회개수: fetchedCount,
      운영집계_포함개수: includeDrafts ? rawReports.length : operationalCount,
      제외_테스트데이터: testExcludedCount,
      제외_draft연결: includeDrafts ? 0 : draftExcluded,
      임시저장포함보기: includeDrafts,
      전체_총매출: summary.total,
      전체_수업수: summary.classes,
    });
  }, [loading, periodLoading, rawReports, validKeys, fetchedCount, testExcludedCount, includeDrafts, from, to, summary.total, summary.classes]);

  // Per-trainer aggregates
  const trainerAggs = useMemo(() => {
    const map = new Map<string, Omit<TrainerAgg, "personalRate" | "salesPerClass">>();
    for (const r of filtered) {
      let agg = map.get(r.trainerId);
      if (!agg) {
        agg = {
          trainerId: r.trainerId,
          trainerName: trainerNameOf(r),
          branchIds: [],
          walkInSales: 0,
          personalSales: 0,
          totalSales: 0,
          classCount: 0,
        };
        map.set(r.trainerId, agg);
      }
      if (!agg.branchIds.includes(r.branchId)) agg.branchIds.push(r.branchId);
      agg.walkInSales += r.walkInSales;
      agg.personalSales += r.personalSales;
      agg.totalSales += r.totalSales;
      agg.classCount += r.classCount;
    }
    return Array.from(map.values()).map((a) => ({
      ...a,
      personalRate: personalSalesRate(a.personalSales, a.totalSales),
      salesPerClass: salesPerClassOf(a.totalSales, a.classCount),
    }));
  }, [filtered, trainerNameOf]);

  // Sorted trainer rows (null values always last)
  const sortedTrainerAggs = useMemo(() => {
    const dir = sortDesc ? -1 : 1;
    return [...trainerAggs].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }, [trainerAggs, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc((p) => !p);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  // Per-branch aggregates (sorted by total sales)
  const branchAggs = useMemo(() => {
    const map = new Map<string, BranchAgg & { trainerIds: Set<string> }>();
    for (const r of filtered) {
      let agg = map.get(r.branchId);
      if (!agg) {
        agg = {
          branchId: r.branchId,
          walkInSales: 0,
          personalSales: 0,
          totalSales: 0,
          classCount: 0,
          trainerCount: 0,
          trainerIds: new Set(),
        };
        map.set(r.branchId, agg);
      }
      agg.walkInSales += r.walkInSales;
      agg.personalSales += r.personalSales;
      agg.totalSales += r.totalSales;
      agg.classCount += r.classCount;
      agg.trainerIds.add(r.trainerId);
    }
    return Array.from(map.values())
      .map(({ trainerIds, ...rest }) => ({ ...rest, trainerCount: trainerIds.size }))
      .sort((a, b) => b.totalSales - a.totalSales);
  }, [filtered]);

  // Date detail for expanded trainer
  const trainerDateRows = useMemo(() => {
    if (!expandedTrainerId) return [];
    return filtered
      .filter((r) => r.trainerId === expandedTrainerId)
      .sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  }, [filtered, expandedTrainerId]);

  // Trainer aggregates within expanded branch
  const branchTrainerAggs = useMemo(() => {
    if (!expandedBranchId) return [];
    const map = new Map<string, { trainerId: string; trainerName: string; walkInSales: number; personalSales: number; totalSales: number; classCount: number }>();
    for (const r of filtered) {
      if (r.branchId !== expandedBranchId) continue;
      let agg = map.get(r.trainerId);
      if (!agg) {
        agg = {
          trainerId: r.trainerId,
          trainerName: trainerNameOf(r),
          walkInSales: 0,
          personalSales: 0,
          totalSales: 0,
          classCount: 0,
        };
        map.set(r.trainerId, agg);
      }
      agg.walkInSales += r.walkInSales;
      agg.personalSales += r.personalSales;
      agg.totalSales += r.totalSales;
      agg.classCount += r.classCount;
    }
    return Array.from(map.values()).sort((a, b) => b.totalSales - a.totalSales);
  }, [filtered, expandedBranchId, trainerNameOf]);

  if (loading) return <LoadingState />;

  // Table footer totals — computed from trainer aggregates to visually verify
  // they match the summary cards (same source data, so they must agree).
  const trainerTotals = trainerAggs.reduce(
    (acc, t) => ({
      walkIn: acc.walkIn + t.walkInSales,
      personal: acc.personal + t.personalSales,
      total: acc.total + t.totalSales,
      classes: acc.classes + t.classCount,
    }),
    { walkIn: 0, personal: 0, total: 0, classes: 0 }
  );

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDesc ? " ▼" : " ▲") : "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-base font-bold text-gray-900">트레이너 실적</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {formatDate(from)} ~ {formatDate(to)} ·{" "}
          {includeDrafts ? "임시저장 포함" : "제출 완료된 보고 기준"}
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "today", label: "오늘" },
              { key: "7days", label: "최근 7일" },
              { key: "thisMonth", label: "이번 달" },
              { key: "custom", label: "직접 설정" },
            ] as const
          ).map(({ key, label }) => (
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
              {label}
            </button>
          ))}
          {preset === "custom" && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <input
                type="date"
                value={customFrom}
                max={today}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs"
              />
              <span className="text-xs text-gray-400">~</span>
              <input
                type="date"
                value={customTo}
                max={today}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={brandFilter}
            onChange={(e) => {
              setBrandFilter(e.target.value);
              setBranchFilter("");
            }}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
          >
            <option value="">전체 브랜드</option>
            {brands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
          >
            <option value="">전체 지점</option>
            {branchOptions.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <select
            value={trainerFilter}
            onChange={(e) => setTrainerFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
          >
            <option value="">전체 트레이너</option>
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (비활성)"}</option>
            ))}
          </select>

          <div className="relative">
            <SearchIcon className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="트레이너명·지점명 검색"
              className="border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-xs w-44 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={includeDrafts}
              onChange={(e) => setIncludeDrafts(e.target.checked)}
              className="rounded border-gray-300"
            />
            임시저장 포함 보기
          </label>
        </div>
      </div>

      {periodLoading ? (
        <LoadingState />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "워크인 매출", value: won(summary.walkIn) },
              { label: "개인역량 매출", value: won(summary.personal) },
              { label: "총매출", value: won(summary.total), highlight: true },
              { label: "수업 수", value: `${summary.classes.toLocaleString("ko-KR")}회` },
              { label: "개인역량 매출 비율", value: fmtRate(summary.rate) },
              { label: "수업당 매출", value: fmtPerClass(summary.perClass) },
            ].map((card) => (
              <div
                key={card.label}
                className={cn(
                  "bg-white rounded-xl border shadow-sm px-4 py-3",
                  card.highlight ? "border-[#1e3a5f]/40" : "border-gray-200"
                )}
              >
                <p className="text-xs text-gray-500">{card.label}</p>
                <p
                  className={cn(
                    "text-sm font-bold mt-1 break-all",
                    card.highlight ? "text-[#1e3a5f]" : "text-gray-800"
                  )}
                >
                  {card.value}
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
              {/* ── Trainer ranking ─────────────────────────────────────── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-800">트레이너별 누적 실적</h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      행 클릭 → 날짜별 상세 · 컬럼 클릭 → 정렬
                    </p>
                  </div>
                  {/* Mobile sort selector */}
                  <div className="md:hidden flex items-center gap-1.5">
                    <select
                      value={sortKey}
                      onChange={(e) => { setSortKey(e.target.value as SortKey); setSortDesc(true); }}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white"
                    >
                      {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                        <option key={k} value={k}>{SORT_LABELS[k]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setSortDesc((p) => !p)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white"
                    >
                      {sortDesc ? "높은 순" : "낮은 순"}
                    </button>
                  </div>
                </div>

                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">순위</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">트레이너</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">지점</th>
                        {(
                          [
                            ["walkInSales", "워크인"],
                            ["personalSales", "개인역량"],
                            ["totalSales", "총매출"],
                            ["personalRate", "개인역량 비율"],
                            ["classCount", "수업 수"],
                            ["salesPerClass", "수업당 매출"],
                          ] as [SortKey, string][]
                        ).map(([key, label]) => (
                          <th
                            key={key}
                            onClick={() => toggleSort(key)}
                            className={cn(
                              "px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap cursor-pointer select-none hover:text-gray-800",
                              sortKey === key ? "text-[#1e3a5f]" : "text-gray-500"
                            )}
                          >
                            {label}{sortIndicator(key)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedTrainerAggs.map((t, i) => {
                        const open = expandedTrainerId === t.trainerId;
                        return (
                          <Fragment key={t.trainerId}>
                            <tr
                              onClick={() => setExpandedTrainerId(open ? null : t.trainerId)}
                              className={cn("cursor-pointer hover:bg-gray-50", open && "bg-blue-50/50")}
                            >
                              <td className="px-3 py-2.5 text-gray-500">{i + 1}</td>
                              <td className="px-3 py-2.5 font-medium text-gray-900">
                                <span className="inline-flex items-center gap-1">
                                  {open ? <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400" />}
                                  {t.trainerName}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-xs text-gray-500">
                                {t.branchIds.map(branchNameOf).join(", ")}
                              </td>
                              <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(t.walkInSales)}</td>
                              <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(t.personalSales)}</td>
                              <td className="px-3 py-2.5 font-semibold text-gray-900 whitespace-nowrap">{won(t.totalSales)}</td>
                              <td className="px-3 py-2.5 text-gray-700">{fmtRate(t.personalRate)}</td>
                              <td className="px-3 py-2.5 text-gray-700">{t.classCount}회</td>
                              <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmtPerClass(t.salesPerClass)}</td>
                            </tr>
                            {open && (
                              <tr>
                                <td colSpan={9} className="px-4 py-3 bg-gray-50/70">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-gray-400">
                                        {["날짜", "지점", "워크인 매출", "개인역량 매출", "총매출", "수업 수"].map((h) => (
                                          <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {trainerDateRows.map((r) => (
                                        <tr key={r.id}>
                                          <td className="px-2 py-1.5 text-gray-600">{formatDate(r.reportDate)}</td>
                                          <td className="px-2 py-1.5 text-gray-600">{branchNameOf(r.branchId)}</td>
                                          <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{won(r.walkInSales)}</td>
                                          <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{won(r.personalSales)}</td>
                                          <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap">{won(r.totalSales)}</td>
                                          <td className="px-2 py-1.5 text-gray-600">{r.classCount}회</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr className="text-xs font-semibold text-gray-700">
                        <td className="px-3 py-2.5" colSpan={3}>합계</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{won(trainerTotals.walkIn)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{won(trainerTotals.personal)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{won(trainerTotals.total)}</td>
                        <td className="px-3 py-2.5">{fmtRate(personalSalesRate(trainerTotals.personal, trainerTotals.total))}</td>
                        <td className="px-3 py-2.5">{trainerTotals.classes}회</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{fmtPerClass(salesPerClassOf(trainerTotals.total, trainerTotals.classes))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden divide-y divide-gray-100">
                  {sortedTrainerAggs.map((t, i) => {
                    const open = expandedTrainerId === t.trainerId;
                    return (
                      <div key={t.trainerId}>
                        <button
                          onClick={() => setExpandedTrainerId(open ? null : t.trainerId)}
                          className="w-full text-left px-4 py-3 space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-900">
                              <span className="text-gray-400 mr-1.5">{i + 1}.</span>
                              {t.trainerName}
                            </span>
                            <span className="text-sm font-bold text-[#1e3a5f]">{won(t.totalSales)}</span>
                          </div>
                          <p className="text-xs text-gray-400">{t.branchIds.map(branchNameOf).join(", ")}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                            <span>워크인 {won(t.walkInSales)}</span>
                            <span>개인역량 {won(t.personalSales)} ({fmtRate(t.personalRate)})</span>
                            <span>수업 {t.classCount}회</span>
                            <span>수업당 {fmtPerClass(t.salesPerClass)}</span>
                          </div>
                        </button>
                        {open && (
                          <div className="px-4 pb-3 space-y-2">
                            {trainerDateRows.map((r) => (
                              <div key={r.id} className="bg-gray-50 rounded-lg px-3 py-2 text-xs space-y-0.5">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-gray-700">{formatDate(r.reportDate)}</span>
                                  <span className="font-semibold text-gray-800">{won(r.totalSales)}</span>
                                </div>
                                <p className="text-gray-400">{branchNameOf(r.branchId)}</p>
                                <p className="text-gray-500">
                                  워크인 {won(r.walkInSales)} · 개인역량 {won(r.personalSales)} · 수업 {r.classCount}회
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Branch aggregate ─────────────────────────────────────── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-800">지점별 집계</h2>
                  <p className="text-xs text-gray-400 mt-0.5">행을 클릭하면 지점 트레이너별 상세가 열립니다</p>
                </div>

                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {["지점", "브랜드", "워크인 매출", "개인역량 매출", "총매출", "수업 수", "트레이너 수"].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {branchAggs.map((b) => {
                        const open = expandedBranchId === b.branchId;
                        return (
                          <Fragment key={b.branchId}>
                            <tr
                              onClick={() => setExpandedBranchId(open ? null : b.branchId)}
                              className={cn("cursor-pointer hover:bg-gray-50", open && "bg-blue-50/50")}
                            >
                              <td className="px-3 py-2.5 font-medium text-gray-900">
                                <span className="inline-flex items-center gap-1">
                                  {open ? <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400" />}
                                  {branchNameOf(b.branchId)}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-xs text-gray-500">{branchBrandOf(b.branchId)}</td>
                              <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(b.walkInSales)}</td>
                              <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(b.personalSales)}</td>
                              <td className="px-3 py-2.5 font-semibold text-gray-900 whitespace-nowrap">{won(b.totalSales)}</td>
                              <td className="px-3 py-2.5 text-gray-700">{b.classCount}회</td>
                              <td className="px-3 py-2.5 text-gray-700">{b.trainerCount}명</td>
                            </tr>
                            {open && (
                              <tr>
                                <td colSpan={7} className="px-4 py-3 bg-gray-50/70">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-gray-400">
                                        {["트레이너", "워크인 매출", "개인역량 매출", "총매출", "수업 수", "수업당 매출"].map((h) => (
                                          <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {branchTrainerAggs.map((t) => (
                                        <tr key={t.trainerId}>
                                          <td className="px-2 py-1.5 font-medium text-gray-700">{t.trainerName}</td>
                                          <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{won(t.walkInSales)}</td>
                                          <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{won(t.personalSales)}</td>
                                          <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap">{won(t.totalSales)}</td>
                                          <td className="px-2 py-1.5 text-gray-600">{t.classCount}회</td>
                                          <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{fmtPerClass(salesPerClassOf(t.totalSales, t.classCount))}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
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
                        <td className="px-3 py-2.5 whitespace-nowrap">{won(summary.walkIn)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{won(summary.personal)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{won(summary.total)}</td>
                        <td className="px-3 py-2.5">{summary.classes}회</td>
                        <td className="px-3 py-2.5">-</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden divide-y divide-gray-100">
                  {branchAggs.map((b) => {
                    const open = expandedBranchId === b.branchId;
                    return (
                      <div key={b.branchId}>
                        <button
                          onClick={() => setExpandedBranchId(open ? null : b.branchId)}
                          className="w-full text-left px-4 py-3 space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-900">
                              {branchNameOf(b.branchId)}
                              <span className="ml-1.5 text-xs font-normal text-gray-400">{branchBrandOf(b.branchId)}</span>
                            </span>
                            <span className="text-sm font-bold text-[#1e3a5f]">{won(b.totalSales)}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                            <span>워크인 {won(b.walkInSales)}</span>
                            <span>개인역량 {won(b.personalSales)}</span>
                            <span>수업 {b.classCount}회</span>
                            <span>트레이너 {b.trainerCount}명</span>
                          </div>
                        </button>
                        {open && (
                          <div className="px-4 pb-3 space-y-2">
                            {branchTrainerAggs.map((t) => (
                              <div key={t.trainerId} className="bg-gray-50 rounded-lg px-3 py-2 text-xs space-y-0.5">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-gray-700">{t.trainerName}</span>
                                  <span className="font-semibold text-gray-800">{won(t.totalSales)}</span>
                                </div>
                                <p className="text-gray-500">
                                  워크인 {won(t.walkInSales)} · 개인역량 {won(t.personalSales)} · 수업 {t.classCount}회
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
