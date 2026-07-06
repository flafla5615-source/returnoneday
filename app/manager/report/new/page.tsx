"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import { getReport, reopenAbnormalSubmittedReport, upsertReport } from "@/services/reports";
import { getIssuesByReport, upsertIssues } from "@/services/issues";
import { getActiveCampaigns, upsertCampaignResult, getCampaignResultByReport } from "@/services/campaigns";
import { getAllTrainers } from "@/services/trainers";
import {
  upsertTrainerDailyReport,
  getTrainerDailyReportsByBranchAndDate,
} from "@/services/trainerDailyReports";
import ReportStepper from "@/components/reports/ReportStepper";
import AutosaveIndicator from "@/components/reports/AutosaveIndicator";
import NumberInput from "@/components/reports/NumberInput";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import LoadingState from "@/components/common/LoadingState";
import {
  todayYMD,
  formatDate,
  calcPtConversionRate,
  formatPercent,
  getReportId,
  isAbnormalSubmittedReport,
} from "@/lib/utils";
import type { Branch, DailyReport, Issue, Campaign, Trainer } from "@/types";
import { format, subDays } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";


type TrainerPerfState = {
  trainerId: string;
  trainerName: string;
  ptSessionCount: number;
  otSessionCount: number;
  groupSessionCount: number;
  otherSessionCount: number;
  memo: string;
};

const CLAIM_CATEGORIES = ["회원 응대", "환불", "시설 불만", "직원 불만", "기타"];
const STAFF_CATEGORIES = ["결근", "퇴사 예정", "채용 필요", "직원 갈등", "기타"];
const FACILITY_CATEGORIES = ["기구 고장", "냉난방", "전기", "수도", "청소", "기타"];

type IssueForm = {
  type: "claim" | "staff" | "facility";
  hasIssue: boolean;
  category: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "in_progress" | "resolved";
  memo: string;
};

const defaultIssue = (type: "claim" | "staff" | "facility"): IssueForm => ({
  type,
  hasIssue: false,
  category: "",
  description: "",
  severity: "low",
  status: "open",
  memo: "",
});

