"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface Props {
  submitted: number;
  total: number;
}

export default function SubmissionDonut({ submitted, total }: Props) {
  const pending = total - submitted;
  const pct = total > 0 ? Math.round((submitted / total) * 100) : 0;
  const data = [
    { name: "제출 완료", value: submitted },
    { name: "미제출", value: pending },
  ];

  return (
    <div className="relative flex items-center justify-center">
      <ResponsiveContainer width={160} height={160}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={72}
            startAngle={90}
            endAngle={-270}
            dataKey="value"
            strokeWidth={0}
          >
            <Cell fill="#16a34a" />
            <Cell fill="#fee2e2" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-gray-900">{pct}%</span>
        <span className="text-xs text-gray-400">제출률</span>
      </div>
    </div>
  );
}
