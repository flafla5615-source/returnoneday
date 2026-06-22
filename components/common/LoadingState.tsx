export default function LoadingState({ text = "불러오는 중..." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
      <p className="mt-3 text-sm text-gray-500">{text}</p>
    </div>
  );
}
