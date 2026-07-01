import { useState } from "react";
import type { Entity } from "../api";
import { sendCommand } from "../api";

const LABEL: Record<string, string> = {
  disarmed: "○ Disarmed",
  armed_home: "🛡 Armed (home)",
  armed_away: "🛡 Armed (away)",
  armed_night: "🌙 Armed (night)",
  arming: "… Arming",
  pending: "⏳ Entry delay",
  triggered: "🚨 TRIGGERED",
};

// Arm/disarm surface over alarm_control_panel.dobby. Disarm is a sensitive
// service: the BFF enforces step-up (passphrase re-confirm) server-side.
export function AlarmTile({ e }: { e?: Entity }) {
  const [busy, setBusy] = useState(false);
  if (!e) return null;

  async function call(service: string) {
    setBusy(true);
    try { await sendCommand(e!.entity_id, service); } catch (err) { alert(String(err)); }
    finally { setBusy(false); }
  }

  const armed = e.state.startsWith("armed") || e.state === "triggered" || e.state === "pending";
  return (
    <div className={`tile alarm ${e.state === "triggered" ? "warn" : armed ? "ok" : ""}`}>
      <div className="tile-title">Alarm</div>
      <div className="tile-state">{LABEL[e.state] ?? e.state}</div>
      <div className="row">
        {armed ? (
          <button disabled={busy} onClick={() => call("alarm_control_panel.alarm_disarm")}>Disarm</button>
        ) : (
          <>
            <button disabled={busy} onClick={() => call("alarm_control_panel.alarm_arm_home")}>Home</button>
            <button disabled={busy} onClick={() => call("alarm_control_panel.alarm_arm_away")}>Away</button>
            <button disabled={busy} onClick={() => call("alarm_control_panel.alarm_arm_night")}>Night</button>
          </>
        )}
      </div>
    </div>
  );
}
