import type { Entity } from "../api";
import { sendCommand } from "../api";

// Reads capabilities dynamically (current_temperature, temperature, hvac_modes)
// so a device swap doesn't break the panel — never hardcode the heat-pump.
export function ClimateTile({ e }: { e?: Entity }) {
  if (!e) return null;
  const cur = e.attributes.current_temperature as number | undefined;
  const target = e.attributes.temperature as number | undefined;
  const modes = (e.attributes.hvac_modes as string[]) ?? ["off", "heat", "cool", "auto"];

  async function bump(delta: number) {
    if (target == null) return;
    try { await sendCommand(e!.entity_id, "climate.set_temperature", { temperature: target + delta }); }
    catch (err) { alert(String(err)); }
  }
  async function setMode(mode: string) {
    try { await sendCommand(e!.entity_id, "climate.set_hvac_mode", { hvac_mode: mode }); }
    catch (err) { alert(String(err)); }
  }

  return (
    <div className="tile climate">
      <div className="tile-title">{(e.attributes.friendly_name as string) ?? "Climate"}</div>
      <div className="tile-state">
        {cur != null ? `${cur}°` : "—"} <span className="muted">now</span>
        {" · "}
        <b>{target != null ? `${target}°` : "—"}</b> set
        {" · "}{e.attributes.hvac_action as string ?? e.state}
      </div>
      <div className="row">
        <button onClick={() => bump(-1)}>–</button>
        <button onClick={() => bump(+1)}>+</button>
        <select value={e.state} onChange={(ev) => setMode(ev.target.value)}>
          {modes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  );
}
