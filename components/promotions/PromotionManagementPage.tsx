"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getAllBranches, getBranchesByIds } from "@/services/branches";
import { getAllReports, getReportsByBranch } from "@/services/reports";
import {
  createPromotion,
  updatePromotion,
  getPromotionsByMonth,
  getPromotionsByBranches,
  aggregatePerformanceForPromotion,
  registrationConversionRate,
  costPerRegistration,
  returnOnAdSpend,
  EMPTY_PROMOTION_PERFORMANCE,
  type PromotionInput,
  type PromotionPerformance,
} from "@/services/promotions";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import PrintButton from "@/components/print/PrintButton";
import PrintHeader from "@/components/print/PrintHeader";
import PrintableSection from "@/components/print/PrintableSection";
import { cn, formatNumber, formatPercent, getKoreaToday } from "@/lib/utils";
import { PROMOTION_STATUS_LABEL } from "@/types";
import type { Branch, DailyReport, Promotion, PromotionStatus } from "@/types";
import { PlusIcon, EditIcon, XIcon } from "lucide-react";

type Mode = "admin" | "manager";

const STATUS_COLOR: Record<PromotionStatus, string> = {
  preparing: "bg-gray-100 text-gray-600",
  active: "bg-green-100 text-green-700",
  ended: "bg-gray-200 text-gray-500",
  stopped: "bg-red-100 text-red-700",
};

const STATUS_OPTIONS: PromotionStatus[] = ["preparing", "active", "ended", "stopped"];

function currentYearMonth(): string {
  return getKoreaToday().slice(0, 7);
}

