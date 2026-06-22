import { CheckCircleIcon, Loader2Icon } from "lucide-react";
import { formatTime } from "@/lib/utils";

interface Props {
  saving: boolean;
  lastSaved: Date | null;
}

export default function AutosaveIndicator({ saving, lastSaved }: Props) {
  if (saving) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <Loader2Icon className="w-3.5 h-3.5 animate-spin" />
        저장 중...
      </div>
    );
  }
  if (lastSaved) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <CheckCircleIcon className="w-3.5 h-3.5 text-green-500" />
        자동 저장됨 {formatTime(lastSaved)}
      </div>
    );
  }
  return null;
}
