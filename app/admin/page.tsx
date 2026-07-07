"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAllBranches } from "@/services/branches";
import { getTodayAllReports, getAllReports } from "@/services/reports";
import { getAllIssues } from "@/services/issues";
import { getAllCampaigns } from "@/services/campaigns";
import KpiCard from "@/components/dashboard/KpiCard";
import SubmissionDonut from "@/components/dashboard/SubmissionDonut";
import ConversionFunnel from "@/components/dashboard/ConversionFunnel";
import TrainerSessionSection from "@/components/dashboard/TrainerSessionSection";
import PrintButton from "@/components/print/PrintButton";
import PrintHeader from "@/components/print/PrintHeader";
import PrintableSection from "@/components/print/PrintableSection";
import LoadingState from "@/components/common/LoadingState";
import {
  cn,
  formatDate,
  todayYMD,
  calcPtConversionRate,
  formatPercent,
  getExpiringTmTotal,
  getUnregisteredTmTotal,
  getOfflinePromoTotal,
} from "@/lib/utils";
import type { Branch, DailyReport, Issue, Campaign } from "@/types";
import { format, subDays } from "date-fns";
import { XIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type DetailType = "sales" | "tm" | "promotion" | null;
type TmHighlight = "phone" | "sms" | "kakao" | "other" | "total" | null;

type BranchAggregate = {
  branchId: string;
  branchName: string;
  inquiries: number;
  ptConsultations: number;
  ptRegistrations: number;
  reRegistrations: number;
  comebackMembers: number;
  tmPhone: number;
  tmSms: number;
  tmKakao: number;
  tmOther: number;
  tmTotal: number;
  promoFlyer: number;
  promoPlacard: number;
  promoBanner: number;
  promoPartnership: number;
  promoEvent: number;
  promoOther: number;
  promoTotal: number;
};

// ── Print sections ────────────────────────────────────────────────────────────

const PRINT_SECTIONS = [
  { key: "today", label: "오늘 전체 지표" },
  { key: "trainer", label: "트레이너 세션 실적" },
  { key: "week7", label: "최근 7일 실적" },
  { key: "issues", label: "운영 이슈" },
  { key: "campaigns", label: "캠페인 실적" },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [reports7d, setReports7d] = useState<DailyReport[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drilldown state
  const [selectedDetail, setSelectedDetail] = useState<DetailType>(null);
  const [tmHighlight, setTmHighlight] = useState<TmHighlight>(null);

  // Print: /admin 기본값은 전체 선택 ON
  const [printSections, setPrintSections] = useState<string[]>(
    PRINT_SECTIONS.map((s) => s.key)
  );

  const today = todayYMD();
  const from7 = format(subDays(new Date(today), 6), "yyyy-MM-dd");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [bs, rs, iss, cps, rs7d] = await Promise.all([
          getAllBranches(),
          getTodayAllReports(today),
          getAllIssues(),
          getAllCampaigns(),
          getAllReports(from7, today),
        ]);
        if (cancelled) return;
        setBranches(bs);
        setReports(rs);
        setReports7d(rs7d);
        setIssues(iss);
        setCampaigns(cps.filter((c) => c.status === "active"));
      } catch (err) {
        if (cancelled) return;
        const code: string = (err as { code?: string })?.code ?? "unknown";
        setError(
          code === "permission-denied"
            ? "데이터 접근 권한이 없습니다. (permission-denied)"
            : `데이터 로드 오류: ${code}`
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [today, from7]);

  if (loading) return <LoadingState />;
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-1">
        <p className="text-sm font-semibold text-red-700">데이터 로드 실패</p>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  // ── Today ──────────────────────────────────────────────────────────────────
  const submitted = reports.filter(
    (r) => (r.status === "submitted" || r.status === "locked") && r.isTestData !== true
  );
  const revisionNeeded = reports.filter((r) => r.status === "revision_required");
  const submitMap = new Set(submitted.map((r) => r.branchId));
  const notSubmitted = branches.filter((b) => !submitMap.has(b.id));

  const totalActiveMembers = submitted.reduce((acc, r) => acc + (r.activeMembers ?? 0), 0);
  const totalInquiries     = submitted.reduce((acc, r) => acc + (r.inquiries ?? 0), 0);
  const totalPtConsult     = submitted.reduce((acc, r) => acc + (r.ptConsultations ?? 0), 0);
  const totalPtReg         = submitted.reduce((acc, r) => acc + (r.ptRegistrations ?? 0), 0);
  const totalReReg         = submitted.reduce((acc, r) => acc + (r.reRegistrations ?? 0), 0);
  const totalComeback      = submitted.reduce((acc, r) => acc + (r.comebackMembers ?? 0), 0);
  const overallConvRate    = calcPtConversionRate(totalPtConsult, totalPtReg);

  // ── 7-day dedup + filter ──────────────────────────────────────────────────
  const seen7d = new Map<string, DailyReport>();
  for (const r of reports7d) {
    const k = `${r.branchId}_${r.reportDate}`;
    if (!seen7d.has(k)) seen7d.set(k, r);
  }
  const submitted7d = [...seen7d.values()].filter(
    (r) => (r.status === "submitted" || r.status === "locked") && r.isTestData !== true
  );

  // ── 7-day aggregates ──────────────────────────────────────────────────────
  const total7dInquiries   = submitted7d.reduce((a, r) => a + (r.inquiries ?? 0), 0);
  const total7dPtConsult   = submitted7d.reduce((a, r) => a + (r.ptConsultations ?? 0), 0);
  const total7dPtReg       = submitted7d.reduce((a, r) => a + (r.ptRegistrations ?? 0), 0);
  const total7dReReg       = submitted7d.reduce((a, r) => a + (r.reRegistrations ?? 0), 0);
  const total7dComeback    = submitted7d.reduce((a, r) => a + (r.comebackMembers ?? 0), 0);
  const convRate7d         = calcPtConversionRate(total7dPtConsult, total7dPtReg);

  const tm7dPhone     = submitted7d.reduce((a, r) => a + (r.expiringTm?.phone ?? 0) + (r.unregisteredTm?.phone ?? 0), 0);
  const tm7dSms       = submitted7d.reduce((a, r) => a + (r.expiringTm?.sms ?? 0)   + (r.unregisteredTm?.sms ?? 0), 0);
  const tm7dKakao     = submitted7d.reduce((a, r) => a + (r.expiringTm?.kakao ?? 0) + (r.unregisteredTm?.kakao ?? 0), 0);
  const tm7dOther     = submitted7d.reduce((a, r) => a + (r.expiringTm?.other ?? 0) + (r.unregisteredTm?.other ?? 0), 0);
  const tm7dTotal     = submitted7d.reduce((a, r) => a + getExpiringTmTotal(r) + getUnregisteredTmTotal(r), 0);
  const hasNew7dTmData = submitted7d.some((r) => r.expiringTm || r.unregisteredTm);

  const promo7dFlyer       = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.flyer ?? 0), 0);
  const promo7dPlacard     = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.placard ?? 0), 0);
  const promo7dBanner      = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.banner ?? 0), 0);
  const promo7dPartnership = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.partnership ?? 0), 0);
  const promo7dEvent       = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.event ?? 0), 0);
  const promo7dOther       = submitted7d.reduce((a, r) => a + (r.offlinePromotion?.other ?? 0), 0);
  const promo7dTotal       = submitted7d.reduce((a, r) => a + getOfflinePromoTotal(r), 0);

  // ── Branch-level 7-day aggregates ─────────────────────────────────────────
  const branchMap = new Map<string, BranchAggregate>();
  for (const report of submitted7d) {
    const branch = branches.find((b) => b.id === report.branchId);
    const current: BranchAggregate = branchMap.get(report.branchId) ?? {
      branchId: report.branchId,
      branchName: branch?.name ?? report.branchId,
      inquiries: 0, ptConsultations: 0, ptRegistrations: 0,
      reRegistrations: 0, comebackMembers: 0,
      tmPhone: 0, tmSms: 0, tmKakao: 0, tmOther: 0, tmTotal: 0,
      promoFlyer: 0, promoPlacard: 0, promoBanner: 0,
      promoPartnership: 0, promoEvent: 0, promoOther: 0, promoTotal: 0,
    };
    current.inquiries        += report.inquiries ?? 0;
    current.ptConsultations  += report.ptConsultations ?? 0;
    current.ptRegistrations  += report.ptRegistrations ?? 0;
    current.reRegistrations  += report.reRegistrations ?? 0;
    current.comebackMembers  += report.comebackMembers ?? 0;
    current.tmPhone          += (report.expiringTm?.phone  ?? 0) + (report.unregisteredTm?.phone  ?? 0);
    current.tmSms            += (report.expiringTm?.sms    ?? 0) + (report.unregisteredTm?.sms    ?? 0);
    current.tmKakao          += (report.expiringTm?.kakao  ?? 0) + (report.unregisteredTm?.kakao  ?? 0);
    current.tmOther          += (report.expiringTm?.other  ?? 0) + (report.unregisteredTm?.other  ?? 0);
    current.tmTotal          += getExpiringTmTotal(report) + getUnregisteredTmTotal(report);
    current.promoFlyer       += report.offlinePromotion?.flyer       ?? 0;
    current.promoPlacard     += report.offlinePromotion?.placard     ?? 0;
    current.promoBanner      += report.offlinePromotion?.banner      ?? 0;
    current.promoPartnership += report.offlinePromotion?.partnership ?? 0;
    current.promoEvent       += report.offlinePromotion?.event       ?? 0;
    current.promoOther       += report.offlinePromotion?.other       ?? 0;
    current.promoTotal       += getOfflinePromoTotal(report);
    branchMap.set(report.branchId, current);
  }
  const branchAggregates = [...branchMap.values()];

  // ── Click handlers ────────────────────────────────────────────────────────
  function handleSalesClick() {
    setSelectedDetail((prev) => (prev === "sales" ? null : "sales"));
    setTmHighlight(null);
  }
  function handleTmClick(col: TmHighlight) {
    if (selectedDetail === "tm" && tmHighlight === col) {
      setSelectedDetail(null); setTmHighlight(null);
    } else if (selectedDetail === "tm") {
      setTmHighlight(col);
    } else {
      setSelectedDetail("tm"); setTmHighlight(col);
    }
  }
  function handlePromoClick() {
    setSelectedDetail((prev) => (prev === "promotion" ? null : "promotion"));
    setTmHighlight(null);
  }

  const openIssues    = issues.filter((i) => i.status !== "resolved");
  const criticalIssues = openIssues.filter((i) => i.severity === "critical");

  return (
    <div className="space-y-6">
      <PrintHeader title="관리자 전체 현황" subtitle={formatDate(today)} />

      <div className="flex items-start justify-between gap-2">
        <h1 className="text-base font-bold text-gray-900">관리자 ({formatDate(today)})</h1>
        <PrintButton
          sections={PRINT_SECTIONS}
          selectedSections={printSections}
          onSelectionChange={setPrintSections}
        />
      </div>

      <PrintableSection sectionKey="today" selectedSections={printSections} className="space-y-6">
      {/* Top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="전체 지점"    value={branches.length} unit="개" />
        <KpiCard label="제출 완료"    value={submitted.length} unit="개"
          subLabel={`${branches.length > 0 ? Math.round((submitted.length / branches.length) * 100) : 0}%`} />
        <KpiCard label="미제출"       value={notSubmitted.length} unit="개" />
        <KpiCard label="수정 요청"    value={revisionNeeded.length} unit="건" />
        <KpiCard label="운영 이슈"    value={openIssues.length} unit="건"
          subLabel={criticalIssues.length > 0 ? `긴급 ${criticalIssues.length}건` : undefined} />
        <KpiCard label="전체 유효회원" value={totalActiveMembers.toLocaleString()} unit="명" />
      </div>

      {/* Submission + not-submitted */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">제출 현황</p>
          <div className="flex items-center gap-6">
            <SubmissionDonut submitted={submitted.length} total={branches.length} />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-600" />
                <span className="text-xs text-gray-600">제출 완료 {submitted.length}개</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-200" />
                <span className="text-xs text-gray-600">미제출 {notSubmitted.length}개</span>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">미제출 지점</p>
          {notSubmitted.length === 0 ? (
            <p className="text-sm text-green-600 font-medium">전체 제출 완료 🎉</p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {notSubmitted.map((b) => (
                <div key={b.id} className="flex items-center gap-2 py-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  <span className="text-sm text-gray-700">{b.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Today metrics */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-700 mb-3">오늘 지표 (전체)</p>
        <ConversionFunnel
          inquiries={totalInquiries}
          consultations={totalPtConsult}
          registrations={totalPtReg}
        />
        <p className="text-xs text-gray-400 mt-2">오늘 PT 전환율: <strong>{formatPercent(overallConvRate)}</strong></p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <KpiCard label="재등록"   value={totalReReg}   unit="명" />
          <KpiCard label="컴백회원" value={totalComeback} unit="명" />
        </div>
      </div>

      </PrintableSection>

      {/* ── Trainer sessions ───────────────────────────────────────────────── */}
      <PrintableSection sectionKey="trainer" selectedSections={printSections}>
        <TrainerSessionSection />
      </PrintableSection>

      {/* ── 7-day section ───────────────────────────────────────────────────── */}
      <PrintableSection sectionKey="week7" selectedSections={printSections}>
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">최근 7일 실적 (전 지점 합산)</p>
          <span className="text-xs text-gray-400">{formatDate(from7)} ~ {formatDate(today)}</span>
        </div>

        <div>
          <ConversionFunnel
            inquiries={total7dInquiries}
            consultations={total7dPtConsult}
            registrations={total7dPtReg}
          />
          <p className="text-xs text-gray-400 mt-2">
            7일 PT 전환율: <strong className="text-gray-700">{formatPercent(convRate7d)}</strong>
            <span className="ml-2">({total7dPtReg}/{total7dPtConsult} × 100)</span>
          </p>
        </div>

        {/* Sales KPI cards */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">
            영업 실적
            <span className="ml-1.5 font-normal text-gray-400">— 카드 클릭 시 지점별 상세</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(
              [
                { label: "문의",     value: total7dInquiries,  unit: "건" },
                { label: "PT 상담",  value: total7dPtConsult,  unit: "건" },
                { label: "PT 등록",  value: total7dPtReg,      unit: "건" },
                { label: "재등록",   value: total7dReReg,      unit: "명" },
                { label: "컴백회원", value: total7dComeback,   unit: "명" },
              ] as const
            ).map(({ label, value, unit }) => (
              <KpiCard
                key={label}
                label={label}
                value={value}
                unit={unit}
                onClick={handleSalesClick}
                active={selectedDetail === "sales"}
              />
            ))}
          </div>
        </div>

        {selectedDetail === "sales" && (
          <DetailPanel
            type="sales"
            aggregates={branchAggregates}
            reports7d={submitted7d}
            onClose={() => setSelectedDetail(null)}
          />
        )}

        {/* TM KPI cards */}
        {(tm7dTotal > 0 || hasNew7dTmData) && (
          <>
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">
                TM 방식별 합계
                <span className="ml-1.5 font-normal text-gray-400">— 카드 클릭 시 지점별 상세</span>
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(
                  [
                    { label: "전화",    value: tm7dPhone, col: "phone" },
                    { label: "문자",    value: tm7dSms,   col: "sms" },
                    { label: "카카오톡", value: tm7dKakao, col: "kakao" },
                    { label: "기타",    value: tm7dOther, col: "other" },
                    { label: "TM 총합", value: tm7dTotal, col: "total" },
                  ] as { label: string; value: number; col: TmHighlight }[]
                ).map(({ label, value, col }) => (
                  <KpiCard
                    key={label}
                    label={label}
                    value={value}
                    unit="건"
                    onClick={() => handleTmClick(col)}
                    active={selectedDetail === "tm" && tmHighlight === col}
                  />
                ))}
              </div>
            </div>
            {selectedDetail === "tm" && (
              <DetailPanel
                type="tm"
                tmHighlight={tmHighlight ?? undefined}
                aggregates={branchAggregates}
                reports7d={submitted7d}
                onClose={() => { setSelectedDetail(null); setTmHighlight(null); }}
              />
            )}
          </>
        )}

        {/* Promo KPI cards */}
        {promo7dTotal > 0 && (
          <>
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">
                오프라인 홍보 방식별 합계
                <span className="ml-1.5 font-normal text-gray-400">— 카드 클릭 시 지점별 상세</span>
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    { label: "전단지",   value: promo7dFlyer },
                    { label: "현수막",   value: promo7dPlacard },
                    { label: "배너",     value: promo7dBanner },
                    { label: "제휴",     value: promo7dPartnership },
                    { label: "외부 행사", value: promo7dEvent },
                    { label: "기타",     value: promo7dOther },
                    { label: "홍보 총합", value: promo7dTotal },
                  ] as const
                ).map(({ label, value }) => (
                  <KpiCard
                    key={label}
                    label={label}
                    value={value}
                    unit="개"
                    onClick={handlePromoClick}
                    active={selectedDetail === "promotion"}
                  />
                ))}
              </div>
            </div>
            {selectedDetail === "promotion" && (
              <DetailPanel
                type="promotion"
                aggregates={branchAggregates}
                reports7d={submitted7d}
                onClose={() => setSelectedDetail(null)}
              />
            )}
          </>
        )}
      </div>
      </PrintableSection>

      {/* Issues summary */}
      <PrintableSection sectionKey="issues" selectedSections={printSections}>
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-700 mb-3">운영 이슈 요약</p>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              { label: "클레임",   type: "claim",    color: "text-red-600" },
              { label: "인력 이슈", type: "staff",    color: "text-orange-500" },
              { label: "시설 이슈", type: "facility", color: "text-blue-500" },
            ] as const
          ).map(({ label, type, color }) => {
            const count = openIssues.filter((i) => i.type === type).length;
            return (
              <div key={type} className="text-center">
                <p className={`text-2xl font-bold ${count > 0 ? color : "text-gray-300"}`}>{count}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            );
          })}
        </div>
      </div>
      </PrintableSection>

      {/* Active campaigns */}
      <PrintableSection sectionKey="campaigns" selectedSections={printSections}>
      {campaigns.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">진행 중 캠페인</p>
          <div className="space-y-2">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">{c.name}</p>
                  <p className="text-xs text-gray-400">{formatDate(c.startDate)} ~ {formatDate(c.endDate)}</p>
                </div>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">진행중</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </PrintableSection>
    </div>
  );
}

