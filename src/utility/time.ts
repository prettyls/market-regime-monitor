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

export const formatDateTime = (value: Date | string | number): string => {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    throw new Error(`Invalid date value: ${String(value)}`);
  }
  return new Date(time).toISOString().replace("T", " ").slice(0, 19) + " UTC";
};
