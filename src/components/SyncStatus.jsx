import { useSyncStatus } from "../lib/sync.js";

const pill = (online) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 12px",
  borderRadius: 999,
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
  background: online ? "#e8f5ec" : "#fef3c7",
  color: online ? "#166534" : "#b45309",
  border: "1px solid",
  borderColor: online ? "#cde8d5" : "#f6d98a",
});

export default function SyncStatus() {
  const { online, pending } = useSyncStatus();

  const dot = {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: online ? "#15803d" : "#b45309",
  };

  const label = online
    ? pending > 0
      ? `Online, ${pending} syncing`
      : "Online"
    : pending > 0
      ? `Offline, ${pending} waiting to sync`
      : "Offline";

  return (
    <span style={pill(online)} role="status" aria-live="polite">
      <span style={dot} />
      {label}
    </span>
  );
}