// yearMonth("YYYY-MM") → 그 달의 시작일·마지막일
function monthRange(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const from = `${yearMonth}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
}

type FormState = {
  branchId: string;
  name: string;
  startDate: string;
  endDate: string;
  purpose: string;
  targetAudience: string;
  benefitDescription: string;
  productDescription: string;
  targetInquiryCount: string;
  targetRegistrationCount: string;
  targetSalesAmount: string;
  plannedOnlineBudget: string;
  plannedOfflineBudget: string;
  status: PromotionStatus;
};

const emptyForm: FormState = {
  branchId: "",
  name: "",
  startDate: "",
  endDate: "",
  purpose: "",
  targetAudience: "",
  benefitDescription: "",
  productDescription: "",
  targetInquiryCount: "",
  targetRegistrationCount: "",
  targetSalesAmount: "",
  plannedOnlineBudget: "",
  plannedOfflineBudget: "",
  status: "preparing",
};

function toNullableNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? null : n;
}

export default function PromotionManagementPage({ mode }: { mode: Mode }) {
  const { profile } = useAuth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [filterBranch, setFilterBranch] = useState("");
  const [filterStatus, setFilterStatus] = useState<PromotionStatus | "">("");
  const [printSections, setPrintSections] = useState<string[]>(["promotions"]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // branch_manager는 본인 담당 지점만 다룬다 (타 지점 조회·작성 차단)
  const managerBranchIds = useMemo(
    () => (mode === "manager" ? profile?.branchIds ?? [] : []),
    [mode, profile]
  );

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { from, to } = monthRange(yearMonth);
        const [bs, ps, rs] = await Promise.all([
          mode === "admin" ? getAllBranches() : getBranchesByIds(managerBranchIds),
          mode === "admin"
            ? getPromotionsByMonth(yearMonth)
            : getPromotionsByBranches(managerBranchIds, yearMonth),
          mode === "admin"
            ? getAllReports(from, to)
            : Promise.all(managerBranchIds.map((id) => getReportsByBranch(id, from, to))).then((r) =>
                r.flat()
              ),
        ]);
        if (cancelled) return;
        setBranches(bs);
        setPromotions(ps);
        setReports(rs);
      } catch (err) {
        if (cancelled) return;
        console.error("[Promotions] load failed", err);
        const code = (err as { code?: string })?.code ?? "unknown";
        setError(
          code === "permission-denied"
            ? "프로모션 데이터 접근 권한이 없습니다."
            : `데이터 로드 오류: ${code}`
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [profile, mode, managerBranchIds, yearMonth]);

  const branchNameOf = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string) => map.get(id) ?? id;
  }, [branches]);

  // 실제 실적은 dailyReports 원본을 프로모션별로 합산한다 (월 누적 값을 따로 저장하지 않음)
  const performanceOf = useMemo(() => {
    const map = new Map<string, PromotionPerformance>();
    promotions.forEach((p) => {
      map.set(p.id, aggregatePerformanceForPromotion(reports, p.id));
    });
    return (promotionId: string) => map.get(promotionId) ?? EMPTY_PROMOTION_PERFORMANCE;
  }, [promotions, reports]);

  const filtered = useMemo(
    () =>
      promotions.filter((p) => {
        if (filterBranch && p.branchId !== filterBranch) return false;
        if (filterStatus && p.status !== filterStatus) return false;
        return true;
      }),
    [promotions, filterBranch, filterStatus]
  );

  // 필터된 프로모션 전체 합계 (검증용 tfoot)
  const totals = useMemo(
    () =>
      filtered.reduce<PromotionPerformance>(
        (acc, p) => {
          const perf = performanceOf(p.id);
          return {
            onlineCost: acc.onlineCost + perf.onlineCost,
            offlineCost: acc.offlineCost + perf.offlineCost,
            totalCost: acc.totalCost + perf.totalCost,
            inquiryCount: acc.inquiryCount + perf.inquiryCount,
            visitCount: acc.visitCount + perf.visitCount,
            registrationCount: acc.registrationCount + perf.registrationCount,
            salesAmount: acc.salesAmount + perf.salesAmount,
            reportCount: acc.reportCount + perf.reportCount,
          };
        },
        { ...EMPTY_PROMOTION_PERFORMANCE }
      ),
    [filtered, performanceOf]
  );

  const selectableBranches = mode === "admin" ? branches : branches;

  function openCreate() {
    setEditing(null);
    setForm({
      ...emptyForm,
      branchId: selectableBranches[0]?.id ?? "",
      startDate: `${yearMonth}-01`,
      endDate: monthRange(yearMonth).to,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(p: Promotion) {
    setEditing(p);
    setForm({
      branchId: p.branchId,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      purpose: p.purpose ?? "",
      targetAudience: p.targetAudience ?? "",
      benefitDescription: p.benefitDescription ?? "",
      productDescription: p.productDescription ?? "",
      targetInquiryCount: p.targetInquiryCount?.toString() ?? "",
      targetRegistrationCount: p.targetRegistrationCount?.toString() ?? "",
      targetSalesAmount: p.targetSalesAmount?.toString() ?? "",
      plannedOnlineBudget: p.plannedOnlineBudget?.toString() ?? "",
      plannedOfflineBudget: p.plannedOfflineBudget?.toString() ?? "",
      status: p.status,
    });
    setFormError(null);
    setModalOpen(true);
  }

  const plannedTotalPreview =
    (toNullableNumber(form.plannedOnlineBudget) ?? 0) +
    (toNullableNumber(form.plannedOfflineBudget) ?? 0);

  async function handleSave() {
    if (!profile) return;
    setFormError(null);

    if (!form.branchId) return setFormError("지점을 선택해주세요.");
    if (!form.name.trim()) return setFormError("프로모션명을 입력해주세요.");
    if (!form.startDate || !form.endDate) return setFormError("기간을 입력해주세요.");
    if (form.startDate > form.endDate) return setFormError("종료일이 시작일보다 빠릅니다.");
    if (mode === "manager" && !managerBranchIds.includes(form.branchId)) {
      return setFormError("담당 지점의 프로모션만 등록할 수 있습니다.");
    }

    const input: PromotionInput = {
      branchId: form.branchId,
      // 기준 월은 시작일에서 파생한다 (관리 화면의 월 선택과 어긋나지 않게)
      yearMonth: form.startDate.slice(0, 7),
      name: form.name,
      startDate: form.startDate,
      endDate: form.endDate,
      purpose: form.purpose,
      targetAudience: form.targetAudience,
      benefitDescription: form.benefitDescription,
      productDescription: form.productDescription,
      targetInquiryCount: toNullableNumber(form.targetInquiryCount),
      targetRegistrationCount: toNullableNumber(form.targetRegistrationCount),
      targetSalesAmount: toNullableNumber(form.targetSalesAmount),
      plannedOnlineBudget: toNullableNumber(form.plannedOnlineBudget),
      plannedOfflineBudget: toNullableNumber(form.plannedOfflineBudget),
      status: form.status,
    };

    setSaving(true);
    try {
      if (editing) {
        await updatePromotion(editing.id, input, profile.uid);
      } else {
        await createPromotion(input, profile.uid);
      }
      // 저장 후 목록을 다시 불러온다 (기준 월이 바뀌었을 수도 있으므로 재조회가 안전)
      const { from, to } = monthRange(yearMonth);
      const [ps, rs] = await Promise.all([
        mode === "admin"
          ? getPromotionsByMonth(yearMonth)
          : getPromotionsByBranches(managerBranchIds, yearMonth),
        mode === "admin"
          ? getAllReports(from, to)
          : Promise.all(managerBranchIds.map((id) => getReportsByBranch(id, from, to))).then((r) =>
              r.flat()
            ),
      ]);
      setPromotions(ps);
      setReports(rs);
      setModalOpen(false);
    } catch (err) {
      console.error("[Promotions] save failed", err);
      const code = (err as { code?: string })?.code ?? "unknown";
      setFormError(
        code === "permission-denied"
          ? "저장 권한이 없습니다. 담당 지점인지 확인해주세요."
          : "저장에 실패했습니다. 다시 시도해주세요."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <PrintHeader title="프로모션 관리" subtitle={yearMonth} />

      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-gray-900">프로모션 관리</h1>
          <p className="text-xs text-gray-400 mt-1">
            {mode === "admin"
              ? "전 지점 프로모션을 월 단위로 조회하고 실적을 비교합니다."
              : "담당 지점의 프로모션만 조회·등록할 수 있습니다."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton
            sections={[{ key: "promotions", label: "프로모션 관리" }]}
            selectedSections={printSections}
            onSelectionChange={setPrintSections}
          />
          <button
            onClick={openCreate}
            className="no-print flex items-center gap-1.5 px-3 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#16304f]"
          >
            <PlusIcon className="w-4 h-4" />
            프로모션 등록
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm no-print">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">기준 월</label>
            <input
              type="month"
              value={yearMonth}
              onChange={(e) => e.target.value && setYearMonth(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">지점</label>
            <select
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">전체 지점</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">상태</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as PromotionStatus | "")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">전체 상태</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{PROMOTION_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <PrintableSection sectionKey="promotions" selectedSections={printSections} className="space-y-4">
        {filtered.length === 0 ? (
          <EmptyState title="해당 조건의 프로모션이 없습니다" />
        ) : (
          <>
            {/* 월 실적 요약 — dailyReports 합산 기준 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "총 홍보비", value: `${formatNumber(totals.totalCost)}원` },
                { label: "프로모션 문의", value: `${formatNumber(totals.inquiryCount)}건` },
                { label: "프로모션 등록", value: `${formatNumber(totals.registrationCount)}건` },
                { label: "프로모션 매출", value: `${formatNumber(totals.salesAmount)}원` },
              ].map((c) => (
                <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                  <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                  <p className="text-lg font-bold text-gray-900">{c.value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: "등록 전환율", value: formatPercent(registrationConversionRate(totals)) },
                {
                  label: "등록 1건당 비용",
                  value:
                    costPerRegistration(totals) === null
                      ? "-"
                      : `${formatNumber(Math.round(costPerRegistration(totals)!))}원`,
                },
                {
                  label: "광고비 대비 매출",
                  value:
                    returnOnAdSpend(totals) === null
                      ? "-"
                      : `${returnOnAdSpend(totals)!.toFixed(2)}배`,
                },
              ].map((c) => (
                <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                  <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                  <p className="text-lg font-bold text-gray-900">{c.value}</p>
                </div>
              ))}
            </div>

            {/* 목록 */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[1240px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {[
                      "지점", "프로모션명", "기간", "상태",
                      "목표 문의", "목표 등록", "목표 매출", "계획 예산",
                      "실제 온라인", "실제 오프라인", "실제 총비용",
                      "실제 문의", "실제 방문", "실제 등록", "실제 매출", "",
                    ].map((h, i) => (
                      <th
                        key={`${h}-${i}`}
                        className="px-3 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((p) => {
                    const perf = performanceOf(p.id);
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-3 py-3 whitespace-nowrap text-gray-700">{branchNameOf(p.branchId)}</td>
                        <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-900">{p.name}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-500">
                          {p.startDate} ~ {p.endDate}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium", STATUS_COLOR[p.status])}>
                            {PROMOTION_STATUS_LABEL[p.status]}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">{formatNumber(p.targetInquiryCount)}</td>
                        <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">{formatNumber(p.targetRegistrationCount)}</td>
                        <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">{formatNumber(p.targetSalesAmount)}</td>
                        <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">{formatNumber(p.plannedTotalBudget)}</td>
                        <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">{formatNumber(perf.onlineCost)}</td>
                        <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">{formatNumber(perf.offlineCost)}</td>
                        <td className="px-3 py-3 text-xs font-semibold text-gray-900 whitespace-nowrap">{formatNumber(perf.totalCost)}</td>
                        <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">{formatNumber(perf.inquiryCount)}</td>
                        <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">{formatNumber(perf.visitCount)}</td>
                        <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">{formatNumber(perf.registrationCount)}</td>
                        <td className="px-3 py-3 text-xs font-semibold text-gray-900 whitespace-nowrap">{formatNumber(perf.salesAmount)}</td>
                        <td className="px-3 py-3 no-print">
                          <button
                            onClick={() => openEdit(p)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                            title="수정"
                          >
                            <EditIcon className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-700" colSpan={8}>합계</td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-900">{formatNumber(totals.onlineCost)}</td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-900">{formatNumber(totals.offlineCost)}</td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-900">{formatNumber(totals.totalCost)}</td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-900">{formatNumber(totals.inquiryCount)}</td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-900">{formatNumber(totals.visitCount)}</td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-900">{formatNumber(totals.registrationCount)}</td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-900">{formatNumber(totals.salesAmount)}</td>
                    <td className="px-3 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-gray-400">
              실제 실적은 일일보고(reportDate 기준)를 합산한 값입니다. 월 누적 숫자를 따로 저장하지 않으므로
              같은 날짜 보고서를 수정해도 이중 집계되지 않습니다.
            </p>
          </>
        )}
      </PrintableSection>

      {/* 등록·수정 모달 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-6 px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                {editing ? "프로모션 수정" : "프로모션 등록"}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">
                  지점 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.branchId}
                  disabled={!!editing}
                  onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-500"
                >
                  <option value="">지점 선택</option>
                  {selectableBranches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {editing && <p className="text-[11px] text-gray-400 mt-1">지점은 등록 후 변경할 수 없습니다.</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">
                  프로모션명 <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예: 7월 오픈 기념 이벤트"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">
                  시작일 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">
                  종료일 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">상태</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PromotionStatus }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{PROMOTION_STATUS_LABEL[s]}</option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">
                  일일보고에서는 진행 중 상태만 선택할 수 있습니다.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">목적</label>
                <input
                  value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  placeholder="예: 신규 회원 확보"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">타깃 대상</label>
                <input
                  value={form.targetAudience}
                  onChange={(e) => setForm((f) => ({ ...f, targetAudience: e.target.value }))}
                  placeholder="예: 반경 2km 30~40대 직장인"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">혜택 내용</label>
                <input
                  value={form.benefitDescription}
                  onChange={(e) => setForm((f) => ({ ...f, benefitDescription: e.target.value }))}
                  placeholder="예: 3개월 등록 시 1개월 추가"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-700 block mb-1">상품 구성</label>
                <textarea
                  value={form.productDescription}
                  rows={2}
                  onChange={(e) => setForm((f) => ({ ...f, productDescription: e.target.value }))}
                  placeholder="프로모션 상품 구성 설명"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-700 mb-2">목표</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">목표 문의 (건)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.targetInquiryCount}
                    onChange={(e) => setForm((f) => ({ ...f, targetInquiryCount: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">목표 등록 (건)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.targetRegistrationCount}
                    onChange={(e) => setForm((f) => ({ ...f, targetRegistrationCount: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">목표 매출 (원)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.targetSalesAmount}
                    onChange={(e) => setForm((f) => ({ ...f, targetSalesAmount: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-700 mb-2">계획 예산</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">온라인 (원)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.plannedOnlineBudget}
                    onChange={(e) => setForm((f) => ({ ...f, plannedOnlineBudget: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">오프라인 (원)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.plannedOfflineBudget}
                    onChange={(e) => setForm((f) => ({ ...f, plannedOfflineBudget: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">총 예산 (자동)</label>
                  <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
                    {formatNumber(plannedTotalPreview)}원
                  </div>
                </div>
              </div>
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
