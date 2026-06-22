interface Props {
  inquiries: number;
  consultations: number;
  registrations: number;
}

export default function ConversionFunnel({ inquiries, consultations, registrations }: Props) {
  const steps = [
    { label: "문의", value: inquiries, color: "bg-blue-100 text-blue-700" },
    { label: "PT 상담", value: consultations, color: "bg-purple-100 text-purple-700" },
    { label: "PT 등록", value: registrations, color: "bg-green-100 text-green-700" },
  ];

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2">
          <div className={`px-3 py-2 rounded-lg text-center min-w-[72px] ${s.color}`}>
            <p className="text-xs text-current/70">{s.label}</p>
            <p className="text-lg font-bold">{s.value.toLocaleString()}</p>
          </div>
          {i < steps.length - 1 && (
            <span className="text-gray-300 text-lg">→</span>
          )}
        </div>
      ))}
    </div>
  );
}
