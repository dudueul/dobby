import { useEffect, useState, type FormEvent } from "react";
import { useLiveState, sendCommand, enablePush, login, logout, isAuthed } from "./api";
import { DoorTile } from "./components/DoorTile";
import { ClimateTile } from "./components/ClimateTile";
import { CameraTile } from "./components/CameraTile";

const CAMERAS = ["front_door", "back_door", "driveway"];
const HOUSE_MODES = ["home", "away", "night", "guest"];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => { isAuthed().then(setAuthed); }, []);

  if (authed === null) return <div className="app"><p>Loading…</p></div>;
  if (!authed) return <Login onOk={() => setAuthed(true)} />;
  return <Panel onSignOut={() => logout().then(() => setAuthed(false))} />;
}

function Login({ onOk }: { onOk: () => void }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await login(pass)) onOk();
    else setErr("Invalid passphrase");
  }
  return (
    <div className="app" style={{ maxWidth: 320, margin: "15vh auto", textAlign: "center" }}>
      <h1>dobby</h1>
      <form onSubmit={submit}>
        <input
          type="password" value={pass} autoFocus placeholder="Passphrase"
          onChange={(e) => setPass(e.target.value)}
          style={{ width: "100%", padding: 12, fontSize: 16 }}
        />
        <button style={{ marginTop: 12, width: "100%", padding: 12 }}>Unlock panel</button>
      </form>
      {err && <p style={{ color: "#c00" }}>{err}</p>}
    </div>
  );
}

function Panel({ onSignOut }: { onSignOut: () => void }) {
  const { states, connected } = useLiveState();
  const houseMode = states["input_select.house_mode"];
  const sensors = Object.values(states).filter(
    (e) => e.entity_id.startsWith("binary_sensor.") || e.entity_id.startsWith("sensor."),
  );

  return (
    <div className="app">
      <header>
        <h1>dobby</h1>
        <span className={`dot ${connected ? "on" : "off"}`} title={connected ? "live" : "reconnecting"} />
        <select
          className="house-mode"
          value={houseMode?.state ?? "home"}
          onChange={(e) =>
            sendCommand("input_select.house_mode", "input_select.select_option", { option: e.target.value })
              .catch((err) => alert(String(err)))
          }
        >
          {HOUSE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={() => enablePush().then((ok) => alert(ok ? "Push enabled" : "Push unavailable"))}>
          Enable alerts
        </button>
        <button onClick={onSignOut}>Sign out</button>
      </header>

      <section className="grid">
        <DoorTile e={states["lock.front_door_nuki"]} />
        <DoorTile e={states["lock.back_door_nuki"]} />
        <ClimateTile e={states["climate.hvac"]} />
      </section>

      <h2>Cameras</h2>
      <section className="grid cameras">
        {CAMERAS.map((c) => <CameraTile key={c} camera={c} />)}
      </section>

      <h2>Sensors</h2>
      <ul className="sensors">
        {sensors.map((e) => (
          <li key={e.entity_id}>
            <span>{(e.attributes.friendly_name as string) ?? e.entity_id}</span>
            <b>{e.state}{(e.attributes.unit_of_measurement as string) ?? ""}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
