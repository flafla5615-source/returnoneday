"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import { getReport, reopenAbnormalSubmittedReport, upsertReport } from "@/services/reports";
import { getIssuesByReport, upsertIssues } from "@/services/issues";
import { getActivePromotionsForDate, sanitizeAmount } from "@/services/promotions";
import { getAllTrainers } from "@/services/trainers";
import {
  upsertTrainerSession,
  getTrainerSessionsByBranchAndDate,
} from "@/services/trainerSessions";
import TrainerSearchPicker from "@/components/trainers/TrainerSearchPicker";
import ReportStepper from "@/components/reports/ReportStepper";
import AutosaveIndicator from "@/components/reports/AutosaveIndicator";
import NumberInput from "@/components/reports/NumberInput";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import LoadingState from "@/components/common/LoadingState";
import {
  formatDate,
  calcPtConversionRate,
  formatPercent,
  getReportId,
  isAbnormalSubmittedReport,
  getKoreaToday,
  getKoreaYesterday,
  canManageReportDate,
  getOfflinePromoTotal,
  formatNumber,
} from "@/lib/utils";
import type {
  Branch,
  DailyReport,
  Issue,
  Trainer,
  Promotion,
  OnlinePromotionActivity,
  OfflinePromotionActivity,
} from "@/types";
import { ONLINE_PROMOTION_CHANNELS, OFFLINE_PROMOTION_TYPES } from "@/types";
import { format, subDays } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, TrashIcon } from "lucide-react";


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

