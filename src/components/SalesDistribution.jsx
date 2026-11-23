import { useMemo, useState } from "react";
import { fmt } from "../lib/api";
import { boxStats, histogram, kdePoints } from "../lib/distribution";

// Sales distribution card for the Reports page (/app/reports).
// Three views of the SAME real sale amounts (total_amount, via
// GET /api/reports -> saleAmounts): a histogram with a Gaussian-kernel
// density curve overlaid, the density curve on its own, and a Tukey
// box plot. Hand-rolled SVG — no charting library, no new dependency,
// no CDN. Axis labels are plain HTML under the SVG so they stay
// readable at 320px (SVG text would shrink with the viewBox). No
// animation anywhere, so reduced motion needs nothing extra.

const W = 560;
const H = 200;
const PAD = { top: 14, right: 10, bottom: 10, left: 10 };

function xScale(min, max) {
  const span = max - min || 1;
  return (v) => PAD.left + ((v - min) / span) * (W - PAD.left - PAD.right);
}

function HistogramSvg({ amounts }) {
  const hist = useMemo(() => histogram(amounts), [amounts]);
  const kde = useMemo(() => kdePoints(amounts), [amounts]);
  const stats = useMemo(() => boxStats(amounts), [amounts]);
  const x = xScale(hist.min, hist.max);
  // Bars are drawn as densities (count / (n * width)) so the KDE curve
  // shares their vertical scale. When every sale has the same amount
  // there is one bin and no width: draw it full height instead of
  // vanishing to zero.
  const dens = hist.bins.map((b) => (hist.binWidth > 0 ? b.count / (amounts.length * hist.binWidth) : (b.count > 0 ? 1 : 0)));
  const kdeMax = Math.max(0, ...kde.map((p) => p.y));
  const yMax = Math.max(...dens, kdeMax, 1e-12);
  const y = (d) => PAD.top + (1 - d / yMax) * (H - PAD.top - PAD.bottom);
  const floor = H - PAD.bottom;
  const line = kde.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  return (
    <svg className="dist-svg" viewBox={`0 0 ${W} ${H}`} role="img" data-testid="dist-hist"
      aria-label={`Histogram of ${stats.count} sales, from ${fmt(stats.min)} to ${fmt(stats.max)}, median ${fmt(stats.median)}`}>
      {hist.bins.map((b, i) => {
        const bw = Math.max(1, (x(b.hi) - x(b.lo)) * 0.92);
        const bx = x(b.lo) + ((x(b.hi) - x(b.lo)) - bw) / 2;
        return (
          <rect key={i} x={bx.toFixed(1)} y={y(dens[i]).toFixed(1)} width={bw.toFixed(1)}
            height={Math.max(0, floor - y(dens[i])).toFixed(1)} rx="2"
            style={{ fill: "var(--brand)" }} data-testid="dist-bar">
            <title>{`${fmt(b.lo)} to ${fmt(b.hi)}: ${b.count} sale${b.count === 1 ? "" : "s"}`}</title>
          </rect>
        );
      })}
      {kde.length > 1 && (
        <path d={line} fill="none" strokeWidth="2.5" strokeLinecap="round"
          style={{ stroke: "var(--brand-dark)" }} data-testid="dist-kde" />
      )}
      <line x1={PAD.left} y1={floor} x2={W - PAD.right} y2={floor} strokeWidth="1" style={{ stroke: "var(--line)" }} />
    </svg>
  );
}

