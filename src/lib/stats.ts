import type { Stats } from "./types";

const sortedCopy = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = sortedCopy(xs);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function describe(xs: readonly number[]): Stats {
  const n = xs.length;
  if (n === 0) return { n: 0, median: NaN, mean: NaN, min: NaN, max: NaN, stddev: NaN, cv: NaN, mad: NaN, outliers: [] };
  const med = median(xs);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1) : 0;
  const stddev = Math.sqrt(variance);
  const mad = median(xs.map((x) => Math.abs(x - med)));
  const outliers: number[] = [];
  if (mad > 0) {
    xs.forEach((x, i) => {
      if (Math.abs((0.6745 * (x - med)) / mad) > 3.5) outliers.push(i);
    });
  }
  return { n, median: med, mean, min: Math.min(...xs), max: Math.max(...xs), stddev, cv: mean > 0 ? stddev / mean : 0, mad, outliers };
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export function mannWhitneyU(a: readonly number[], b: readonly number[]): number | null {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 3 || n2 < 3) return null;
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array<number>(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    const t = j - i + 1;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }
  let r1 = 0;
  all.forEach((x, i) => {
    if (x.g === 0) r1 += ranks[i];
  });
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const n = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  if (sigma === 0) return 1;
  const z = (Math.abs(u1 - mu) - 0.5) / sigma;
  return Math.min(1, 2 * (1 - normalCdf(Math.max(0, z))));
}
