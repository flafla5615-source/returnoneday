"use client";

import { useState } from "react";
import DetailPanel from "@/components/common/DetailPanel";
import { formatDateTime } from "@/lib/utils";
import { weekOfMonthLabel, weekRangeLabel } from "@/lib/weekSchedule";
import { editVersionTime } from "@/lib/shiftSchedule";
import {
  WEEKLY_STATE_LABEL,
  type BranchWeeklyReport,
  type WeeklyReportState,
} from "@/types";
import { cn } from "@/lib/utils";

/* 주간보고 공용 표시 컴포넌트.
   본문은 어디서든 같은 규칙으로 그린다.
     whitespace-pre-wrap : 작성자가 넣은 줄바꿈·빈 줄·문단을 그대로 유지
     break-keep          : 한글을 글자 단위로 쪼개지 않는다
     break-words         : 끊을 수 없는 긴 문자열(URL 등)만 접어 가로 스크롤을 막는다 */

const STATE_CLASS: Record<WeeklyReportState, string> = {
  submitted: "bg-green-100 text-green-700",
  draft: "bg-gray-100 text-gray-600",
  none: "bg-red-100 text-red-700",
};

export function WeeklyStateBadge({ state }: { state: WeeklyReportState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATE_CLASS[state]
      )}
    >
      {WEEKLY_STATE_LABEL[state]}
    </span>
  );
}

export function WeeklyReportBody({ content }: { content: string }) {
  return (
    <p className="whitespace-pre-wrap break-words break-keep text-sm leading-relaxed text-gray-800">
      {content || "(내용 없음)"}
    </p>
  );
}

/** 보고 원문 + 제출 정보 + 수정 이력 — 넓은 상세 화면에서 쓴다. */
export function WeeklyReportDetail({
  report,
  weekStartDate,
}: {
  report: BranchWeeklyReport | null;
  weekStartDate: string;
}) {
  const [showHistory, setShowHistory] = useState(false);

  if (!report) {
    return <p className="py-4 text-sm text-gray-400">작성된 주간보고가 없습니다.</p>;
  }

  return (
    <div>
      <WeeklyReportBody content={report.content} />

      <dl className="mt-5 space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-gray-400">보고 주차</dt>
          <dd>
            {weekRangeLabel(weekStartDate)} · {weekOfMonthLabel(weekStartDate)}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-gray-400">최초 제출</dt>
          <dd>
            {report.submittedAt
              ? `${formatDateTime(report.submittedAt.toDate())}${
                  report.submittedByName ? ` · ${report.submittedByName}` : ""
                }`
              : "임시저장 (미제출)"}
          </dd>
        </div>
        {report.editCount > 0 && report.updatedAt && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-gray-400">최종 수정</dt>
            <dd>
              {formatDateTime(report.updatedAt.toDate())} · {report.editCount}회
            </dd>
          </div>
        )}
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
              {[...(report.editHistory ?? [])].reverse().map((edit, i) => {
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
              {report.editCount > (report.editHistory ?? []).length && (
                <li className="text-[11px] text-gray-400">
                  오래된 이력 {report.editCount - (report.editHistory ?? []).length}건은 보관 한도를
                  넘어 본문이 남아 있지 않습니다.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** 보고 원문을 넓은 화면에서 읽기 */
export function WeeklyReportDetailPanel({
  title,
  subtitle,
  report,
  weekStartDate,
  onClose,
}: {
  title: string;
  subtitle?: string;
  report: BranchWeeklyReport | null;
  weekStartDate: string;
  onClose: () => void;
}) {
  return (
    <DetailPanel title={title} subtitle={subtitle} onClose={onClose}>
      <WeeklyReportDetail report={report} weekStartDate={weekStartDate} />
    </DetailPanel>
  );
}

/** "넓게 작성" — 큰 입력창. 줄바꿈·문단은 입력한 그대로 저장된다. */
export function WideTextEditorPanel({
  title,
  subtitle,
  value,
  maxLength,
  onChange,
  onClose,
}: {
  title: string;
  subtitle?: string;
  value: string;
  maxLength: number;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  return (
    <DetailPanel
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-400">
            {value.length.toLocaleString("ko-KR")} / {maxLength.toLocaleString("ko-KR")}자
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f]"
          >
            작성 완료
          </button>
        </div>
      }
    >
      {/* 입력창이 패널 높이를 꽉 채우도록 — 모바일에서는 전체 화면이 된다 */}
      <textarea
        autoFocus
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder="이번 주 운영 내용을 자유롭게 작성해주세요."
        className="h-full min-h-[50vh] w-full resize-none rounded-lg border border-gray-200 p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-red-500 md:min-h-[55vh]"
      />
    </DetailPanel>
  );
}