// ── DetailPanel ───────────────────────────────────────────────────────────────

function DetailPanel({
  type,
  tmHighlight,
  aggregates,
  reports7d,
  onClose,
}: {
  type: "sales" | "tm" | "promotion";
  tmHighlight?: TmHighlight;
  aggregates: BranchAggregate[];
  reports7d: DailyReport[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [search, setSearch]     = useState("");
  const [showZero, setShowZero] = useState(false);
  const [sortBy, setSortBy]     = useState<"total" | "name">("total");
  const [expanded, setExpanded] = useState<string | null>(null);

  function hasActivity(b: BranchAggregate): boolean {
    if (type === "sales")     return b.inquiries + b.ptConsultations + b.ptRegistrations + b.reRegistrations + b.comebackMembers > 0;
    if (type === "tm")        return b.tmTotal > 0;
    return b.promoTotal > 0;
  }

  function sortValue(b: BranchAggregate): number {
    if (type === "sales")     return b.inquiries + b.ptConsultations + b.ptRegistrations + b.reRegistrations + b.comebackMembers;
    if (type === "tm")        return b.tmTotal;
    return b.promoTotal;
  }

  const filtered = aggregates
    .filter((b) => !search || b.branchName.includes(search))
    .filter((b) => showZero || hasActivity(b))
    .sort((a, b) =>
      sortBy === "name"
        ? a.branchName.localeCompare(b.branchName, "ko")
        : sortValue(b) - sortValue(a)
    );

  function dailyReports(branchId: string): DailyReport[] {
    return reports7d
      .filter((r) => r.branchId === branchId)
      .sort((a, b) => b.reportDate.localeCompare(a.reportDate));
  }

  // Totals row for verification
  const totals: BranchAggregate = filtered.reduce(
    (acc, b) => ({
      ...acc,
      inquiries: acc.inquiries + b.inquiries,
      ptConsultations: acc.ptConsultations + b.ptConsultations,
      ptRegistrations: acc.ptRegistrations + b.ptRegistrations,
      reRegistrations: acc.reRegistrations + b.reRegistrations,
      comebackMembers: acc.comebackMembers + b.comebackMembers,
      tmPhone: acc.tmPhone + b.tmPhone,
      tmSms: acc.tmSms + b.tmSms,
      tmKakao: acc.tmKakao + b.tmKakao,
      tmOther: acc.tmOther + b.tmOther,
      tmTotal: acc.tmTotal + b.tmTotal,
      promoFlyer: acc.promoFlyer + b.promoFlyer,
      promoPlacard: acc.promoPlacard + b.promoPlacard,
      promoBanner: acc.promoBanner + b.promoBanner,
      promoPartnership: acc.promoPartnership + b.promoPartnership,
      promoEvent: acc.promoEvent + b.promoEvent,
      promoOther: acc.promoOther + b.promoOther,
      promoTotal: acc.promoTotal + b.promoTotal,
    }),
    {
      branchId: "", branchName: "",
      inquiries: 0, ptConsultations: 0, ptRegistrations: 0, reRegistrations: 0, comebackMembers: 0,
      tmPhone: 0, tmSms: 0, tmKakao: 0, tmOther: 0, tmTotal: 0,
      promoFlyer: 0, promoPlacard: 0, promoBanner: 0, promoPartnership: 0, promoEvent: 0, promoOther: 0, promoTotal: 0,
    }
  );

  const salesColSpan = 7;
  const tmColSpan    = 6;
  const promoColSpan = 8;
  const colSpan = type === "sales" ? salesColSpan : type === "tm" ? tmColSpan : promoColSpan;

  return (
    <div className="border border-[#1e3a5f]/20 rounded-xl bg-slate-50 p-4 space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="지점명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] w-32"
        />
        <button
          onClick={() => setShowZero((p) => !p)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs border transition-colors",
            showZero
              ? "border-[#1e3a5f] text-[#1e3a5f] bg-white"
              : "border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
          )}
        >
          {showZero ? "전체 지점 보기" : "실적 있는 지점만"}
        </button>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "total" | "name")}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none"
        >
          <option value="total">합계 높은 순</option>
          <option value="name">지점명 순</option>
        </select>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length}개 지점</span>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-gray-200 text-gray-400"
          title="닫기"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">표시할 지점 데이터가 없습니다</p>
      ) : (
        <>
          {/* ── Desktop table ─────────────────────────────────────────────── */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 w-32">지점명</th>
                  {type === "sales" && (
                    <>
                      <th className="text-right py-2 px-2 font-medium text-gray-500">문의</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-500">PT 상담</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-500">PT 등록</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-500">전환율</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-500">재등록</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-500">컴백회원</th>
                    </>
                  )}
                  {type === "tm" && (
                    <>
                      {(["phone", "sms", "kakao", "other", "total"] as TmHighlight[]).map((col, i) => (
                        <th
                          key={col}
                          className={cn(
                            "text-right py-2 px-2 font-medium",
                            tmHighlight === col ? "text-[#1e3a5f]" : "text-gray-500"
                          )}
                        >
                          {["전화", "문자", "카카오톡", "기타", "TM 총합"][i]}
                        </th>
                      ))}
                    </>
                  )}
                  {type === "promotion" && (
                    <>
                      {["전단지", "현수막", "배너", "제휴", "외부 행사", "기타", "총합"].map((h) => (
                        <th key={h} className="text-right py-2 px-2 font-medium text-gray-500">{h}</th>
                      ))}
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((b) => {
                  const convRate =
                    b.ptConsultations === 0
                      ? null
                      : Math.round((b.ptRegistrations / b.ptConsultations) * 100);
                  const isExpanded = expanded === b.branchId;
                  const daily = dailyReports(b.branchId);

                  return (
                    <Fragment key={b.branchId}>
                      <tr
                        className="hover:bg-blue-50 cursor-pointer"
                        onClick={() => setExpanded(isExpanded ? null : b.branchId)}
                      >
                        <td className="py-2 px-3 font-medium text-gray-800">
                          <span className="flex items-center gap-1">
                            <ChevronDownIcon
                              className={cn(
                                "w-3 h-3 text-gray-400 shrink-0 transition-transform",
                                isExpanded ? "rotate-180" : ""
                              )}
                            />
                            {b.branchName}
                          </span>
                        </td>
                        {type === "sales" && (
                          <>
                            <td className="text-right py-2 px-2 text-gray-700">{b.inquiries}</td>
                            <td className="text-right py-2 px-2 text-gray-700">{b.ptConsultations}</td>
                            <td className="text-right py-2 px-2 text-gray-700">{b.ptRegistrations}</td>
                            <td className="text-right py-2 px-2 text-gray-700">
                              {convRate === null ? "-" : `${convRate}%`}
                            </td>
                            <td className="text-right py-2 px-2 text-gray-700">{b.reRegistrations}</td>
                            <td className="text-right py-2 px-2 text-gray-700">{b.comebackMembers}</td>
                          </>
                        )}
                        {type === "tm" && (
                          <>
                            {(
                              [
                                { val: b.tmPhone, col: "phone" },
                                { val: b.tmSms,   col: "sms" },
                                { val: b.tmKakao, col: "kakao" },
                                { val: b.tmOther, col: "other" },
                                { val: b.tmTotal, col: "total" },
                              ] as { val: number; col: TmHighlight }[]
                            ).map(({ val, col }) => (
                              <td
                                key={col}
                                className={cn(
                                  "text-right py-2 px-2",
                                  tmHighlight === col
                                    ? "font-semibold text-[#1e3a5f]"
                                    : col === "total"
                                    ? "font-semibold text-gray-900"
                                    : "text-gray-700"
                                )}
                              >
                                {val}
                              </td>
                            ))}
                          </>
                        )}
                        {type === "promotion" && (
                          <>
                            <td className="text-right py-2 px-2 text-gray-700">{b.promoFlyer}</td>
                            <td className="text-right py-2 px-2 text-gray-700">{b.promoPlacard}</td>
                            <td className="text-right py-2 px-2 text-gray-700">{b.promoBanner}</td>
                            <td className="text-right py-2 px-2 text-gray-700">{b.promoPartnership}</td>
                            <td className="text-right py-2 px-2 text-gray-700">{b.promoEvent}</td>
                            <td className="text-right py-2 px-2 text-gray-700">{b.promoOther}</td>
                            <td className="text-right py-2 px-2 font-semibold text-gray-900">{b.promoTotal}</td>
                          </>
                        )}
                      </tr>

                      {/* Date drilldown row */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={colSpan} className="bg-blue-50 px-4 py-2">
                            {daily.length === 0 ? (
                              <p className="text-xs text-gray-400 py-1">날짜별 데이터 없음</p>
                            ) : (
                              <div className="space-y-0.5">
                                {daily.map((r) => (
                                  <div
                                    key={r.id}
                                    className="flex flex-wrap items-center gap-3 text-xs text-gray-700 hover:bg-blue-100 px-2 py-1.5 rounded cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      router.push(`/admin/reports/${r.id}`);
                                    }}
                                  >
                                    <span className="font-medium w-24 shrink-0">{r.reportDate}</span>
                                    {type === "sales" && (
                                      <>
                                        <span>문의 <b>{r.inquiries ?? 0}</b></span>
                                        <span>PT 상담 <b>{r.ptConsultations ?? 0}</b></span>
                                        <span>등록 <b>{r.ptRegistrations ?? 0}</b></span>
                                        <span>재등록 <b>{r.reRegistrations ?? 0}</b></span>
                                        <span>컴백 <b>{r.comebackMembers ?? 0}</b></span>
                                      </>
                                    )}
                                    {type === "tm" && (
                                      <>
                                        <span>전화 <b>{(r.expiringTm?.phone ?? 0) + (r.unregisteredTm?.phone ?? 0)}</b></span>
                                        <span>문자 <b>{(r.expiringTm?.sms ?? 0) + (r.unregisteredTm?.sms ?? 0)}</b></span>
                                        <span>카카오 <b>{(r.expiringTm?.kakao ?? 0) + (r.unregisteredTm?.kakao ?? 0)}</b></span>
                                        <span>기타 <b>{(r.expiringTm?.other ?? 0) + (r.unregisteredTm?.other ?? 0)}</b></span>
                                        <span>총합 <b>{getExpiringTmTotal(r) + getUnregisteredTmTotal(r)}</b></span>
                                      </>
                                    )}
                                    {type === "promotion" && (
                                      <>
                                        <span>전단지 <b>{r.offlinePromotion?.flyer ?? 0}</b></span>
                                        <span>현수막 <b>{r.offlinePromotion?.placard ?? 0}</b></span>
                                        <span>배너 <b>{r.offlinePromotion?.banner ?? 0}</b></span>
                                        <span>제휴 <b>{r.offlinePromotion?.partnership ?? 0}</b></span>
                                        <span>행사 <b>{r.offlinePromotion?.event ?? 0}</b></span>
                                        <span>기타 <b>{r.offlinePromotion?.other ?? 0}</b></span>
                                        <span>총합 <b>{getOfflinePromoTotal(r)}</b></span>
                                      </>
                                    )}
                                    <ChevronRightIcon className="w-3 h-3 ml-auto text-gray-400 shrink-0" />
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>

              {/* Totals footer */}
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td className="py-2 px-3 font-semibold text-gray-700 text-xs">합계</td>
                  {type === "sales" && (
                    <>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.inquiries}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.ptConsultations}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.ptRegistrations}</td>
                      <td className="text-right py-2 px-2 text-gray-500">
                        {totals.ptConsultations === 0 ? "-" : `${Math.round((totals.ptRegistrations / totals.ptConsultations) * 100)}%`}
                      </td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.reRegistrations}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.comebackMembers}</td>
                    </>
                  )}
                  {type === "tm" && (
                    <>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.tmPhone}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.tmSms}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.tmKakao}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.tmOther}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.tmTotal}</td>
                    </>
                  )}
                  {type === "promotion" && (
                    <>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.promoFlyer}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.promoPlacard}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.promoBanner}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.promoPartnership}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.promoEvent}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.promoOther}</td>
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{totals.promoTotal}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Mobile cards ──────────────────────────────────────────────── */}
          <div className="md:hidden space-y-2">
            {filtered.map((b) => {
              const convRate =
                b.ptConsultations === 0
                  ? null
                  : Math.round((b.ptRegistrations / b.ptConsultations) * 100);
              const isExpanded = expanded === b.branchId;
              const daily = dailyReports(b.branchId);

              return (
                <div key={b.branchId} className="bg-white border border-gray-200 rounded-lg p-3">
                  <button
                    className="w-full flex items-center justify-between"
                    onClick={() => setExpanded(isExpanded ? null : b.branchId)}
                  >
                    <span className="font-medium text-sm text-gray-900">{b.branchName}</span>
                    <ChevronDownIcon
                      className={cn(
                        "w-4 h-4 text-gray-400 transition-transform",
                        isExpanded ? "rotate-180" : ""
                      )}
                    />
                  </button>

                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {type === "sales" && (
                      <>
                        <span className="text-gray-500">문의 <b className="text-gray-800">{b.inquiries}</b></span>
                        <span className="text-gray-500">PT 상담 <b className="text-gray-800">{b.ptConsultations}</b></span>
                        <span className="text-gray-500">PT 등록 <b className="text-gray-800">{b.ptRegistrations}</b></span>
                        <span className="text-gray-500">전환율 <b className="text-gray-800">{convRate === null ? "-" : `${convRate}%`}</b></span>
                        <span className="text-gray-500">재등록 <b className="text-gray-800">{b.reRegistrations}</b></span>
                        <span className="text-gray-500">컴백회원 <b className="text-gray-800">{b.comebackMembers}</b></span>
                      </>
                    )}
                    {type === "tm" && (
                      <>
                        <span className="text-gray-500">전화 <b className="text-gray-800">{b.tmPhone}</b></span>
                        <span className="text-gray-500">문자 <b className="text-gray-800">{b.tmSms}</b></span>
                        <span className="text-gray-500">카카오톡 <b className="text-gray-800">{b.tmKakao}</b></span>
                        <span className="text-gray-500">기타 <b className="text-gray-800">{b.tmOther}</b></span>
                        <span className="text-gray-500">TM 총합 <b className="text-gray-800">{b.tmTotal}</b></span>
                      </>
                    )}
                    {type === "promotion" && (
                      <>
                        <span className="text-gray-500">전단지 <b className="text-gray-800">{b.promoFlyer}</b></span>
                        <span className="text-gray-500">현수막 <b className="text-gray-800">{b.promoPlacard}</b></span>
                        <span className="text-gray-500">배너 <b className="text-gray-800">{b.promoBanner}</b></span>
                        <span className="text-gray-500">제휴 <b className="text-gray-800">{b.promoPartnership}</b></span>
                        <span className="text-gray-500">외부 행사 <b className="text-gray-800">{b.promoEvent}</b></span>
                        <span className="text-gray-500">기타 <b className="text-gray-800">{b.promoOther}</b></span>
                        <span className="text-gray-500">총합 <b className="text-gray-800">{b.promoTotal}</b></span>
                      </>
                    )}
                  </div>

                  {isExpanded && daily.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                      {daily.map((r) => (
                        <div
                          key={r.id}
                          className="text-xs text-gray-600 hover:bg-gray-50 rounded px-1 py-1 cursor-pointer flex items-center gap-2"
                          onClick={() => router.push(`/admin/reports/${r.id}`)}
                        >
                          <span className="font-medium shrink-0">{r.reportDate}</span>
                          {type === "sales" && (
                            <span>문의 {r.inquiries ?? 0} / PT 상담 {r.ptConsultations ?? 0} / 등록 {r.ptRegistrations ?? 0}</span>
                          )}
                          {type === "tm" && (
                            <span>총합 {getExpiringTmTotal(r) + getUnregisteredTmTotal(r)}</span>
                          )}
                          {type === "promotion" && (
                            <span>총합 {getOfflinePromoTotal(r)}</span>
                          )}
                          <ChevronRightIcon className="w-3 h-3 ml-auto shrink-0 text-gray-400" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
