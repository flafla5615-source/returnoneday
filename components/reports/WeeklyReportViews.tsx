"use client";

import { useEffect, useState } from "react";
import DetailPanel from "@/components/common/DetailPanel";
import { cn, formatDateTime } from "@/lib/utils";
import { weekOfMonthLabel, weekRangeLabel } from "@/lib/weekSchedule";
import { formatFileSize } from "@/lib/weeklyFiles";
import { getWeeklyFileUrl } from "@/services/weeklyReports";
import {
  WEEKLY_STATE_LABEL,
  type BranchWeeklyReport,
  type WeeklyReportFile,
  type WeeklyReportState,
} from "@/types";
import {
  DownloadIcon,
  EyeIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react";

/* 주간보고 공용 표시 컴포넌트 (파일 첨부 방식).

   다운로드 URL 은 Firestore 에 저장하지 않는다.
   사용자가 보기/내려받기를 누른 시점에 Storage 규칙을 통과해야만 발급된다. */

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

export function isPdf(file: WeeklyReportFile): boolean {
  return file.contentType === "application/pdf";
}

function FileKindIcon({ file }: { file: WeeklyReportFile }) {
  if (isPdf(file)) return <FileTextIcon className="h-4 w-4 shrink-0 text-red-500" />;
  if (file.contentType.includes("word"))
    return <FileIcon className="h-4 w-4 shrink-0 text-blue-500" />;
  return <FileSpreadsheetIcon className="h-4 w-4 shrink-0 text-green-600" />;
}

/** 첨부파일 한 줄 — 파일명, 크기, 업로드 시간 + 보기/내려받기/삭제 */
export function WeeklyFileRow({
  file,
  onPreview,
  onDelete,
  deleting,
}: {
  file: WeeklyReportFile;
  onPreview?: (file: WeeklyReportFile) => void;
  onDelete?: (file: WeeklyReportFile) => void;
  deleting?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const url = await getWeeklyFileUrl(file);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("[weekly] download url failed", err);
      setError("파일을 열지 못했습니다. 권한을 확인해주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-2.5">
      <div className="flex items-start gap-2">
        <FileKindIcon file={file} />
        <div className="min-w-0 flex-1">
          <p className="break-words break-keep text-sm font-medium text-gray-800">{file.name}</p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            {formatFileSize(file.size)} · 업로드 {formatDateTime(file.uploadedAt.toDate())}
            {file.uploadedByName ? ` · ${file.uploadedByName}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        {isPdf(file) && onPreview && (
          <button
            type="button"
            onClick={() => onPreview(file)}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            <EyeIcon className="h-3.5 w-3.5" />
            미리보기
          </button>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? (
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <DownloadIcon className="h-3.5 w-3.5" />
          )}
          내려받기
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(file)}
            disabled={deleting}
            className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2Icon className="h-3.5 w-3.5" />
            삭제
          </button>
        )}
      </div>

      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </li>
  );
}

export function WeeklyFileList({
  files,
  onPreview,
  onDelete,
  deletingId,
  emptyText = "첨부된 파일이 없습니다.",
}: {
  files: WeeklyReportFile[];
  onPreview?: (file: WeeklyReportFile) => void;
  onDelete?: (file: WeeklyReportFile) => void;
  deletingId?: string | null;
  emptyText?: string;
}) {
  if (files.length === 0) {
    return <p className="py-3 text-sm text-gray-400">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {files.map((f) => (
        <WeeklyFileRow
          key={f.fileId}
          file={f}
          onPreview={onPreview}
          onDelete={onDelete}
          deleting={deletingId === f.fileId}
        />
      ))}
    </ul>
  );
}

/** PDF 를 넓은 화면에서 미리보기 */
export function PdfPreviewPanel({
  file,
  onClose,
}: {
  file: WeeklyReportFile;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await getWeeklyFileUrl(file);
        if (!cancelled) setUrl(next);
      } catch (err) {
        console.error("[weekly] preview url failed", err);
        if (!cancelled) setError("파일을 불러오지 못했습니다. 권한을 확인해주세요.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <DetailPanel
      title={file.name}
      subtitle={`${formatFileSize(file.size)} · 업로드 ${formatDateTime(file.uploadedAt.toDate())}`}
      onClose={onClose}
      widthClass="md:w-[min(64rem,94vw)]"
    >
      {error ? (
        <p className="py-6 text-center text-sm text-red-600">{error}</p>
      ) : url ? (
        <iframe
          src={url}
          title={file.name}
          className="h-[70vh] min-h-[420px] w-full rounded-lg border border-gray-200"
        />
      ) : (
        <div className="flex h-[40vh] items-center justify-center text-sm text-gray-400">
          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
          불러오는 중...
        </div>
      )}
    </DetailPanel>
  );
}

/** 주간보고 상세 — 첨부파일 목록 + 제출 정보 */
export function WeeklyReportDetail({
  report,
  weekStartDate,
  onPreview,
}: {
  report: BranchWeeklyReport | null;
  weekStartDate: string;
  onPreview?: (file: WeeklyReportFile) => void;
}) {
  if (!report) {
    return <p className="py-4 text-sm text-gray-400">작성된 주간보고가 없습니다.</p>;
  }

  return (
    <div>
      <WeeklyFileList files={report.files ?? []} onPreview={onPreview} />

      {/* 텍스트 방식이던 시절의 본문이 남아 있으면 함께 보여준다 */}
      {report.content && (
        <div className="mt-4 rounded-lg bg-gray-50 p-3">
          <p className="mb-1 text-[11px] font-medium text-gray-500">
            이전 텍스트 작성본 (파일 첨부 방식 이전에 작성됨)
          </p>
          <p className="whitespace-pre-wrap break-words break-keep text-sm leading-relaxed text-gray-700">
            {report.content}
          </p>
        </div>
      )}

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
        {report.updatedAt && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-gray-400">최종 수정</dt>
            <dd>
              {formatDateTime(report.updatedAt.toDate())}
              {report.editCount > 0 && ` · 재제출 ${report.editCount}회`}
            </dd>
          </div>
        )}
      </dl>

      <WeeklyFileHistory report={report} />
    </div>
  );
}

/** 파일 추가·삭제 이력 */
export function WeeklyFileHistory({ report }: { report: BranchWeeklyReport }) {
  const [open, setOpen] = useState(false);
  const history = report.fileHistory ?? [];
  if (history.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-gray-500 underline hover:text-gray-700"
      >
        파일 변경 이력 {history.length}건 {open ? "접기" : "보기"}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {[...history].reverse().map((h, i) => (
            <li key={i} className="flex flex-wrap gap-x-2 rounded bg-gray-50 px-2 py-1.5 text-[11px]">
              <span className={h.action === "added" ? "text-green-700" : "text-red-600"}>
                {h.action === "added" ? "추가" : "삭제"}
              </span>
              <span className="min-w-0 break-words break-keep text-gray-700">{h.fileName}</span>
              <span className="text-gray-400">
                {formatDateTime(h.at.toDate())} · {h.byName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 보고 원문을 넓은 화면에서 보기 */
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
  const [preview, setPreview] = useState<WeeklyReportFile | null>(null);

  return (
    <>
      <DetailPanel title={title} subtitle={subtitle} onClose={onClose}>
        <WeeklyReportDetail
          report={report}
          weekStartDate={weekStartDate}
          onPreview={setPreview}
        />
      </DetailPanel>
      {preview && <PdfPreviewPanel file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
