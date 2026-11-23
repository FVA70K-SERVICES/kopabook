// Sales-distribution maths for the Reports page (KopaBook).
// Pure functions, no React, no DOM: the static suite imports this file
// directly with node and checks the numbers. The data is always the
// business's real sale amounts (total_amount from the sales table, via
// GET /api/reports -> saleAmounts); nothing here invents data.
//
// Binning rule: Freedman-Diaconis (width = 2 * IQR * n^(-1/3)).
// When the IQR is 0 (most amounts identical) it falls back to Sturges'
// rule (k = ceil(log2 n) + 1). Bins are capped at 20 so a wide range
// never turns into a wall of slivers.
// Bandwidth rule: Silverman's rule of thumb for the Gaussian kernel,
// h = 0.9 * min(sd, IQR / 1.34) * n^(-1/5). When h is 0 or non-finite
// (all amounts equal) it falls back to max(|median| * 0.1, 1).
// Box plot: Tukey quartiles (linear interpolation), whiskers to the
// furthest values inside the 1.5 * IQR fences, the rest are outliers.

export function cleanAmounts(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}

// Quantile of an already-sorted array, linear interpolation (type 7 —
// the same method spreadsheets use for QUARTILE.INC).
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function boxStats(values) {
  const s = cleanAmounts(values);
  if (!s.length) return null;
  const q1 = quantile(s, 0.25);
  const median = quantile(s, 0.5);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const inside = s.filter((v) => v >= lowFence && v <= highFence);
  const outliers = s.filter((v) => v < lowFence || v > highFence);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const variance = s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / s.length;
  return {
    count: s.length,
    min: s[0],
    max: s[s.length - 1],
    q1,
    median,
    q3,
    iqr,
    mean,
    sd: Math.sqrt(variance),
    lowFence,
    highFence,
    whiskerLow: inside.length ? inside[0] : q1,
    whiskerHigh: inside.length ? inside[inside.length - 1] : q3,
    outliers,
  };
}

// Freedman-Diaconis bins, Sturges fallback, capped at 20 bins.
export function histogram(values, maxBins = 20) {
  const s = cleanAmounts(values);
  if (!s.length) return { bins: [], binWidth: 0, rule: "none", min: 0, max: 0 };
  const stats = boxStats(s);
  const min = s[0];
  const max = s[s.length - 1];
  let rule = "freedman-diaconis";
  let width = (2 * stats.iqr * Math.pow(s.length, -1 / 3)) || 0;
  if (!(width > 0)) {
    rule = "sturges";
    const k = Math.max(1, Math.ceil(Math.log2(s.length)) + 1);
    width = (max - min) / k || 1;
  }
  if (max === min) {
    // Every sale the same amount: one bin holding them all.
    return { bins: [{ lo: min, hi: min, count: s.length }], binWidth: 0, rule, min, max };
  }
  let count = Math.ceil((max - min) / width);
  count = Math.max(1, Math.min(maxBins, count));
  width = (max - min) / count;
  const bins = [];
  for (let i = 0; i < count; i++) {
    bins.push({ lo: min + i * width, hi: min + (i + 1) * width, count: 0 });
  }
  for (const v of s) {
    let idx = Math.floor((v - min) / width);
    if (idx >= count) idx = count - 1; // the maximum lands in the last bin
    bins[idx].count += 1;
  }
  return { bins, binWidth: width, rule, min, max };
}

// Silverman's rule of thumb for the Gaussian-kernel bandwidth.
export function silvermanBandwidth(values) {
  const s = cleanAmounts(values);
  if (!s.length) return 0;
  const stats = boxStats(s);
  const spread = Math.min(stats.sd, stats.iqr / 1.34);
  let h = 0.9 * spread * Math.pow(s.length, -1 / 5);
  if (!(h > 0) || !Number.isFinite(h)) {
    // All amounts equal (or a single sale): spread is 0, so fall back
    // to a tenth of the amount itself, at least 1 currency unit.
    h = Math.max(Math.abs(stats.median) * 0.1, 1);
  }
  return h;
}

function gaussianKernel(u) {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

// Gaussian-kernel density estimate: 80 points across the data range
// widened by 3 bandwidths each side (clipped at 0 — a sale amount
// can never be negative). y is a density: it integrates to ~1.
export function kdePoints(values, pointCount = 80) {
  const s = cleanAmounts(values);
  if (!s.length) return [];
  const h = silvermanBandwidth(s);
  const lo = Math.max(0, s[0] - 3 * h);
  const hi = s[s.length - 1] + 3 * h;
  const n = s.length;
  const pts = [];
  for (let i = 0; i < pointCount; i++) {
    const x = pointCount === 1 ? lo : lo + ((hi - lo) * i) / (pointCount - 1);
    let sum = 0;
    for (const v of s) sum += gaussianKernel((x - v) / h);
    pts.push({ x, y: sum / (n * h) });
  }
  return pts;
}
