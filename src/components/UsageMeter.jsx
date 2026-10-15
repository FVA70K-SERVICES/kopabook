// Usage meters for plan limits.
//
// CRITICAL RULE: usage display is informational only. It must NEVER block
// recording a sale anywhere. If a merchant hits 100% on the free tier, the
// sale still records. The meter and the UpgradeNudge banner are the only
// response; no checkout gate, no disabled save button, no error on record.

export default function UsageMeter({ used, limit, label }) {
  const unlimited = limit === null || limit === undefined;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const reached = !unlimited && pct >= 100;
  const near = !unlimited && pct >= 80 && !reached;

  const barColor = reached
    ? "var(--danger, #c0392b)"
    : near
      ? "var(--warning, #e67e22)"
      : "var(--brand)";

  return (
    <div className="usage-meter" style={{ margin: "12px 0" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 13,
          color: "var(--muted)",
          marginBottom: 6,
        }}
      >
        <span>{label}</span>
        <span className="money">
          {used}
          {unlimited ? "" : ` / ${limit}`}
          {unlimited ? " (unlimited)" : ""}
        </span>
      </div>
      {!unlimited && (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
          style={{
            height: 8,
            borderRadius: 4,
            background: "var(--line)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: barColor,
              borderRadius: 4,
              transition: "width 0.3s",
            }}
          />
        </div>
      )}
      {reached && (
        <p style={{ fontSize: 13, color: "var(--danger, #c0392b)", margin: "8px 0 0" }}>
          You have reached this week's free limit. Upgrade to keep growing, your
          sales will always be recorded.
        </p>
      )}
    </div>
  );
}

// Shows only for free-tier merchants once they pass 80% of the weekly sales
// limit. Pure nudge, never a gate.
export function UpgradeNudge({ tier, salesThisWeek, salesLimit }) {
  if (tier !== "free" || !salesLimit) return null;
  if (salesThisWeek < Math.ceil(salesLimit * 0.8)) return null;

  return (
    <div
      className="alert"
      style={{ marginTop: 12, borderLeft: "4px solid var(--warning, #e67e22)" }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>
        Your business is growing fast. You have used {salesThisWeek} of{" "}
        {salesLimit} free sales this week.
      </p>
      <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
        Upgrade to Starter for 1,000 sales a week and keep your records flowing.
        Your sales will always be recorded, even on free.
      </p>
      <a href="/pricing" className="btn btn-primary" style={{ marginTop: 10 }}>
        See plans
      </a>
    </div>
  );
}
