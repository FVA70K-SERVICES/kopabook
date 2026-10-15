import { CHANNELS } from "../lib/channels";

// Small segmented control: WhatsApp | SMS | Telegram
export default function ChannelPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Message channel">
      {CHANNELS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={"btn btn-sm " + (value === c.id ? "btn-primary" : "btn-secondary")}
          onClick={() => onChange(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
