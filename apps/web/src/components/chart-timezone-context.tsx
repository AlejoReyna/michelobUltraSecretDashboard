"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_TIME_ZONE_ID } from "@/lib/timezones";

type ChartTimeZoneContextValue = {
  timeZone: string;
  setTimeZone: (id: string) => void;
};

const ChartTimeZoneContext = createContext<ChartTimeZoneContextValue>({
  timeZone: DEFAULT_TIME_ZONE_ID,
  setTimeZone: () => {},
});

export function ChartTimeZoneProvider({ children }: { children: ReactNode }) {
  const [timeZone, setTimeZone] = useState<string>(DEFAULT_TIME_ZONE_ID);
  const value = useMemo<ChartTimeZoneContextValue>(() => ({ timeZone, setTimeZone }), [timeZone]);
  return <ChartTimeZoneContext.Provider value={value}>{children}</ChartTimeZoneContext.Provider>;
}

export function useChartTimeZone(): ChartTimeZoneContextValue {
  return useContext(ChartTimeZoneContext);
}
