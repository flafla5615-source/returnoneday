"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import { getReport, upsertReport } from "@/services/reports";
import { getIssuesByReport, upsertIssues } from "@/services/issues";
import { getActiveCampaigns, upsertCampaignResult, getCampaignResultByReport } from "@/services/campaigns";
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
} from "@/lib/utils";
import type { Branch, DailyReport, Issue, Campaign } from "@/types";
import { format, subDays } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

const TM_METHODS = ["전화", "문자", "카카오톡", "기타"];
const PROMO_METHODS = ["전단지", "현수막", "배너", "제휴", "외부 행사", "기타"];

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchParams = useSearchParams();
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

  // Step 2 fields
  const [expiringTmCount, setExpiringTmCount] = useState<number | null>(null);
  const [expiringTmMethods, setExpiringTmMethods] = useState<string[]>([]);
  const [unregisteredTmCount, setUnregisteredTmCount] = useState<number | null>(null);
  const [unregisteredTmMethods, setUnregisteredTmMethods] = useState<string[]>([]);
  const [offlinePromotionCount, setOfflinePromotionCount] = useState<number | null>(null);
  const [offlinePromotionMethods, setOfflinePromotionMethods] = useState<string[]>([]);
  const [promotionMemo, setPromotionMemo] = useState("");

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
    setExpiringTmCount(null);
    setExpiringTmMethods([]);
    setUnregisteredTmCount(null);
    setUnregisteredTmMethods([]);
    setOfflinePromotionCount(null);
    setOfflinePromotionMethods([]);
    setPromotionMemo("");
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
    setExpiringTmCount(report.expiringTmCount);
    setExpiringTmMethods(report.expiringTmMethods);
    setUnregisteredTmCount(report.unregisteredTmCount);
    setUnregisteredTmMethods(report.unregisteredTmMethods);
    setOfflinePromotionCount(report.offlinePromotionCount);
    setOfflinePromotionMethods(report.offlinePromotionMethods);
    setPromotionMemo(report.promotionMemo ?? "");
  }, []);

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
      if (bs.length > 0) setSelectedBranchId(bs[0].id);
      if (bs.length === 0) setLoading(false);
    });
  }, [profile]);

  useEffect(() => {
    if (!selectedBranchId) return;
    let cancelled = false;
    const currentReportId = getReportId(selectedBranchId, reportDate);

    async function loadReportContext() {
      try {
        const [ex, yd, cps] = await Promise.all([
          getReport(selectedBranchId, reportDate),
          getReport(selectedBranchId, ymd),
          getActiveCampaigns(selectedBranchId),
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
    expiringTmCount,
    expiringTmMethods,
    unregisteredTmCount,
    unregisteredTmMethods,
    offlinePromotionCount,
    offlinePromotionMethods,
    promotionMemo: promotionMemo || undefined,
  }), [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls, expiringTmCount, expiringTmMethods, unregisteredTmCount, unregisteredTmMethods, offlinePromotionCount, offlinePromotionMethods, promotionMemo]);

  const hasAnyReportInput = useCallback(() => {
    return [
      activeMembers,
      inquiries,
      ptConsultations,
      ptRegistrations,
      reRegistrations,
      comebackMembers,
      happyCalls,
      newHappyCalls,
      existingHappyCalls,
      expiringTmCount,
      unregisteredTmCount,
      offlinePromotionCount,
    ].some((value) => value !== null) ||
      expiringTmMethods.length > 0 ||
      unregisteredTmMethods.length > 0 ||
      offlinePromotionMethods.length > 0 ||
      promotionMemo.trim().length > 0;
  }, [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls, expiringTmCount, unregisteredTmCount, offlinePromotionCount, expiringTmMethods, unregisteredTmMethods, offlinePromotionMethods, promotionMemo]);

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
  useEffect(() => { triggerDebounce(); }, [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls, expiringTmCount, expiringTmMethods, unregisteredTmCount, unregisteredTmMethods, offlinePromotionCount, offlinePromotionMethods, promotionMemo, triggerDebounce]);

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
          memo: iss.memo || undefined,
        }));
      await upsertIssues(rid, selectedBranchId, reportDate, activeIssues);

      // Save campaign results
      for (const c of campaigns) {
        const metrics = campaignResults[c.id] ?? {};
        if (Object.keys(metrics).length > 0) {
          await upsertCampaignResult(c.id, rid, selectedBranchId, reportDate, metrics);
        }
      }

      // Final: set status to submitted
      await upsertReport(selectedBranchId, reportDate, user.uid, reportData, "submitted");

      console.log("report submit success:", rid);
      router.push("/manager");
    } catch (err) {
      console.error("report submit failed:", err);
      const code = (err as { code?: string })?.code ?? "unknown";
      const msg =
        code === "permission-denied"
          ? "저장 권한이 없습니다. 계정의 지점 배정 여부와 활성 상태를 확인하세요. (permission-denied)"
          : code === "unauthenticated"
            ? "로그인 세션이 만료되었습니다. 다시 로그인해주세요."
            : `보고서 저장에 실패했습니다. (${code})`;
      setSubmitError(msg);
    } finally {
      setSaving(false);
    }
  }

  function toggleMethod(
    arr: string[],
    setArr: (v: string[]) => void,
    val: string
  ) {
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  }

  const convRate = calcPtConversionRate(ptConsultations, ptRegistrations);

  if (loading) return <LoadingState />;

  const isLocked = existing?.status === "locked";
  const isSubmitted = existing?.status === "submitted";
  const isRevisionRequired = existing?.status === "revision_required";
  const canEditReport = !existing || existing.status === "draft" || isRevisionRequired;

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
                setLoading(true);
                setSelectedBranchId(e.target.value);
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

      {isSubmitted && (
        <div className="bg-blue-50 text-blue-700 border border-blue-100 rounded-xl px-4 py-3 text-sm">
          제출 완료된 보고서입니다. 관리자가 수정 요청을 보내기 전까지는 내용을 변경할 수 없습니다.
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

          {/* TM */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">1. TM 활동</h3>
            <div className="grid grid-cols-2 gap-4">
              <NumberInput label="만료·홀드 회원 TM수" value={expiringTmCount} onChange={setExpiringTmCount} unit="명" required />
              <div>
                <p className="text-xs font-medium text-gray-700 mb-1">TM 방식</p>
                <div className="flex flex-wrap gap-2">
                  {TM_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMethod(expiringTmMethods, setExpiringTmMethods, m)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        expiringTmMethods.includes(m)
                          ? "bg-red-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <NumberInput label="미등록 회원 TM수" value={unregisteredTmCount} onChange={setUnregisteredTmCount} unit="명" required />
              <div>
                <p className="text-xs font-medium text-gray-700 mb-1">미등록 TM 방식</p>
                <div className="flex flex-wrap gap-2">
                  {TM_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMethod(unregisteredTmMethods, setUnregisteredTmMethods, m)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        unregisteredTmMethods.includes(m)
                          ? "bg-red-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => { setExpiringTmCount(0); setUnregisteredTmCount(0); setExpiringTmMethods([]); setUnregisteredTmMethods([]); }}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              오늘 TM 활동 없음
            </button>
          </div>

          {/* Promotion */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">2. 오프라인 홍보 활동</h3>
            <div className="grid grid-cols-2 gap-4">
              <NumberInput label="오프라인 홍보 수량" value={offlinePromotionCount} onChange={setOfflinePromotionCount} unit="개" required />
              <div>
                <p className="text-xs font-medium text-gray-700 mb-1">홍보 방식</p>
                <div className="flex flex-wrap gap-2">
                  {PROMO_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMethod(offlinePromotionMethods, setOfflinePromotionMethods, m)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        offlinePromotionMethods.includes(m)
                          ? "bg-red-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
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
              onClick={() => { setOfflinePromotionCount(0); setOfflinePromotionMethods([]); }}
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
            {step < 4 ? (
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