export default function NewReportPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [existing, setExisting] = useState<DailyReport | null>(null);
  const [yesterday, setYesterday] = useState<DailyReport | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignResults, setCampaignResults] = useState<Record<string, Record<string, number | null>>>({});
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitError, setSubmitError] = useState("");
  const [branchTrainers, setBranchTrainers] = useState<Trainer[]>([]);
  const [trainerPerfs, setTrainerPerfs] = useState<TrainerPerfState[]>([]);
  const [actualWriterName, setActualWriterName] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchParams = useSearchParams();
  const requestedBranchId = searchParams?.get("branchId") ?? "";
  const reportDate = searchParams?.get("date") ?? todayYMD();
  const ymd = format(subDays(new Date(reportDate), 1), "yyyy-MM-dd");
  const reportId = selectedBranchId ? getReportId(selectedBranchId, reportDate) : "";

  // Step 1 fields
  const [activeMembers, setActiveMembers] = useState<number | null>(null);
  const [inquiries, setInquiries] = useState<number | null>(null);
  const [ptConsultations, setPtConsultations] = useState<number | null>(null);
  const [ptRegistrations, setPtRegistrations] = useState<number | null>(null);
  const [reRegistrations, setReRegistrations] = useState<number | null>(null);
  const [comebackMembers, setComebackMembers] = useState<number | null>(null);
  const [happyCalls, setHappyCalls] = useState<number | null>(null);
  const [newHappyCalls, setNewHappyCalls] = useState<number | null>(null);
  const [existingHappyCalls, setExistingHappyCalls] = useState<number | null>(null);

  // Step 2 — expiringTm per-channel
  const [etPhone, setEtPhone] = useState(0);
  const [etSms, setEtSms] = useState(0);
  const [etKakao, setEtKakao] = useState(0);
  const [etOther, setEtOther] = useState(0);
  // Step 2 — unregisteredTm per-channel
  const [utPhone, setUtPhone] = useState(0);
  const [utSms, setUtSms] = useState(0);
  const [utKakao, setUtKakao] = useState(0);
  const [utOther, setUtOther] = useState(0);
  // Step 2 — offlinePromotion per-channel
  const [opFlyer, setOpFlyer] = useState(0);
  const [opPlacard, setOpPlacard] = useState(0);
  const [opBanner, setOpBanner] = useState(0);
  const [opPartnership, setOpPartnership] = useState(0);
  const [opEvent, setOpEvent] = useState(0);
  const [opOther, setOpOther] = useState(0);
  const [promotionMemo, setPromotionMemo] = useState("");

  // Computed totals (derived — not stored as state)
  const expiringTmTotal = etPhone + etSms + etKakao + etOther;
  const unregisteredTmTotal = utPhone + utSms + utKakao + utOther;
  const offlinePromotionTotal = opFlyer + opPlacard + opBanner + opPartnership + opEvent + opOther;

  // Step 3 issues
  const [issues, setIssues] = useState<IssueForm[]>([
    defaultIssue("claim"),
    defaultIssue("staff"),
    defaultIssue("facility"),
  ]);

  const resetReportForm = useCallback(() => {
    setExisting(null);
    setActiveMembers(null);
    setInquiries(null);
    setPtConsultations(null);
    setPtRegistrations(null);
    setReRegistrations(null);
    setComebackMembers(null);
    setHappyCalls(null);
    setNewHappyCalls(null);
    setExistingHappyCalls(null);
    setEtPhone(0); setEtSms(0); setEtKakao(0); setEtOther(0);
    setUtPhone(0); setUtSms(0); setUtKakao(0); setUtOther(0);
    setOpFlyer(0); setOpPlacard(0); setOpBanner(0); setOpPartnership(0); setOpEvent(0); setOpOther(0);
    setPromotionMemo("");
    setActualWriterName("");
    setIssues([defaultIssue("claim"), defaultIssue("staff"), defaultIssue("facility")]);
    setCampaignResults({});
    setLastSaved(null);
  }, []);

  const applyReport = useCallback((report: DailyReport) => {
    setExisting(report);
    setActiveMembers(report.activeMembers);
    setInquiries(report.inquiries);
    setPtConsultations(report.ptConsultations);
    setPtRegistrations(report.ptRegistrations);
    setReRegistrations(report.reRegistrations);
    setComebackMembers(report.comebackMembers);
    setHappyCalls(report.happyCalls);
    setNewHappyCalls(report.newHappyCalls);
    setExistingHappyCalls(report.existingHappyCalls);
    // New structure
    if (report.expiringTm) {
      setEtPhone(report.expiringTm.phone); setEtSms(report.expiringTm.sms);
      setEtKakao(report.expiringTm.kakao); setEtOther(report.expiringTm.other);
    } else {
      setEtPhone(0); setEtSms(0); setEtKakao(0); setEtOther(0);
    }
    if (report.unregisteredTm) {
      setUtPhone(report.unregisteredTm.phone); setUtSms(report.unregisteredTm.sms);
      setUtKakao(report.unregisteredTm.kakao); setUtOther(report.unregisteredTm.other);
    } else {
      setUtPhone(0); setUtSms(0); setUtKakao(0); setUtOther(0);
    }
    if (report.offlinePromotion) {
      setOpFlyer(report.offlinePromotion.flyer); setOpPlacard(report.offlinePromotion.placard);
      setOpBanner(report.offlinePromotion.banner); setOpPartnership(report.offlinePromotion.partnership);
      setOpEvent(report.offlinePromotion.event); setOpOther(report.offlinePromotion.other);
    } else {
      setOpFlyer(0); setOpPlacard(0); setOpBanner(0); setOpPartnership(0); setOpEvent(0); setOpOther(0);
    }
    setPromotionMemo(report.promotionMemo ?? "");
    setActualWriterName(report.actualWriterName ?? "");
  }, []);

  function updateTrainerPerf(trainerId: string, patch: Partial<TrainerPerfState>) {
    setTrainerPerfs((prev) =>
      prev.map((p) => (p.trainerId === trainerId ? { ...p, ...patch } : p))
    );
  }

  const applyIssues = useCallback((reportIssues: Issue[]) => {
    const issueMap = new Map(reportIssues.map((issue) => [issue.type, issue]));
    setIssues((["claim", "staff", "facility"] as Issue["type"][]).map((type) => {
      const issue = issueMap.get(type);
      return issue
        ? {
            type,
            hasIssue: true,
            category: issue.category,
            description: issue.description,
            severity: issue.severity,
            status: issue.status,
            memo: issue.memo ?? "",
          }
        : defaultIssue(type);
    }));
  }, []);

  useEffect(() => {
    if (!profile) return;
    getBranchesByIds(profile.branchIds).then((bs) => {
      setBranches(bs);
      if (bs.length > 0) {
        const storageKey = `returnlife_branch_${profile.uid}`;
        const saved = localStorage.getItem(storageKey);
        const byUrl = requestedBranchId ? bs.find((b) => b.id === requestedBranchId) : null;
        const byStorage = saved ? bs.find((b) => b.id === saved) : null;
        setSelectedBranchId((byUrl ?? byStorage ?? bs[0]).id);
      }
      if (bs.length === 0) setLoading(false);
    });
  }, [profile, requestedBranchId]);

  useEffect(() => {
    if (!selectedBranchId) return;
    let cancelled = false;
    const currentReportId = getReportId(selectedBranchId, reportDate);

    async function loadReportContext() {
      try {
        const [ex, yd, cps, allTrainers, existingTrainerReports] = await Promise.all([
          getReport(selectedBranchId, reportDate),
          getReport(selectedBranchId, ymd),
          getActiveCampaigns(selectedBranchId),
          getAllTrainers(),
          getTrainerDailyReportsByBranchAndDate(selectedBranchId, reportDate),
        ]);
        let reportIssues: Issue[] = [];
        if (ex) {
          try {
            reportIssues = await getIssuesByReport(currentReportId);
          } catch (issueError) {
            console.error("[Report] Failed to load report issues", issueError);
          }
        }
        if (cancelled) return;

        // Trainer setup
        const filteredTrainers = allTrainers.filter(
          (t) => t.active && t.branchIds.includes(selectedBranchId)
        );
        const existingPerfMap = new Map(existingTrainerReports.map((r) => [r.trainerId, r]));
        setBranchTrainers(filteredTrainers);
        setTrainerPerfs(
          filteredTrainers.map((t) => {
            const ep = existingPerfMap.get(t.id);
            return {
              trainerId: t.id,
              trainerName: t.name,
              ptSessionCount: ep?.ptSessionCount ?? 0,
              otSessionCount: ep?.otSessionCount ?? 0,
              groupSessionCount: ep?.groupSessionCount ?? 0,
              otherSessionCount: ep?.otherSessionCount ?? 0,
              memo: ep?.memo ?? "",
            };
          })
        );

        setYesterday(yd);
        setCampaigns(cps);
        if (cps.length === 0) setCampaignResults({});
        setLastSaved(null);
        if (ex) {
          applyReport(ex);
          applyIssues(reportIssues);
        } else {
          resetReportForm();
        }
      } catch (error) {
        console.error("[Report] Failed to load report context", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadReportContext();
    return () => { cancelled = true; };
  }, [selectedBranchId, reportDate, ymd, applyIssues, applyReport, resetReportForm]);

  // Load campaign results
  useEffect(() => {
    if (!reportId) return;
    if (campaigns.length === 0) return;
    let cancelled = false;
    const rMap: Record<string, Record<string, number | null>> = {};
    Promise.all(
      campaigns.map(async (c) => {
        const res = await getCampaignResultByReport(c.id, reportId);
        rMap[c.id] = res?.metrics ?? {};
      })
    ).then(() => {
      if (!cancelled) setCampaignResults(rMap);
    });
    return () => {
      cancelled = true;
    };
  }, [reportId, campaigns]);

  const collectData = useCallback((): Partial<DailyReport> => ({
    activeMembers,
    inquiries,
    ptConsultations,
    ptRegistrations,
    reRegistrations,
    comebackMembers,
    happyCalls,
    newHappyCalls,
    existingHappyCalls,
    expiringTm: { phone: etPhone, sms: etSms, kakao: etKakao, other: etOther },
    expiringTmTotal: etPhone + etSms + etKakao + etOther,
    unregisteredTm: { phone: utPhone, sms: utSms, kakao: utKakao, other: utOther },
    unregisteredTmTotal: utPhone + utSms + utKakao + utOther,
    offlinePromotion: { flyer: opFlyer, placard: opPlacard, banner: opBanner, partnership: opPartnership, event: opEvent, other: opOther },
    offlinePromotionTotal: opFlyer + opPlacard + opBanner + opPartnership + opEvent + opOther,
    ...(promotionMemo ? { promotionMemo } : {}),
    ...(actualWriterName.trim() ? { actualWriterName: actualWriterName.trim() } : {}),
  }), [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls, etPhone, etSms, etKakao, etOther, utPhone, utSms, utKakao, utOther, opFlyer, opPlacard, opBanner, opPartnership, opEvent, opOther, promotionMemo, actualWriterName]);

  const hasAnyReportInput = useCallback(() => {
    return [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls]
      .some((v) => v !== null) ||
      [etPhone, etSms, etKakao, etOther, utPhone, utSms, utKakao, utOther, opFlyer, opPlacard, opBanner, opPartnership, opEvent, opOther]
      .some((v) => v > 0) ||
      promotionMemo.trim().length > 0;
  }, [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls, etPhone, etSms, etKakao, etOther, utPhone, utSms, utKakao, utOther, opFlyer, opPlacard, opBanner, opPartnership, opEvent, opOther, promotionMemo]);

  const autoSave = useCallback(async () => {
    if (!selectedBranchId || !user) return;
    if (loading) return;
    const canEditReport = !existing || existing.status === "draft" || existing.status === "revision_required";
    if (!canEditReport) return;
    if (!existing && !hasAnyReportInput()) return;
    setSaving(true);
    try {
      const nextStatus = existing?.status === "revision_required" ? "revision_required" : "draft";
      await upsertReport(selectedBranchId, reportDate, user.uid, collectData(), nextStatus);
      setLastSaved(new Date());
    } finally {
      setSaving(false);
    }
  }, [selectedBranchId, reportDate, user, loading, existing, collectData, hasAnyReportInput]);

  const triggerDebounce = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => autoSave(), 1000);
  }, [autoSave]);

  // Debounce on field changes
  useEffect(() => { triggerDebounce(); }, [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls, etPhone, etSms, etKakao, etOther, utPhone, utSms, utKakao, utOther, opFlyer, opPlacard, opBanner, opPartnership, opEvent, opOther, promotionMemo, triggerDebounce]);

  async function handleSubmit() {
    setSubmitError("");

    // Pre-submit validation with console log
    console.log("report submit attempt:", {
      branchId: selectedBranchId,
      reportDate,
      writerUid: user?.uid,
      status: "submitted",
      reportData: collectData(),
    });

    if (!user) {
      setSubmitError("로그인 상태를 확인해주세요.");
      return;
    }
    if (!selectedBranchId) {
      setSubmitError("지점이 선택되지 않았습니다. 관리자에게 지점 배정을 요청하세요.");
      return;
    }
    if (!reportDate) {
      setSubmitError("보고 날짜를 확인해주세요.");
      return;
    }

    const canEditReport = !existing || existing.status === "draft" || existing.status === "revision_required";
    if (!canEditReport) return;

    if (existing && existing.branchId !== selectedBranchId) {
      setSubmitError(`지점 불일치 오류: 저장된 보고서(${existing.branchId})와 선택된 지점(${selectedBranchId})이 다릅니다.`);
      return;
    }

    setSaving(true);
    try {
      const editableStatus = existing?.status === "revision_required" ? "revision_required" : "draft";
      const reportData = collectData();
      const rid = await upsertReport(selectedBranchId, reportDate, user.uid, reportData, editableStatus);

      // Save issues (while report is still draft - security rule requirement)
      const activeIssues = issues
        .filter((iss) => iss.hasIssue && iss.description)
        .map((iss) => ({
          type: iss.type,
          category: iss.category,
          description: iss.description,
          severity: iss.severity,
          status: iss.status,
          ...(iss.memo ? { memo: iss.memo } : {}),
        }));
      await upsertIssues(rid, selectedBranchId, reportDate, activeIssues);

      // Save campaign results
      for (const c of campaigns) {
        const metrics = campaignResults[c.id] ?? {};
        if (Object.keys(metrics).length > 0) {
          await upsertCampaignResult(c.id, rid, selectedBranchId, reportDate, metrics);
        }
      }

      // Save trainer daily reports (session counts)
      const trainerErrors: string[] = [];
      for (const perf of trainerPerfs) {
        try {
          await upsertTrainerDailyReport({
            branchId: selectedBranchId,
            reportDate,
            trainerId: perf.trainerId,
            trainerName: perf.trainerName,
            ptSessionCount: perf.ptSessionCount,
            otSessionCount: perf.otSessionCount,
            groupSessionCount: perf.groupSessionCount,
            otherSessionCount: perf.otherSessionCount,
            memo: perf.memo,
            writerUid: user.uid,
          });
        } catch (tErr) {
          console.error(`trainer report save failed: ${perf.trainerName}`, tErr);
          trainerErrors.push(perf.trainerName);
        }
      }
      if (trainerErrors.length > 0) {
        setSubmitError(`트레이너 실적 저장 실패: ${trainerErrors.join(", ")} — 다시 시도해주세요.`);
        return;
      }

      // Final: set status to submitted
      await upsertReport(selectedBranchId, reportDate, user.uid, reportData, "submitted");

      console.log("report submit success:", rid);
      router.push("/manager");
    } catch (err) {
      console.error("report submit failed:", err);
      if (err instanceof FirebaseError) {
        console.error("firebase code:", err.code);
        console.error("firebase message:", err.message);
      }
      const code = err instanceof FirebaseError ? err.code : (err as { code?: string })?.code ?? "unknown";
      const detail = err instanceof FirebaseError ? ` — ${err.message}` : "";
      const msg =
        code === "permission-denied"
          ? "저장 권한이 없습니다. 계정의 지점 배정 여부와 활성 상태를 확인하세요. (permission-denied)"
          : code === "unauthenticated"
            ? "로그인 세션이 만료되었습니다. 다시 로그인해주세요."
            : `보고서 저장에 실패했습니다. (${code})${detail}`;
      setSubmitError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleRewriteAbnormalReport() {
    if (!existing) return;
    setSubmitError("");
    setSaving(true);
    try {
      await reopenAbnormalSubmittedReport(existing.id);
      setExisting({ ...existing, status: "draft" });
    } catch (err) {
      console.error("abnormal report reopen failed:", err);
      if (err instanceof FirebaseError) {
        console.error("firebase code:", err.code);
        console.error("firebase message:", err.message);
      }
      const code = err instanceof FirebaseError ? err.code : (err as { code?: string })?.code ?? "unknown";
      setSubmitError(
        code === "permission-denied"
          ? "보고서를 다시 작성할 권한이 없습니다. 관리자에게 문의하세요. (permission-denied)"
          : `보고서를 다시 작성 상태로 변경하지 못했습니다. (${code})`
      );
    } finally {
      setSaving(false);
    }
  }

  const convRate = calcPtConversionRate(ptConsultations, ptRegistrations);

  if (loading) return <LoadingState />;

  const isLocked = existing?.status === "locked";
  const isSubmitted = existing?.status === "submitted";
  const isRevisionRequired = existing?.status === "revision_required";
  const canEditReport = !existing || existing.status === "draft" || isRevisionRequired;
  const isDataMissing = isAbnormalSubmittedReport(existing);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-gray-900">일일보고 작성</h1>
          <p className="text-xs text-gray-400">{formatDate(reportDate)}</p>
        </div>
        <div className="flex items-center gap-2">
          {branches.length > 1 && (
            <select
              value={selectedBranchId}
              onChange={(e) => {
                const newId = e.target.value;
                setLoading(true);
                setSelectedBranchId(newId);
                router.replace(`/manager/report/new?branchId=${newId}&date=${reportDate}`);
              }}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white"
            >
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {isLocked && (
        <div className="bg-gray-100 text-gray-600 rounded-xl px-4 py-3 text-sm">
          이 보고서는 잠금 처리되어 수정할 수 없습니다.
        </div>
      )}

      {isSubmitted && !isDataMissing && (
        <div className="bg-blue-50 text-blue-700 border border-blue-100 rounded-xl px-4 py-3 text-sm">
          제출 완료된 보고서입니다. 관리자가 수정 요청을 보내기 전까지는 내용을 변경할 수 없습니다.
        </div>
      )}
      {isDataMissing && (
        <div className="bg-amber-50 text-amber-700 border border-amber-200 rounded-xl px-4 py-3 text-sm space-y-3">
          <p>제출 데이터 확인 필요: 제출 기록은 있으나 주요 데이터가 비어 있습니다.</p>
          <button
            type="button"
            onClick={handleRewriteAbnormalReport}
            disabled={saving}
            className="px-3 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
          >
            {saving ? "준비 중..." : "보고 다시 작성하기"}
          </button>
        </div>
      )}

      {isRevisionRequired && (
        <div className="bg-orange-50 text-orange-700 border border-orange-100 rounded-xl px-4 py-3 text-sm">
          관리자가 수정을 요청한 보고서입니다. 내용을 보완한 뒤 다시 제출해주세요.
        </div>
      )}

      {/* Stepper */}
      <ReportStepper current={step} onChange={setStep} />

      {/* Step 1: Sales */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
          <h2 className="font-semibold text-gray-800">1. 영업 지표</h2>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">실제 작성자명 (선택)</label>
            <input
              type="text"
              value={actualWriterName}
              onChange={(e) => setActualWriterName(e.target.value)}
              placeholder="지점 운영계정으로 작성하는 경우 실제 작성자 이름"
              disabled={!canEditReport}
              className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <NumberInput
              label="유효회원"
              value={activeMembers}
              onChange={setActiveMembers}
              unit="명"
              required
              subText={
                yesterday?.activeMembers != null
                  ? `전일 ${yesterday.activeMembers}명`
                  : "전일 데이터 없음"
              }
            />
            <NumberInput label="회원권·PT 문의수" value={inquiries} onChange={setInquiries} unit="건" required />
            <NumberInput label="PT 신규 상담수" value={ptConsultations} onChange={setPtConsultations} unit="건" required />
            <NumberInput label="PT 전환 등록" value={ptRegistrations} onChange={setPtRegistrations} unit="건" required />
          </div>

          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-500">PT 상담 전환율</p>
            <p className="text-lg font-bold text-gray-800">{formatPercent(convRate)}</p>
            <p className="text-xs text-gray-400">자동 계산</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <NumberInput label="재등록" value={reRegistrations} onChange={setReRegistrations} unit="명" required />
            <NumberInput label="컴백회원" value={comebackMembers} onChange={setComebackMembers} unit="명" required />
            <NumberInput label="기존 해피콜" value={existingHappyCalls} onChange={setExistingHappyCalls} unit="명" required />
            <NumberInput label="신규 해피콜" value={newHappyCalls} onChange={setNewHappyCalls} unit="명" required />
          </div>

          <NumberInput
            label="전체 해피콜"
            value={happyCalls}
            onChange={setHappyCalls}
            unit="건"
            required
          />
        </div>
      )}

      {/* Step 2: TM & Promotion */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-6">
          <h2 className="font-semibold text-gray-800">2. TM·홍보 활동</h2>

          {/* Expiring TM */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">1. 만료·홀드 회원 TM</h3>
              <button
                type="button"
                onClick={() => { setEtPhone(0); setEtSms(0); setEtKakao(0); setEtOther(0); }}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                초기화
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { label: "전화", val: etPhone, set: setEtPhone },
                { label: "문자", val: etSms, set: setEtSms },
                { label: "카카오톡", val: etKakao, set: setEtKakao },
                { label: "기타", val: etOther, set: setEtOther },
              ] as const).map(({ label, val, set }) => (
                <div key={label} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">{label}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={val}
                      onChange={(e) => { const n = parseInt(e.target.value, 10); set(isNaN(n) || n < 0 ? 0 : n); }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap">건</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-gray-500">만료 TM 총합</span>
              <span className="text-base font-bold text-gray-800">{expiringTmTotal}건 <span className="text-xs font-normal text-gray-400">자동 계산</span></span>
            </div>
          </div>

          {/* Unregistered TM */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">2. 미등록 회원 TM</h3>
              <button
                type="button"
                onClick={() => { setUtPhone(0); setUtSms(0); setUtKakao(0); setUtOther(0); }}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                초기화
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { label: "전화", val: utPhone, set: setUtPhone },
                { label: "문자", val: utSms, set: setUtSms },
                { label: "카카오톡", val: utKakao, set: setUtKakao },
                { label: "기타", val: utOther, set: setUtOther },
              ] as const).map(({ label, val, set }) => (
                <div key={label} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">{label}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={val}
                      onChange={(e) => { const n = parseInt(e.target.value, 10); set(isNaN(n) || n < 0 ? 0 : n); }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap">건</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-gray-500">미등록 TM 총합</span>
              <span className="text-base font-bold text-gray-800">{unregisteredTmTotal}건 <span className="text-xs font-normal text-gray-400">자동 계산</span></span>
            </div>
          </div>

          <div className="bg-blue-50 rounded-lg px-3 py-2 flex items-center justify-between border border-blue-100">
            <span className="text-xs text-blue-700 font-medium">전체 TM 총합 (만료+미등록)</span>
            <span className="text-base font-bold text-blue-800">{expiringTmTotal + unregisteredTmTotal}건</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setEtPhone(0); setEtSms(0); setEtKakao(0); setEtOther(0);
              setUtPhone(0); setUtSms(0); setUtKakao(0); setUtOther(0);
            }}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            오늘 TM 활동 없음 (전체 초기화)
          </button>

          {/* Offline Promotion */}
          <div className="space-y-3 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">3. 오프라인 홍보 활동</h3>
              <button
                type="button"
                onClick={() => { setOpFlyer(0); setOpPlacard(0); setOpBanner(0); setOpPartnership(0); setOpEvent(0); setOpOther(0); }}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                초기화
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { label: "전단지", val: opFlyer, set: setOpFlyer },
                { label: "현수막", val: opPlacard, set: setOpPlacard },
                { label: "배너", val: opBanner, set: setOpBanner },
                { label: "제휴", val: opPartnership, set: setOpPartnership },
                { label: "외부 행사", val: opEvent, set: setOpEvent },
                { label: "기타", val: opOther, set: setOpOther },
              ] as const).map(({ label, val, set }) => (
                <div key={label} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">{label}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={val}
                      onChange={(e) => { const n = parseInt(e.target.value, 10); set(isNaN(n) || n < 0 ? 0 : n); }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap">개</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-gray-500">홍보 총합</span>
              <span className="text-base font-bold text-gray-800">{offlinePromotionTotal}개 <span className="text-xs font-normal text-gray-400">자동 계산</span></span>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">홍보 메모</label>
              <textarea
                value={promotionMemo}
                onChange={(e) => setPromotionMemo(e.target.value)}
                rows={2}
                placeholder="홍보 활동 내용 메모"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              />
            </div>

            <button
              type="button"
              onClick={() => { setOpFlyer(0); setOpPlacard(0); setOpBanner(0); setOpPartnership(0); setOpEvent(0); setOpOther(0); }}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              오늘 오프라인 홍보 없음
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Issues */}
      {step === 3 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-5">
          <h2 className="font-semibold text-gray-800">3. 운영 이슈</h2>
          {issues.map((iss, idx) => {
            const categories =
              iss.type === "claim" ? CLAIM_CATEGORIES :
              iss.type === "staff" ? STAFF_CATEGORIES :
              FACILITY_CATEGORIES;
            const typeLabel = iss.type === "claim" ? "클레임" : iss.type === "staff" ? "인력 이슈" : "시설 이슈";

            return (
              <div key={iss.type} className="border border-gray-100 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-800">{typeLabel}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...issues];
                        next[idx] = { ...next[idx], hasIssue: false };
                        setIssues(next);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${!iss.hasIssue ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"}`}
                    >
                      없음
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...issues];
                        next[idx] = { ...next[idx], hasIssue: true };
                        setIssues(next);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${iss.hasIssue ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600"}`}
                    >
                      있음
                    </button>
                  </div>
                </div>

                {iss.hasIssue && (
                  <div className="space-y-3 pt-2">
                    <div>
                      <label className="text-xs font-medium text-gray-700 block mb-1">카테고리</label>
                      <select
                        value={iss.category}
                        onChange={(e) => {
                          const next = [...issues];
                          next[idx] = { ...next[idx], category: e.target.value };
                          setIssues(next);
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      >
                        <option value="">카테고리 선택</option>
                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-gray-700 block mb-1">내용</label>
                      <textarea
                        value={iss.description}
                        onChange={(e) => {
                          const next = [...issues];
                          next[idx] = { ...next[idx], description: e.target.value };
                          setIssues(next);
                        }}
                        rows={2}
                        placeholder="이슈 내용을 입력하세요"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-gray-700 block mb-1">중요도 <span className="text-red-500">*</span></label>
                        <select
                          value={iss.severity}
                          onChange={(e) => {
                            const next = [...issues];
                            next[idx] = { ...next[idx], severity: e.target.value as Issue["severity"] };
                            setIssues(next);
                          }}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                          <option value="low">낮음</option>
                          <option value="medium">중간</option>
                          <option value="high">높음</option>
                          <option value="critical">긴급</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700 block mb-1">처리 상태 <span className="text-red-500">*</span></label>
                        <select
                          value={iss.status}
                          onChange={(e) => {
                            const next = [...issues];
                            next[idx] = { ...next[idx], status: e.target.value as Issue["status"] };
                            setIssues(next);
                          }}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                          <option value="open">미해결</option>
                          <option value="in_progress">처리 중</option>
                          <option value="resolved">해결됨</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Step 4: Campaigns */}
      {step === 4 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-5">
          <h2 className="font-semibold text-gray-800">4. 캠페인 실적</h2>
          {campaigns.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">현재 진행 중인 캠페인이 없습니다.</p>
          ) : (
            campaigns.map((c) => (
              <div key={c.id} className="border border-gray-100 rounded-xl p-4 space-y-3">
                <div>
                  <p className="font-medium text-gray-800 text-sm">{c.name}</p>
                  <p className="text-xs text-gray-400">기간: {formatDate(c.startDate)} ~ {formatDate(c.endDate)}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {c.metricDefinitions.map((metric) => (
                    <NumberInput
                      key={metric.key}
                      label={metric.label}
                      value={campaignResults[c.id]?.[metric.key] ?? null}
                      onChange={(val) => {
                        setCampaignResults((prev) => ({
                          ...prev,
                          [c.id]: { ...(prev[c.id] ?? {}), [metric.key]: val },
                        }));
                      }}
                      unit="건"
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Step 5: Trainer performance */}
      {step === 5 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-5">
          <h2 className="font-semibold text-gray-800">5. 트레이너 실적</h2>

          {branchTrainers.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <p className="text-sm text-gray-500">등록된 트레이너가 없습니다.</p>
              <p className="text-xs text-gray-400">관리자에게 트레이너 등록을 요청하세요.</p>
            </div>
          ) : (
            <>
              {trainerPerfs.map((perf) => {
                const totalSessions =
                  perf.ptSessionCount + perf.otSessionCount +
                  perf.groupSessionCount + perf.otherSessionCount;
                return (
                  <div
                    key={perf.trainerId}
                    className="border border-gray-100 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-800">{perf.trainerName}</p>
                      <p className="text-sm font-bold text-[#1e3a5f]">
                        총 세션 {totalSessions}회
                        <span className="ml-1 text-xs font-normal text-gray-400">자동 계산</span>
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {(
                        [
                          { label: "PT 수업", field: "ptSessionCount" as const, val: perf.ptSessionCount },
                          { label: "OT / 체험 수업", field: "otSessionCount" as const, val: perf.otSessionCount },
                          { label: "그룹수업", field: "groupSessionCount" as const, val: perf.groupSessionCount },
                          { label: "기타 수업", field: "otherSessionCount" as const, val: perf.otherSessionCount },
                        ] as const
                      ).map(({ label, field, val }) => (
                        <div key={field} className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-gray-700">{label}</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              value={val === 0 ? "" : val}
                              placeholder="0"
                              disabled={!canEditReport}
                              onChange={(e) => {
                                const n = parseInt(e.target.value, 10);
                                updateTrainerPerf(perf.trainerId, {
                                  [field]: isNaN(n) || n < 0 ? 0 : Math.floor(n),
                                });
                              }}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-50 disabled:text-gray-400"
                            />
                            <span className="text-xs text-gray-500 whitespace-nowrap">회</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div>
                      <label className="text-xs font-medium text-gray-700 block mb-1">메모 (선택)</label>
                      <textarea
                        value={perf.memo}
                        rows={1}
                        placeholder="특이사항 메모"
                        disabled={!canEditReport}
                        onChange={(e) =>
                          updateTrainerPerf(perf.trainerId, { memo: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    </div>
                  </div>
                );
              })}

              <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-blue-700 font-medium">트레이너 합계</span>
                <p className="text-sm font-bold text-blue-800">
                  총 세션{" "}
                  {trainerPerfs.reduce(
                    (s, p) =>
                      s + p.ptSessionCount + p.otSessionCount +
                      p.groupSessionCount + p.otherSessionCount,
                    0
                  )}회
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Bottom navigation */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <AutosaveIndicator saving={saving} lastSaved={lastSaved} />
          <div className="flex gap-2 ml-auto">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                <ChevronLeftIcon className="w-4 h-4" />
                이전
              </button>
            )}
            <button
              onClick={autoSave}
              disabled={!canEditReport || saving}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              임시 저장
            </button>
            {step < 5 ? (
              <button
                onClick={() => { autoSave(); setStep(step + 1); }}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f]"
              >
                다음 단계
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            ) : (
              <button
                disabled={!canEditReport || saving}
                onClick={() => setSubmitOpen(true)}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                제출하기
              </button>
            )}
          </div>
        </div>
      </div>

      {submitError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-700">제출 실패</p>
          <p className="text-sm text-red-500 mt-0.5">{submitError}</p>
        </div>
      )}

      <ConfirmDialog
        open={submitOpen}
        title="일일보고를 제출하시겠습니까?"
        description="제출 후 마감시간이 지나면 수정할 수 없습니다."
        confirmLabel="제출"
        onConfirm={() => { setSubmitOpen(false); void handleSubmit(); }}
        onCancel={() => setSubmitOpen(false)}
      />
    </div>
  );
}
