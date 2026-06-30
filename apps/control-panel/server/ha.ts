// Home Assistant client: the deep module that owns the HA protocol. Holds the
// long-lived token server-side (never sent to the browser), keeps a live state
// cache via the HA WebSocket, and enforces the entity/service allow-list on
// every command.
import WebSocket from "ws";
import { HA_BASE_URL, HA_TOKEN, ENTITY_ALLOW, SERVICE_ALLOW } from "./config.js";

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
}

type Listener = (s: HaState) => void;

export class HaClient {
  private ws?: WebSocket;
  private msgId = 1;
  private cache = new Map<string, HaState>();
  private listeners = new Set<Listener>();
  private allow = new Set(ENTITY_ALLOW);

  start(): void {
    this.connect();
  }

  snapshot(): HaState[] {
    return [...this.cache.values()];
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private connect(): void {
    const url = HA_BASE_URL.replace(/^http/, "ws") + "/api/websocket";
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
      } else if (msg.type === "auth_ok") {
        this.fetchStates().catch(() => {});
        ws.send(JSON.stringify({ id: this.msgId++, type: "subscribe_events", event_type: "state_changed" }));
      } else if (msg.type === "auth_invalid") {
        console.error("HA auth failed — check HA_TOKEN");
      } else if (msg.type === "event" && msg.event?.event_type === "state_changed") {
        const s: HaState | undefined = msg.event.data?.new_state;
        if (s && this.allow.has(s.entity_id)) {
          this.cache.set(s.entity_id, s);
          for (const fn of this.listeners) fn(s);
        }
      }
    });

    ws.on("close", () => setTimeout(() => this.connect(), 3000));
    ws.on("error", (e) => console.error("HA ws error:", (e as Error).message));
  }

  private async fetchStates(): Promise<void> {
    const res = await fetch(HA_BASE_URL + "/api/states", {
      headers: { Authorization: `Bearer ${HA_TOKEN}` },
    });
    if (!res.ok) throw new Error(`HA /api/states ${res.status}`);
    const all = (await res.json()) as HaState[];
    for (const s of all) if (this.allow.has(s.entity_id)) this.cache.set(s.entity_id, s);
  }

  async callService(entity_id: string, service: string, data: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.allow.has(entity_id)) throw new Error(`entity not allowed: ${entity_id}`);
    if (!SERVICE_ALLOW.has(service)) throw new Error(`service not allowed: ${service}`);
    const [domain, svc] = service.split(".");
    const res = await fetch(`${HA_BASE_URL}/api/services/${domain}/${svc}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${HA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id, ...data }),
    });
    if (!res.ok) throw new Error(`HA service ${service} -> ${res.status}`);
    return res.json();
  }
}
