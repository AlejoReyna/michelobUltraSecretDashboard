"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export type PortfolioChartPoint = {
  label: string;
  value: number;
};

export function PortfolioChart({ data }: { data: PortfolioChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#2B3139" strokeDasharray="3 3" />
        <XAxis dataKey="label" stroke="#2B3139" tick={{ fill: "#848E9C", fontSize: 12 }} />
        <YAxis
          stroke="#2B3139"
          tick={{ fill: "#848E9C", fontSize: 12 }}
          width={72}
          tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
        />
        <Tooltip
          contentStyle={{ background: "#1E2329", border: "1px solid #2B3139", borderRadius: 4, color: "#EAECEF" }}
          formatter={(value) => [usdFormatter.format(Number(value)), "Portfolio"]}
        />
        <Line type="monotone" dataKey="value" stroke="#F0B90B" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#F0B90B" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
