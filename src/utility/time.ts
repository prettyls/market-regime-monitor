export type UnixTime = number;

export const toUnixTime = (value: Date | string | number): UnixTime => {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    throw new Error(`Invalid date value: ${String(value)}`);
  }
  return time;
};

export const fromUnixTime = (value: UnixTime): Date => new Date(value);

const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// UTC midnight of the previous weekday on the given timezone's calendar.
// At 7:30am America/New_York this is the latest completed US session, including Friday when today is Saturday, Sunday, or Monday.
export const previousWeekday = (now: Date = new Date(), timeZone = "America/New_York"): Date => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const day = Number(part("day"));
  const weekday = weekdayIndex[part("weekday")];
  if (!year || !month || !day || weekday === undefined) throw new Error(`Unable to resolve a calendar date in ${timeZone}`);
  const daysBack = weekday === 0 ? 2 : weekday === 1 ? 3 : 1;
  return new Date(Date.UTC(year, month - 1, day - daysBack));
};

export const formatDateTime = (value: Date | string | number): string => {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    throw new Error(`Invalid date value: ${String(value)}`);
  }
  return new Date(time).toISOString().replace("T", " ").slice(0, 19) + " UTC";
};
