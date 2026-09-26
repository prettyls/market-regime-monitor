export function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

export function sma(values: readonly number[], period: number): number | undefined {
  if (period < 1 || values.length < period) return undefined;
  return mean(values.slice(-period));
}

export function percentile(values: readonly number[], quantile: number): number | undefined {
  if (values.length === 0 || quantile < 0 || quantile > 1) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower];
  const high = sorted[upper];
  if (low === undefined || high === undefined) return undefined;
  return low + (high - low) * (position - lower);
}

export function zScore(value: number, values: readonly number[]): number {
  const deviation = standardDeviation(values);
  return deviation === 0 ? 0 : (value - mean(values)) / deviation;
}

export function linearSlope(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });
  return denominator === 0 ? 0 : numerator / denominator;
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}
