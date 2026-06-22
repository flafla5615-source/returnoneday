import { InboxIcon } from "lucide-react";

interface Props {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
}

export default function EmptyState({
  title = "데이터가 없습니다",
  description,
  icon,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        {icon ?? <InboxIcon className="w-7 h-7 text-gray-400" />}
      </div>
      <p className="text-base font-medium text-gray-700">{title}</p>
      {description && <p className="text-sm text-gray-400 mt-1">{description}</p>}
    </div>
  );
}