function DensitySvg({ amounts }) {
  const kde = useMemo(() => kdePoints(amounts), [amounts]);
  const stats = useMemo(() => boxStats(amounts), [amounts]);
  const lo = kde.length ? kde[0].x : 0;
  const hi = kde.length ? kde[kde.length - 1].x : 1;
  const x = xScale(lo, hi);
  const yMax = Math.max(1e-12, ...kde.map((p) => p.y));
  const y = (d) => PAD.top + (1 - d / yMax) * (H - PAD.top - PAD.bottom);
  const floor = H - PAD.bottom;
  const line = kde.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${x(hi).toFixed(1)},${floor} L${x(lo).toFixed(1)},${floor} Z`;
  return (
    <svg className="dist-svg" viewBox={`0 0 ${W} ${H}`} role="img" data-testid="dist-density"
      aria-label={`Density curve of ${stats.count} sales, from ${fmt(stats.min)} to ${fmt(stats.max)}, median ${fmt(stats.median)}`}>
      <path d={area} style={{ fill: "var(--brand-soft)" }} />
      <path d={line} fill="none" strokeWidth="2.5" strokeLinecap="round"
        style={{ stroke: "var(--brand-dark)" }} data-testid="dist-kde" />
      <line x1={PAD.left} y1={floor} x2={W - PAD.right} y2={floor} strokeWidth="1" style={{ stroke: "var(--line)" }} />
    </svg>
  );
}

function BoxSvg({ amounts }) {
  const stats = useMemo(() => boxStats(amounts), [amounts]);
  // Whiskers + box + outliers all need room: scale across the full
  // min-to-max span so nothing is clipped.
  const x = xScale(stats.min, stats.max);
  const mid = H / 2;
  const boxTop = mid - 26;
  const boxBottom = mid + 26;
  return (
    <svg className="dist-svg" viewBox={`0 0 ${W} ${H}`} role="img" data-testid="dist-box"
      aria-label={`Box plot of ${stats.count} sales: smallest ${fmt(stats.min)}, first quartile ${fmt(stats.q1)}, median ${fmt(stats.median)}, third quartile ${fmt(stats.q3)}, largest ${fmt(stats.max)}`}>
      {/* whiskers */}
      <line x1={x(stats.whiskerLow)} y1={mid} x2={x(stats.q1)} y2={mid} strokeWidth="2" style={{ stroke: "var(--muted)" }} />
      <line x1={x(stats.q3)} y1={mid} x2={x(stats.whiskerHigh)} y2={mid} strokeWidth="2" style={{ stroke: "var(--muted)" }} />
      <line x1={x(stats.whiskerLow)} y1={mid - 12} x2={x(stats.whiskerLow)} y2={mid + 12} strokeWidth="2" style={{ stroke: "var(--muted)" }} />
      <line x1={x(stats.whiskerHigh)} y1={mid - 12} x2={x(stats.whiskerHigh)} y2={mid + 12} strokeWidth="2" style={{ stroke: "var(--muted)" }} />
      {/* box */}
      <rect x={x(stats.q1)} y={boxTop} width={Math.max(2, x(stats.q3) - x(stats.q1))} height={boxBottom - boxTop}
        rx="4" style={{ fill: "var(--brand-soft)", stroke: "var(--brand)", strokeWidth: 2 }} />
      {/* median */}
      <line x1={x(stats.median)} y1={boxTop} x2={x(stats.median)} y2={boxBottom} strokeWidth="3" style={{ stroke: "var(--brand-dark)" }} />
      {/* outliers */}
      {stats.outliers.map((v, i) => (
        <circle key={i} cx={x(v)} cy={mid} r="4.5" style={{ fill: "var(--danger)" }} data-testid="dist-outlier">
          <title>{`Outlier sale: ${fmt(v)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

const TABS = [
  { id: "hist", label: "Histogram" },
  { id: "density", label: "Density" },
  { id: "box", label: "Box plot" },
];

export default function SalesDistribution({ amounts, truncated, totalCount }) {
  const [view, setView] = useState("hist");
  const stats = useMemo(() => boxStats(amounts || []), [amounts]);
  const hist = useMemo(() => histogram(amounts || []), [amounts]);

  return (
    <div className="card dist-card" data-testid="dist-card">
      <h3>Sales distribution</h3>
      {!stats ? (
        <p className="empty" data-testid="dist-empty">No sales yet — the distribution appears once sales are recorded.</p>
      ) : (
        <>
          <div className="dist-tabs" role="tablist" aria-label="Distribution view">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={view === t.id}
                className="dist-tab" data-testid={`dist-tab-${t.id}`}
                onClick={() => setView(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {view === "hist" && <HistogramSvg amounts={amounts} />}
          {view === "density" && <DensitySvg amounts={amounts} />}
          {view === "box" && <BoxSvg amounts={amounts} />}

          {/* Axis labels as HTML so they stay readable at 320px. */}
          <div className="dist-axis" aria-hidden="true">
            <span>{fmt(stats.min)}</span>
            <span>Median {fmt(stats.median)}</span>
            <span>{fmt(stats.max)}</span>
          </div>

          <div className="dist-stats">
            <span><strong>{stats.count}</strong> sale{stats.count === 1 ? "" : "s"}</span>
            <span>Median <strong>{fmt(stats.median)}</strong></span>
            <span>Smallest <strong>{fmt(stats.min)}</strong></span>
            <span>Largest <strong>{fmt(stats.max)}</strong></span>
          </div>
          {view === "hist" && (
            <p className="hint dist-note">
              Bars show how many sales fall in each amount band ({hist.rule === "freedman-diaconis" ? "Freedman–Diaconis bins" : "Sturges bins"}); the curve is the smoothed density (Silverman bandwidth).
            </p>
          )}
          {view === "density" && (
            <p className="hint dist-note">
              Smoothed density of sale amounts (Gaussian kernel, Silverman bandwidth). Higher curve means more sales near that amount.
            </p>
          )}
          {view === "box" && (
            <p className="hint dist-note">
              Box covers the middle half of sales (first to third quartile); the line inside is the median; whiskers reach the furthest typical sales and dots are outliers.
            </p>
          )}
          {truncated && totalCount > stats.count && (
            <p className="hint dist-note" data-testid="dist-truncated">
              Showing the most recent {stats.count} of {totalCount} sales in this range.
            </p>
          )}
        </>
      )}
    </div>
  );
}
