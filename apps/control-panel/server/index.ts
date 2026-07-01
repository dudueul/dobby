// Control-panel BFF. Serves the PWA, proxies HA (live state + allow-listed
// commands), proxies go2rtc WebRTC for live camera, and fans out Web Push.
// The browser never holds the HA token and never speaks a device protocol.
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fstatic from "@fastify/static";
import { HaClient } from "./ha.js";
import { registerPush } from "./push.js";
import { registerAuth, needsStepUp, isFresh } from "./auth.js";
import { PORT, GO2RTC_URL, CAMERAS, STEP_UP_TTL_MS } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Trust only the loopback proxy (tailscale serve) so req.ip = the real client
// for login rate-limiting, and X-Forwarded-Proto is honored for Secure cookies.
const app = Fastify({ logger: true, trustProxy: "127.0.0.1" });
const ha = new HaClient();
ha.start();

// Authenticate the panel first: every /api route below is gated (fail-closed).
registerAuth(app);

// Snapshot of current allow-listed state.
app.get("/api/state", async () => ha.snapshot());

// Live state via Server-Sent Events (auto-reconnects in the browser).
app.get("/api/stream", (req, reply) => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(ha.snapshot())}\n\n`);
  const off = ha.onChange((s) => reply.raw.write(`event: state\ndata: ${JSON.stringify(s)}\n\n`));
  const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25000);
  req.raw.on("close", () => { off(); clearInterval(ping); });
});

// Command (BFF enforces the entity + service allow-list in ha.callService).
app.post("/api/command", async (req, reply) => {
  const { entity_id, service, data } = (req.body ?? {}) as {
    entity_id?: string; service?: string; data?: Record<string, unknown>;
  };
  if (!entity_id || !service) { reply.code(400); return { error: "entity_id and service required" }; }
  // Sensitive services (unlock/arm) require a *fresh* session — server-side
  // step-up, enforced regardless of what the client UI does.
  if (needsStepUp(service) && !(req.session && isFresh(req.session, Date.now(), STEP_UP_TTL_MS))) {
    reply.code(401); return { error: "step_up_required", stepUp: true };
  }
  try {
    return await ha.callService(entity_id, service, data ?? {});
  } catch (e) {
    reply.code(400);
    return { error: (e as Error).message };
  }
});

// Live camera: proxy a WebRTC offer to go2rtc and return its answer (WHEP-style).
// Verify the go2rtc endpoint shape against your go2rtc version.
app.post("/api/webrtc/:camera", async (req, reply) => {
  const cam = (req.params as { camera: string }).camera;
  if (!CAMERAS.includes(cam)) { reply.code(404); return { error: "unknown camera" }; }
  const res = await fetch(`${GO2RTC_URL}/api/webrtc?src=${encodeURIComponent(cam)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body),
  });
  reply.code(res.status);
  return res.json();
});

registerPush(app);

// Serve the built PWA with SPA fallback.
await app.register(fstatic, { root: path.join(__dirname, "../web/dist") });
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/api/")) { reply.code(404).send({ error: "not found" }); return; }
  reply.sendFile("index.html");
});

app.listen({ host: "0.0.0.0", port: PORT }).then((addr) => app.log.info(`control-panel on ${addr}`));
