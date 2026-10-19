import { ClockIcon } from "lucide-react";

/* 운영 공지 — 지점장 홈과 지점별 일일보고 화면에 동일하게 노출한다.
   문구를 한 곳에서만 고치면 되도록 컴포넌트로 분리했다. */

const NOTICES = [
  { label: "근무 시간", value: "09:00 ~ 21:00" },
  { label: "개인 휴게", value: "13:00 ~ 16:00" },
  { label: "오전 보고", value: "09:30까지" },
  { label: "마감 보고", value: "21:00까지" },
];

export default function ShiftNotice() {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <ClockIcon className="h-4 w-4 text-blue-600" />
        <p className="text-sm font-semibold text-blue-900">운영 공지</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {NOTICES.map((n) => (
          <div key={n.label} className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-blue-700/70">{n.label}</dt>
            <dd className="text-xs font-semibold text-blue-900">{n.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
