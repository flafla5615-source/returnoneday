"use client";

import { useEffect, useState } from "react";
import {
  describeSubmission,
  editVersionTime,
  formatLateDuration,
  weekdayLabel,
} from "@/lib/shiftSchedule";
import { ShiftStateBadge } from "@/components/common/StatusBadge";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  SHIFT_DEADLINE,
  SHIFT_LABEL,
  SHIFT_TYPES,
  type Branch,
  type BranchShiftReport,
  type ShiftSubmissionState,
  type ShiftType,
} from "@/types";
import { HistoryIcon, XIcon } from "lucide-react";

export type ShiftMap = Record<ShiftType, BranchShiftReport | null>;

export interface BranchRow {
  branch: Branch;
  reports: ShiftMap;
  states: Record<ShiftType, ShiftSubmissionState>;
}

/* 현황표 한 칸 — 상태·제출 시각·지연 시간만. 원문은 넣지 않는다. */
export function ShiftSummaryCell({
  shift,
  report,
  state,
  reportDate,
}: {
  shift: ShiftType;
  report: BranchShiftReport | null;
  state: ShiftSubmissionState;
  reportDate: string;
}) {
  const info = describeSubmission(report, reportDate, shift);

  return (
    <div className="space-y-0.5">
      <ShiftStateBadge state={state} />
      {info.submittedAt && (
        <p className="text-xs text-gray-500">{formatDateTime(info.submittedAt)}</p>
      )}
      {info.lateByMs > 0 && (
        <p className="text-[11px] font-medium text-amber-700">
          {formatLateDuration(info.lateByMs)} 지연
        </p>
      )}
      {info.backdated && (
        <p className="text-[11px] text-amber-600">소급 {info.daysAfterReportDate}일</p>
      )}
      {!!report?.editCount && (
        <p className="flex items-center gap-1 text-[11px] text-gray-400">
          <HistoryIcon className="h-3 w-3" />
          수정 {report.editCount}회
        </p>
      )}
    </div>
  );
}

/* 보고 원문 상세 — PC는 넓은 모달, 모바일은 화면 폭을 꽉 쓰는 전체 화면.
   오전·마감을 각각 별도 카드로 보여주고, 내용이 길면 이 안에서 세로 스크롤한다. */
export function ReportDetailPanel({
  row,
  reportDate,
  onClose,
}: {
  row: BranchRow;
  reportDate: string;
  onClose: () => void;
}) {
  // Esc 로 닫기 + 열려 있는 동안 뒤 배경이 같이 스크롤되지 않게 막는다
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${row.branch.name} 일일보고`}
        className="relative flex h-full w-full flex-col bg-white shadow-2xl md:h-auto md:max-h-[85vh] md:w-[min(48rem,92vw)] md:rounded-2xl"
      >
        {/* 헤더 — 스크롤해도 고정 */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 md:px-6 md:py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-gray-900">{row.branch.name}</p>
            <p className="text-xs text-gray-400">
              {row.branch.brand} · 보고일 {formatDate(reportDate)} ({weekdayLabel(reportDate)})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* 본문 — 길면 여기서만 세로 스크롤 */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-6">
          {SHIFT_TYPES.map((shift) => (
            <ShiftReportCard
              key={shift}
              shift={shift}
              report={row.reports[shift]}
              state={row.states[shift]}
              reportDate={reportDate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* 오전 / 마감 각각의 카드 */
export function ShiftReportCard({
  shift,
  report,
  state,
  reportDate,
}: {
  shift: ShiftType;
  report: BranchShiftReport | null;
  state: ShiftSubmissionState;
  reportDate: string;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const info = describeSubmission(report, reportDate, shift);

  return (
    <section className="rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800">{SHIFT_LABEL[shift]}</h3>
          <ShiftStateBadge state={state} />
        </div>
        <p className="text-xs text-gray-400">기한 {SHIFT_DEADLINE[shift]}</p>
      </div>

      <div className="px-4 py-3">
        {report ? (
          <>
            {/*
              whitespace-pre-wrap : 작성자가 넣은 줄바꿈·공백·빈 줄을 그대로 유지
              break-keep          : 한글을 글자 단위로 쪼개지 않는다 (word-break: keep-all)
              break-words         : 끊을 수 없는 긴 문자열(URL 등)만 접어 가로 스크롤을 막는다
            */}
            <p className="whitespace-pre-wrap break-words break-keep text-sm leading-relaxed text-gray-800">
              {report.content || "(내용 없음)"}
            </p>

            <dl className="mt-4 space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-gray-400">최초 제출</dt>
                <dd>
                  {info.submittedAt ? formatDateTime(info.submittedAt) : "임시저장 (미제출)"}
                  {info.lateByMs > 0 && (
                    <span className="ml-1 font-medium text-amber-700">
                      · {formatLateDuration(info.lateByMs)} 지연
                    </span>
                  )}
                  {info.backdated && (
                    <span className="ml-1 text-amber-600">
                      · {info.daysAfterReportDate}일 뒤 소급 작성
                    </span>
                  )}
                </dd>
              </div>
              {report.updatedAt && report.editCount > 0 && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-gray-400">최종 수정</dt>
                  <dd>
                    {formatDateTime(report.updatedAt.toDate())} · {report.editCount}회
                  </dd>
                </div>
              )}
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-gray-400">작성자</dt>
                <dd>{report.writerName}</dd>
              </div>
            </dl>

            {report.editCount > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowHistory((v) => !v)}
                  className="text-xs text-gray-500 underline hover:text-gray-700"
                >
                  수정 이력 {showHistory ? "접기" : "보기"}
                </button>
                {showHistory && (
                  <ul className="mt-2 space-y-2">
                    {[...(report.edits ?? [])].reverse().map((edit, i) => {
                      const t = editVersionTime(edit);
                      return (
                        <li key={i} className="rounded-lg bg-gray-50 p-2.5">
                          <p className="text-[11px] text-gray-500">
                            {t.at ? `${formatDateTime(t.at)} 저장본` : "저장 시각 기록 없음"}
                            {t.at && t.fromDeviceClock && (
                              <span className="text-gray-400"> (기기 시각)</span>
                            )}
                            {` · 수정자 ${edit.editedByName}`}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words break-keep text-xs leading-relaxed text-gray-600">
                            {edit.previousContent || "(이전 내용 없음)"}
                          </p>
                        </li>
                      );
                    })}
                    {report.editCount > (report.edits ?? []).length && (
                      <li className="text-[11px] text-gray-400">
                        오래된 이력 {report.editCount - (report.edits ?? []).length}건은 보관 한도를
                        넘어 본문이 남아 있지 않습니다.
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="py-2 text-sm text-gray-400">작성된 보고가 없습니다.</p>
        )}
      </div>
    </section>
  );
}
