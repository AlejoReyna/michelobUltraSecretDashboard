// Chart timezone catalog. Apple "Clock"-style entries: each has a primary city
// label plus the other major places that share roughly the same wall-clock time.
// Offsets are NOT hardcoded — they are computed live with Intl so DST is always
// correct. The `cities` string is purely descriptive.

export type ChartTimeZone = {
  /** IANA time zone identifier passed to Intl.DateTimeFormat. */
  id: string;
  /** Primary city / label shown in the selector. */
  label: string;
  /** Other major places at this hour (Apple-clock style). */
  cities: string;
};

export const DEFAULT_TIME_ZONE_ID = "America/Monterrey";

export const CHART_TIME_ZONES: ChartTimeZone[] = [
  { id: "America/Monterrey", label: "Monterrey", cities: "Mexico City · Chicago · San José" },
  { id: "America/Los_Angeles", label: "Los Angeles", cities: "San Francisco · Vancouver · Tijuana" },
  { id: "America/New_York", label: "New York", cities: "Toronto · Miami · Bogotá" },
  { id: "America/Sao_Paulo", label: "São Paulo", cities: "Buenos Aires · Santiago · Montevideo" },
  { id: "UTC", label: "UTC", cities: "Reykjavík · Accra · Coordinated" },
  { id: "Europe/London", label: "London", cities: "Dublin · Lisbon · Casablanca" },
  { id: "Europe/Madrid", label: "Madrid", cities: "Paris · Berlin · Rome" },
  { id: "Europe/Athens", label: "Athens", cities: "Helsinki · Cairo · Johannesburg" },
  { id: "Asia/Dubai", label: "Dubai", cities: "Abu Dhabi · Baku · Tbilisi" },
  { id: "Asia/Kolkata", label: "Mumbai", cities: "New Delhi · Bengaluru · Colombo" },
  { id: "Asia/Singapore", label: "Singapore", cities: "Hong Kong · Shanghai · Manila" },
  { id: "Asia/Tokyo", label: "Tokyo", cities: "Seoul · Osaka · Pyongyang" },
  { id: "Australia/Sydney", label: "Sydney", cities: "Melbourne · Brisbane · Canberra" },
];

export function findTimeZone(id: string): ChartTimeZone {
  return CHART_TIME_ZONES.find((zone) => zone.id === id) ?? CHART_TIME_ZONES[0];
}

/** Live "GMT-6"-style label for a zone, computed via Intl (DST-aware). */
export function gmtOffsetLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    if (!name) {
      return "GMT";
    }
    // Normalize "GMT-6", "UTC", etc.
    return name.replace("UTC", "GMT");
  } catch {
    return "GMT";
  }
}

/** Current wall-clock "HH:mm" in a zone (24h). */
export function localTimeLabel(timeZone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return "--:--";
  }
}