// 홍보 건수·수량·비용 입력값 파싱 — 0 이상의 정수만 허용한다.
function parseCount(raw: string): number {
  const n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

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
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitError, setSubmitError] = useState("");
  const [allActiveTrainers, setAllActiveTrainers] = useState<Trainer[]>([]);
  const [trainerPerfs, setTrainerPerfs] = useState<TrainerPerfState[]>([]);
  // 저장 시 목록에서 제거된 트레이너의 기존 세션을 0회로 반영하기 위한 원본 스냅샷
  const [originalSessions, setOriginalSessions] = useState<{ trainerId: string; trainerName: string }[]>([]);
  const [actualWriterName, setActualWriterName] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchParams = useSearchParams();
  const requestedBranchId = searchParams?.get("branchId") ?? "";
  const todayDate = getKoreaToday();
  const allowedYesterdayDate = getKoreaYesterday();
  const reportDate = searchParams?.get("date") ?? todayDate;
  const ymd = format(subDays(new Date(reportDate), 1), "yyyy-MM-dd");
  const datePermission = canManageReportDate("branch_manager", reportDate);
  const isDateAllowed = datePermission === "ok";

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
  // Step 4 — 프로모션 관리
  const [promotionId, setPromotionId] = useState("");
  const [activePromotions, setActivePromotions] = useState<Promotion[]>([]);
  const [onlineActivities, setOnlineActivities] = useState<OnlinePromotionActivity[]>([]);
  const [offlineActivities, setOfflineActivities] = useState<OfflinePromotionActivity[]>([]);
  const [promotionInquiryCount, setPromotionInquiryCount] = useState<number | null>(null);
  const [promotionVisitCount, setPromotionVisitCount] = useState<number | null>(null);
  const [promotionRegistrationCount, setPromotionRegistrationCount] = useState<number | null>(null);
  const [promotionSalesAmount, setPromotionSalesAmount] = useState<number | null>(null);
  const [promotionNote, setPromotionNote] = useState("");
  const [promotionEvidenceLinks, setPromotionEvidenceLinks] = useState("");
  const [promotionEvidenceMemo, setPromotionEvidenceMemo] = useState("");
  const [hasNoPromotionActivity, setHasNoPromotionActivity] = useState(false);

  // Computed totals (derived — not stored as state)
  const expiringTmTotal = etPhone + etSms + etKakao + etOther;
  const unregisteredTmTotal = utPhone + utSms + utKakao + utOther;
  // 홍보비 합계는 항상 활동 행에서 계산한다 — 사용자가 직접 수정할 수 없다.
  const onlinePromotionCost = onlineActivities.reduce((sum, a) => sum + sanitizeAmount(a.cost), 0);
  const offlinePromotionCost = offlineActivities.reduce((sum, a) => sum + sanitizeAmount(a.cost), 0);
  const totalPromotionCost = onlinePromotionCost + offlinePromotionCost;

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
    setPromotionId("");
    setOnlineActivities([]);
    setOfflineActivities([]);
    setPromotionInquiryCount(null);
    setPromotionVisitCount(null);
    setPromotionRegistrationCount(null);
    setPromotionSalesAmount(null);
    setPromotionNote("");
    setPromotionEvidenceLinks("");
    setPromotionEvidenceMemo("");
    setHasNoPromotionActivity(false);
    setActualWriterName("");
    setIssues([defaultIssue("claim"), defaultIssue("staff"), defaultIssue("facility")]);
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
    // 4단계 프로모션 관리 — 기존 저장값을 그대로 불러온다.
    setPromotionId(report.promotionId ?? "");
    setOnlineActivities(report.onlinePromotionActivities ?? []);
    setOfflineActivities(report.offlinePromotionActivities ?? []);
    setPromotionInquiryCount(report.promotionInquiryCount ?? null);
    setPromotionVisitCount(report.promotionVisitCount ?? null);
    setPromotionRegistrationCount(report.promotionRegistrationCount ?? null);
    setPromotionSalesAmount(report.promotionSalesAmount ?? null);
    setPromotionNote(report.promotionNote ?? "");
    setPromotionEvidenceLinks(report.promotionEvidenceLinks ?? "");
    setPromotionEvidenceMemo(report.promotionEvidenceMemo ?? "");
    setHasNoPromotionActivity(report.hasNoPromotionActivity === true);
    setActualWriterName(report.actualWriterName ?? "");
  }, []);

  function updateOnlineActivity(index: number, patch: Partial<OnlinePromotionActivity>) {
    setOnlineActivities((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  function updateOfflineActivity(index: number, patch: Partial<OfflinePromotionActivity>) {
    setOfflineActivities((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  function updateTrainerPerf(trainerId: string, patch: Partial<TrainerPerfState>) {
    setTrainerPerfs((prev) =>
      prev.map((p) => (p.trainerId === trainerId ? { ...p, ...patch } : p))
    );
  }

  function handleAddTrainer(trainer: Trainer) {
    setTrainerPerfs((prev) => {
      if (prev.some((p) => p.trainerId === trainer.id)) return prev;
      return [
        ...prev,
        {
          trainerId: trainer.id,
          trainerName: trainer.name,
          ptSessionCount: 0,
          otSessionCount: 0,
          groupSessionCount: 0,
          otherSessionCount: 0,
          memo: "",
        },
      ];
    });
  }

  function handleRemoveTrainer(trainerId: string) {
    setTrainerPerfs((prev) => prev.filter((p) => p.trainerId !== trainerId));
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
        const [ex, yd, promos, allTrainers, existingSessions] = await Promise.all([
          getReport(selectedBranchId, reportDate),
          getReport(selectedBranchId, ymd),
          getActivePromotionsForDate(selectedBranchId, reportDate),
          getAllTrainers(),
          getTrainerSessionsByBranchAndDate(selectedBranchId, reportDate),
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

        // Trainer setup — 트레이너는 전사 공용이므로 지점으로 필터링하지 않는다.
        // 지점 변경/재조회 시 이전 지점의 입력값이 남지 않도록 항상 새로 덮어쓴다.
        setAllActiveTrainers(allTrainers.filter((t) => t.active));
        setTrainerPerfs(
          existingSessions.map((s) => ({
            trainerId: s.trainerId,
            trainerName: s.trainerName,
            ptSessionCount: s.ptSessionCount,
            otSessionCount: s.otSessionCount,
            groupSessionCount: s.groupSessionCount,
            otherSessionCount: s.otherSessionCount,
            memo: s.memo ?? "",
          }))
        );
        setOriginalSessions(
          existingSessions.map((s) => ({ trainerId: s.trainerId, trainerName: s.trainerName }))
        );

        setYesterday(yd);
        setActivePromotions(promos);
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

  const selectedPromotion = activePromotions.find((p) => p.id === promotionId) ?? null;

  // 저장 시 legacy 오프라인 홍보 필드(offlinePromotion / offlinePromotionTotal /
  // promotionMemo)는 포함하지 않는다 → updateDoc이 건드리지 않으므로 기존 값이 그대로 보존된다.
  const collectData = useCallback((): Partial<DailyReport> => {
    const cleanOnline = onlineActivities
      .filter((a) => a.channel)
      .map((a) => ({
        channel: a.channel,
        count: sanitizeAmount(a.count),
        cost: sanitizeAmount(a.cost),
        ...(a.link?.trim() ? { link: a.link.trim() } : {}),
        ...(a.memo?.trim() ? { memo: a.memo.trim() } : {}),
      }));
    const cleanOffline = offlineActivities
      .filter((a) => a.type)
      .map((a) => ({
        type: a.type,
        quantity: sanitizeAmount(a.quantity),
        cost: sanitizeAmount(a.cost),
        ...(a.location?.trim() ? { location: a.location.trim() } : {}),
        ...(a.memo?.trim() ? { memo: a.memo.trim() } : {}),
      }));
    const onlineCost = cleanOnline.reduce((s, a) => s + a.cost, 0);
    const offlineCost = cleanOffline.reduce((s, a) => s + a.cost, 0);

    return {
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

      // 4단계 프로모션 관리 — 같은 날짜 보고서를 다시 저장하면 배열 전체가 교체되므로
      // 중복 누적이 발생하지 않는다.
      promotionId: promotionId || "",
      promotionName: selectedPromotion?.name ?? "",
      onlinePromotionActivities: cleanOnline,
      offlinePromotionActivities: cleanOffline,
      onlinePromotionCost: onlineCost,
      offlinePromotionCost: offlineCost,
      totalPromotionCost: onlineCost + offlineCost,
      promotionInquiryCount: promotionInquiryCount,
      promotionVisitCount: promotionVisitCount,
      promotionRegistrationCount: promotionRegistrationCount,
      promotionSalesAmount: promotionSalesAmount,
      promotionNote: promotionNote.trim(),
      promotionEvidenceLinks: promotionEvidenceLinks.trim(),
      promotionEvidenceMemo: promotionEvidenceMemo.trim(),
      hasNoPromotionActivity,

      ...(actualWriterName.trim() ? { actualWriterName: actualWriterName.trim() } : {}),
    };
  }, [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls, etPhone, etSms, etKakao, etOther, utPhone, utSms, utKakao, utOther, promotionId, selectedPromotion, onlineActivities, offlineActivities, promotionInquiryCount, promotionVisitCount, promotionRegistrationCount, promotionSalesAmount, promotionNote, promotionEvidenceLinks, promotionEvidenceMemo, hasNoPromotionActivity, actualWriterName]);

  const hasAnyReportInput = useCallback(() => {
    return [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls]
      .some((v) => v !== null) ||
      [etPhone, etSms, etKakao, etOther, utPhone, utSms, utKakao, utOther]
      .some((v) => v > 0) ||
      // 프로모션 관리 입력 — "활동 없음" 체크도 사용자가 의도적으로 남긴 입력으로 취급한다.
      promotionId !== "" ||
      onlineActivities.length > 0 ||
      offlineActivities.length > 0 ||
      [promotionInquiryCount, promotionVisitCount, promotionRegistrationCount, promotionSalesAmount]
      .some((v) => v !== null) ||
      hasNoPromotionActivity ||
      promotionNote.trim().length > 0 ||
      promotionEvidenceLinks.trim().length > 0 ||
      promotionEvidenceMemo.trim().length > 0;
  }, [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls, etPhone, etSms, etKakao, etOther, utPhone, utSms, utKakao, utOther, promotionId, onlineActivities, offlineActivities, promotionInquiryCount, promotionVisitCount, promotionRegistrationCount, promotionSalesAmount, hasNoPromotionActivity, promotionNote, promotionEvidenceLinks, promotionEvidenceMemo]);

  const autoSave = useCallback(async () => {
    if (!selectedBranchId || !user) return;
    if (loading) return;
    const canEditReport = existing
      ? existing.status === "draft" || existing.status === "revision_required"
      : isDateAllowed;
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
  }, [selectedBranchId, reportDate, user, loading, existing, collectData, hasAnyReportInput, isDateAllowed]);

  const triggerDebounce = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => autoSave(), 1000);
  }, [autoSave]);

  // Debounce on field changes
  useEffect(() => { triggerDebounce(); }, [activeMembers, inquiries, ptConsultations, ptRegistrations, reRegistrations, comebackMembers, happyCalls, newHappyCalls, existingHappyCalls, etPhone, etSms, etKakao, etOther, utPhone, utSms, utKakao, utOther, promotionId, onlineActivities, offlineActivities, promotionInquiryCount, promotionVisitCount, promotionRegistrationCount, promotionSalesAmount, hasNoPromotionActivity, promotionNote, promotionEvidenceLinks, promotionEvidenceMemo, triggerDebounce]);

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

    const canEditReport = existing
      ? existing.status === "draft" || existing.status === "revision_required"
      : isDateAllowed;
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

      // 프로모션 실적은 별도 컬렉션이 아니라 위 upsertReport로 일일보고 원본에 저장된다
      // (branchId + reportDate 문서 1개) — 월 누적은 조회 시 합산하므로 이중 누적이 없다.

      // Save trainer sessions
      const trainerErrors: string[] = [];
      for (const perf of trainerPerfs) {
        try {
          await upsertTrainerSession({
            branchId: selectedBranchId,
            date: reportDate,
            trainerId: perf.trainerId,
            trainerName: perf.trainerName,
            ptSessionCount: perf.ptSessionCount,
            otSessionCount: perf.otSessionCount,
            groupSessionCount: perf.groupSessionCount,
            otherSessionCount: perf.otherSessionCount,
            memo: perf.memo,
            createdBy: user.uid,
          });
        } catch (tErr) {
          console.error(`trainer session save failed: ${perf.trainerName}`, tErr);
          trainerErrors.push(perf.trainerName);
        }
      }

      // 목록에서 제거한 트레이너는 문서를 삭제하지 않고 0회로 갱신한다.
      const removedTrainers = originalSessions.filter(
        (o) => !trainerPerfs.some((p) => p.trainerId === o.trainerId)
      );
      for (const removed of removedTrainers) {
        try {
          await upsertTrainerSession({
            branchId: selectedBranchId,
            date: reportDate,
            trainerId: removed.trainerId,
            trainerName: removed.trainerName,
            ptSessionCount: 0,
            otSessionCount: 0,
            groupSessionCount: 0,
            otherSessionCount: 0,
            memo: "",
            createdBy: user.uid,
          });
        } catch (tErr) {
          console.error(`trainer session zero-out failed: ${removed.trainerName}`, tErr);
          trainerErrors.push(removed.trainerName);
        }
      }

      if (trainerErrors.length > 0) {
        setSubmitError(`트레이너 세션 저장 실패: ${trainerErrors.join(", ")} — 다시 시도해주세요.`);
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
  const selectedBranchName = branches.find((b) => b.id === selectedBranchId)?.name ?? "";

  if (loading) return <LoadingState />;

  const isLocked = existing?.status === "locked";
  const isSubmitted = existing?.status === "submitted";
  const isRevisionRequired = existing?.status === "revision_required";
  const canEditReport = existing ? (existing.status === "draft" || isRevisionRequired) : isDateAllowed;
  const isDataMissing = isAbnormalSubmittedReport(existing);
  const blockedNewReport = !existing && !isDateAllowed;

  // 과거 2단계에서 입력된 오프라인 홍보 기록이 있으면 읽기 전용으로만 보여준다.
  const legacyOfflinePromotion =
    existing?.offlinePromotion && getOfflinePromoTotal(existing) > 0
      ? existing.offlinePromotion
      : null;

  function handleDateChange(nextDate: string) {
    setLoading(true);
    router.replace(`/manager/report/new?branchId=${selectedBranchId}&date=${nextDate}`);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-base font-bold text-gray-900">일일보고 작성</h1>
          <p className="text-xs text-gray-400">{formatDate(reportDate)}</p>
        </div>
        <div className="flex items-center gap-2">
          {!blockedNewReport ? (
            <select
              value={reportDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white"
            >
              <option value={todayDate}>오늘 ({todayDate})</option>
              <option value={allowedYesterdayDate}>전일 ({allowedYesterdayDate})</option>
              {reportDate !== todayDate && reportDate !== allowedYesterdayDate && (
                <option value={reportDate}>{reportDate}</option>
              )}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => handleDateChange(todayDate)}
              className="border border-red-200 text-red-700 bg-red-50 rounded-lg px-2 py-1 text-xs hover:bg-red-100"
            >
              오늘 날짜로 이동
            </button>
          )}
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

      <p className="text-xs text-gray-400">
        오늘 또는 전일 업무보고를 작성할 수 있습니다. 자정 이후 전일 업무를 작성하는 경우 보고일을 전일로 선택해주세요.
      </p>

      {blockedNewReport && datePermission === "future_blocked" && (
        <div className="bg-red-50 text-red-700 border border-red-100 rounded-xl px-4 py-3 text-sm">
          미래 날짜의 업무보고는 작성할 수 없습니다.
        </div>
      )}
      {blockedNewReport && datePermission === "too_old_blocked" && (
        <div className="bg-red-50 text-red-700 border border-red-100 rounded-xl px-4 py-3 text-sm">
          지난 보고서 수정은 본사 관리자에게 요청해주세요.
        </div>
      )}
      {!blockedNewReport && !existing && reportDate === allowedYesterdayDate && (
        <div className="bg-blue-50 text-blue-700 border border-blue-100 rounded-xl px-4 py-3 text-sm">
          전일 업무보고를 작성하고 있습니다.
        </div>
      )}
      {existing && (
        <div className="bg-gray-50 text-gray-600 border border-gray-200 rounded-xl px-4 py-3 text-sm">
          선택한 날짜의 기존 보고서를 불러왔습니다.
        </div>
      )}

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

      {/* Step 2: TM only (홍보는 4단계 프로모션 관리로 이동) */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-6">
          <h2 className="font-semibold text-gray-800">2. TM 활동</h2>

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

          <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">
            홍보 활동은 4단계 프로모션 관리에서 입력합니다.
          </p>

          {/* 기존 오프라인 홍보 기록 — 과거 보고서에만 표시하는 읽기 전용 영역.
              신규 입력은 4단계에서만 하고, 여기 값은 수정·삭제하지 않는다. */}
          {legacyOfflinePromotion && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
              <p className="text-sm font-medium text-gray-700">기존 오프라인 홍보 기록 (읽기 전용)</p>
              <p className="text-xs text-gray-400">
                이전 버전에서 2단계에 입력된 기록입니다. 수정은 되지 않으며 기록 보존용으로만 표시됩니다.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-gray-600">
                <span>전단지 <b className="text-gray-800">{legacyOfflinePromotion.flyer}</b>개</span>
                <span>현수막 <b className="text-gray-800">{legacyOfflinePromotion.placard}</b>개</span>
                <span>배너 <b className="text-gray-800">{legacyOfflinePromotion.banner}</b>개</span>
                <span>제휴 <b className="text-gray-800">{legacyOfflinePromotion.partnership}</b>개</span>
                <span>외부 행사 <b className="text-gray-800">{legacyOfflinePromotion.event}</b>개</span>
                <span>기타 <b className="text-gray-800">{legacyOfflinePromotion.other}</b>개</span>
              </div>
              <p className="text-xs text-gray-500">
                총합 <b className="text-gray-800">{getOfflinePromoTotal(existing ?? {})}</b>개
              </p>
              {existing?.promotionMemo && (
                <p className="text-xs text-gray-500">기존 홍보 메모: {existing.promotionMemo}</p>
              )}
            </div>
          )}
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

      {/* Step 4: 프로모션 관리 */}
      {step === 4 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-6">
          <div>
            <h2 className="font-semibold text-gray-800">4. 프로모션 관리</h2>
            <p className="text-xs text-gray-500 mt-1">
              {formatDate(reportDate)} · {selectedBranchName}
            </p>
          </div>

          {/* 오늘 프로모션 활동 없음 — 미작성 상태와 구분하기 위한 명시적 체크 */}
          <label className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hasNoPromotionActivity}
              disabled={!canEditReport}
              onChange={(e) => {
                const checked = e.target.checked;
                setHasNoPromotionActivity(checked);
                if (checked) {
                  // 활동 없음: 홍보 행과 성과를 0으로 비운다 (메모는 선택사항으로 남긴다)
                  setOnlineActivities([]);
                  setOfflineActivities([]);
                  setPromotionInquiryCount(0);
                  setPromotionVisitCount(0);
                  setPromotionRegistrationCount(0);
                  setPromotionSalesAmount(0);
                }
              }}
              className="mt-0.5"
            />
            <span className="text-xs text-gray-600">
              오늘 프로모션 활동 없음
              <span className="block text-gray-400">
                선택하면 홍보 0건, 비용 0원, 성과 0으로 저장됩니다. 메모는 선택 입력입니다.
              </span>
            </span>
          </label>

          {/* 1. 당월 프로모션 선택 */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700">1. 당월 프로모션 선택</h3>
            <select
              value={promotionId}
              disabled={!canEditReport}
              onChange={(e) => setPromotionId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">프로모션 없음</option>
              {activePromotions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.startDate} ~ {p.endDate})
                </option>
              ))}
            </select>
            {activePromotions.length === 0 ? (
              <p className="text-xs text-gray-400">
                보고일에 진행 중인 프로모션이 없습니다. 프로모션 없이 홍보 활동만 기록할 수 있습니다.
              </p>
            ) : selectedPromotion ? (
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 space-y-0.5">
                {selectedPromotion.purpose && <p>목적: {selectedPromotion.purpose}</p>}
                {selectedPromotion.targetAudience && <p>대상: {selectedPromotion.targetAudience}</p>}
                {selectedPromotion.benefitDescription && <p>혜택: {selectedPromotion.benefitDescription}</p>}
                <p className="text-gray-400">
                  프로모션 내용은 프로모션 관리에 저장된 값이며 매일 다시 입력하지 않습니다.
                </p>
              </div>
            ) : (
              <p className="text-xs text-amber-600">
                프로모션 없음 상태입니다. 성과는 특정 프로모션에 연결되지 않습니다.
              </p>
            )}
          </div>

          {/* 2. 오늘 온라인 홍보 */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">2. 오늘 온라인 홍보</h3>
              <button
                type="button"
                disabled={!canEditReport || hasNoPromotionActivity}
                onClick={() =>
                  setOnlineActivities((prev) => [
                    ...prev,
                    { channel: ONLINE_PROMOTION_CHANNELS[0], count: 0, cost: 0, link: "", memo: "" },
                  ])
                }
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-[#1e3a5f] text-[#1e3a5f] rounded-lg hover:bg-[#1e3a5f]/5 disabled:opacity-40"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                온라인 홍보 추가
              </button>
            </div>
            {onlineActivities.length === 0 ? (
              <p className="text-xs text-gray-400">실제 실행한 채널만 추가해주세요.</p>
            ) : (
              <div className="space-y-3">
                {onlineActivities.map((a, idx) => (
                  <div key={idx} className="border border-gray-100 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={a.channel}
                        disabled={!canEditReport}
                        onChange={(e) => updateOnlineActivity(idx, { channel: e.target.value })}
                        className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                      >
                        {ONLINE_PROMOTION_CHANNELS.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!canEditReport}
                        onClick={() => setOnlineActivities((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-gray-100 disabled:opacity-40"
                        title="삭제"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-700">실행 건수</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={a.count === 0 ? "" : a.count}
                          placeholder="0"
                          disabled={!canEditReport}
                          onChange={(e) => updateOnlineActivity(idx, { count: parseCount(e.target.value) })}
                          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-700">비용 (원)</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={a.cost === 0 ? "" : a.cost}
                          placeholder="0"
                          disabled={!canEditReport}
                          onChange={(e) => updateOnlineActivity(idx, { cost: parseCount(e.target.value) })}
                          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                        />
                      </div>
                    </div>
                    <input
                      type="url"
                      value={a.link ?? ""}
                      placeholder="게시물·광고 링크 (선택)"
                      disabled={!canEditReport}
                      onChange={(e) => updateOnlineActivity(idx, { link: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                    />
                    <input
                      type="text"
                      value={a.memo ?? ""}
                      placeholder="메모 (선택)"
                      disabled={!canEditReport}
                      onChange={(e) => updateOnlineActivity(idx, { memo: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. 오늘 오프라인 홍보 */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">3. 오늘 오프라인 홍보</h3>
              <button
                type="button"
                disabled={!canEditReport || hasNoPromotionActivity}
                onClick={() =>
                  setOfflineActivities((prev) => [
                    ...prev,
                    { type: OFFLINE_PROMOTION_TYPES[0], quantity: 0, location: "", cost: 0, memo: "" },
                  ])
                }
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-[#1e3a5f] text-[#1e3a5f] rounded-lg hover:bg-[#1e3a5f]/5 disabled:opacity-40"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                오프라인 홍보 추가
              </button>
            </div>
            {offlineActivities.length === 0 ? (
              <p className="text-xs text-gray-400">실제 진행한 홍보만 추가해주세요.</p>
            ) : (
              <div className="space-y-3">
                {offlineActivities.map((a, idx) => (
                  <div key={idx} className="border border-gray-100 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={a.type}
                        disabled={!canEditReport}
                        onChange={(e) => updateOfflineActivity(idx, { type: e.target.value })}
                        className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                      >
                        {OFFLINE_PROMOTION_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!canEditReport}
                        onClick={() => setOfflineActivities((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-gray-100 disabled:opacity-40"
                        title="삭제"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-700">수량</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={a.quantity === 0 ? "" : a.quantity}
                          placeholder="0"
                          disabled={!canEditReport}
                          onChange={(e) => updateOfflineActivity(idx, { quantity: parseCount(e.target.value) })}
                          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-700">비용 (원)</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={a.cost === 0 ? "" : a.cost}
                          placeholder="0"
                          disabled={!canEditReport}
                          onChange={(e) => updateOfflineActivity(idx, { cost: parseCount(e.target.value) })}
                          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                        />
                      </div>
                    </div>
                    <input
                      type="text"
                      value={a.location ?? ""}
                      placeholder="위치 (선택)"
                      disabled={!canEditReport}
                      onChange={(e) => updateOfflineActivity(idx, { location: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                    />
                    <input
                      type="text"
                      value={a.memo ?? ""}
                      placeholder="메모 (선택)"
                      disabled={!canEditReport}
                      onChange={(e) => updateOfflineActivity(idx, { memo: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-50"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 4. 오늘 홍보비 — 자동 합계, 직접 수정 불가 */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-700">4. 오늘 홍보비</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500">온라인 비용</p>
                <p className="text-base font-bold text-gray-800">{formatNumber(onlinePromotionCost)}원</p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500">오프라인 비용</p>
                <p className="text-base font-bold text-gray-800">{formatNumber(offlinePromotionCost)}원</p>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-blue-700 font-medium">오늘 총 홍보비</span>
              <span className="text-base font-bold text-blue-800">
                {formatNumber(totalPromotionCost)}원
                <span className="ml-1 text-xs font-normal text-blue-500">자동 계산</span>
              </span>
            </div>
          </div>

          {/* 5. 오늘 프로모션 성과 */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-700">5. 오늘 프로모션 성과</h3>
            {!selectedPromotion && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                프로모션 없음 상태로 입력됩니다.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="프로모션 문의 수" value={promotionInquiryCount} onChange={setPromotionInquiryCount} unit="건" />
              <NumberInput label="프로모션 방문 수" value={promotionVisitCount} onChange={setPromotionVisitCount} unit="건" />
              <NumberInput label="프로모션 등록 수" value={promotionRegistrationCount} onChange={setPromotionRegistrationCount} unit="건" />
              <NumberInput label="프로모션 매출" value={promotionSalesAmount} onChange={setPromotionSalesAmount} unit="원" />
            </div>
          </div>

          {/* 6. 프로모션 메모·증빙 */}
          <div className="space-y-3 pt-2 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-700">6. 프로모션 메모·증빙</h3>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">프로모션 메모</label>
              <textarea
                value={promotionNote}
                rows={2}
                placeholder="오늘 프로모션 진행 내용 메모"
                disabled={!canEditReport}
                onChange={(e) => setPromotionNote(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">게시물·광고 링크</label>
              <textarea
                value={promotionEvidenceLinks}
                rows={2}
                placeholder="링크를 한 줄에 하나씩 입력"
                disabled={!canEditReport}
                onChange={(e) => setPromotionEvidenceLinks(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">증빙 메모</label>
              <textarea
                value={promotionEvidenceMemo}
                rows={2}
                placeholder="영수증·증빙 관련 메모 (사진 업로드는 후속 작업)"
                disabled={!canEditReport}
                onChange={(e) => setPromotionEvidenceMemo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none disabled:bg-gray-50"
              />
            </div>
          </div>

          {/* 기존 캠페인 기록 — 과거 보고서 보존용 읽기 전용 안내 */}
          {existing?.promotionMemo && (
            <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">
              이 보고서에는 이전 버전의 홍보 메모가 남아 있습니다. 2단계에서 읽기 전용으로 확인할 수 있습니다.
            </p>
          )}
        </div>
      )}

      {/* Step 5: Trainer performance */}
      {step === 5 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-5">
          <div>
            <h2 className="font-semibold text-gray-800">5. 트레이너 실적</h2>
            <p className="text-xs text-gray-500 mt-1">입력 지점: {selectedBranchName}</p>
          </div>

          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            선택한 지점에서 진행한 세션만 입력해주세요.
          </p>

          <TrainerSearchPicker
            trainers={allActiveTrainers}
            excludeIds={trainerPerfs.map((p) => p.trainerId)}
            onSelect={handleAddTrainer}
            firstRegisteredBranchId={selectedBranchId}
            createdBy={user?.uid ?? ""}
            disabled={!canEditReport}
          />

          {trainerPerfs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">아직 추가된 트레이너가 없습니다.</p>
              <p className="text-xs text-gray-400 mt-0.5">위 검색창에서 트레이너를 찾아 추가해주세요.</p>
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
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-800">{perf.trainerName}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[#1e3a5f]">
                          총 세션 {totalSessions}회
                          <span className="ml-1 text-xs font-normal text-gray-400">자동 계산</span>
                        </p>
                        {canEditReport && (
                          <button
                            type="button"
                            onClick={() => handleRemoveTrainer(perf.trainerId)}
                            className="text-xs text-gray-400 hover:text-red-500"
                          >
                            제거
                          </button>
                        )}
                      </div>
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
              {existing ? "보고서 수정" : "보고서 저장"}
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
