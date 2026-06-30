// Thin client over the BFF. The browser only ever talks to /api/* — never to HA
// or a device directly. Live state via SSE; commands via POST; camera via WebRTC.
import { useEffect, useState } from "react";

export interface Entity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
}

export type StateMap = Record<string, Entity>;

/** Subscribe to live state over SSE; returns a map keyed by entity_id. */
export function useLiveState(): { states: StateMap; connected: boolean } {
  const [states, setStates] = useState<StateMap>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));
    es.addEventListener("snapshot", (e) => {
      const arr = JSON.parse((e as MessageEvent).data) as Entity[];
      setStates(Object.fromEntries(arr.map((s) => [s.entity_id, s])));
    });
    es.addEventListener("state", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as Entity;
      setStates((prev) => ({ ...prev, [s.entity_id]: s }));
    });
    return () => es.close();
  }, []);

  return { states, connected };
}

export async function sendCommand(entity_id: string, service: string, data?: Record<string, unknown>) {
  const res = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity_id, service, data }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `command failed (${res.status})`);
  return res.json();
}

/** Attach a live WebRTC stream from go2rtc (proxied by the BFF) to a <video>. */
export async function startCamera(video: HTMLVideoElement, camera: string): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = (ev) => { video.srcObject = ev.streams[0]; };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(`/api/webrtc/${camera}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: offer.type, sdp: offer.sdp }),
  });
  const answer = await res.json();
  await pc.setRemoteDescription(answer);
  return pc;
}

/** Register the service worker and subscribe to Web Push (informational alerts). */
export async function enablePush(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.register("/sw.js");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;
  const { key } = await (await fetch("/api/push/pubkey")).json();
  if (!key) return false;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });
  return true;
}

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length); // ArrayBuffer-backed (valid BufferSource)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
