import { useLiveState, sendCommand, enablePush } from "./api";
import { DoorTile } from "./components/DoorTile";
import { ClimateTile } from "./components/ClimateTile";
import { CameraTile } from "./components/CameraTile";

const CAMERAS = ["front_door", "back_door", "driveway"];
const HOUSE_MODES = ["home", "away", "night", "guest"];

export default function App() {
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
          }
        >
          {HOUSE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={() => enablePush().then((ok) => alert(ok ? "Push enabled" : "Push unavailable"))}>
          Enable alerts
        </button>
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
