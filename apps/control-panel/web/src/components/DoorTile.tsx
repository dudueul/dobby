import { useState } from "react";
import type { Entity } from "../api";
import { sendCommand } from "../api";

// Lock/unlock with a confirm gate. On a real device, replace confirm() with a
// WebAuthn/passkey (Face ID) check — unlock is a sensitive action.
export function DoorTile({ e }: { e?: Entity }) {
  const [busy, setBusy] = useState(false);
  if (!e) return null;
  const locked = e.state === "locked";
  const name = (e.attributes.friendly_name as string) ?? e.entity_id;

  async function toggle() {
    const service = locked ? "lock.unlock" : "lock.lock";
    if (service === "lock.unlock" && !confirm(`Unlock ${name}?`)) return;
    setBusy(true);
    try { await sendCommand(e!.entity_id, service); } catch (err) { alert(String(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className={`tile door ${locked ? "ok" : "warn"}`}>
      <div className="tile-title">{name}</div>
      <div className="tile-state">{locked ? "🔒 Locked" : "🔓 Unlocked"}</div>
      <button disabled={busy} onClick={toggle}>{locked ? "Unlock" : "Lock"}</button>
    </div>
  );
}
