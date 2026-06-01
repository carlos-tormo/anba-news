export interface ZonedNow {
  dateKey: string;
  hour: number;
  minute: number;
}

export function getZonedNow(timeZone: string, date = new Date()): ZonedNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    dateKey: `${byType.year}-${byType.month}-${byType.day}`,
    hour: Number(byType.hour),
    minute: Number(byType.minute)
  };
}

export function dateKeyForIso(isoDate: string, timeZone: string): string {
  return getZonedNow(timeZone, new Date(isoDate)).dateKey;
}
