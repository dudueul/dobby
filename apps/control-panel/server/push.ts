// Web Push (VAPID) fan-out. The BFF holds the VAPID private key; HA fires
// notify.dobby_push (REST notify) at POST /api/push/notify with the shared
// secret to deliver to every subscribed browser/PWA. Subscriptions persist to
// a JSON file under /data so they survive container restarts. The payload's
// `tier` maps to Web Push urgency: critical (wake the device), normal, info.
// Per docs/11: Web Push is informational; keep the HA Companion app alongside
// it for DND-piercing critical alarms on iOS.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import webpush from "web-push";
import { VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, PUSH_SHARED_SECRET, PUSH_STORE } from "./config.js";

export interface PushMessage {
  title: string; body: string; tag?: string; tier: "critical" | "normal" | "info";
}

/** Normalize an HA notify payload into the message + Web Push delivery options. */
export function pushPlan(raw: unknown): { message: PushMessage; options: webpush.RequestOptions } {
  const top = (raw ?? {}) as Record<string, unknown>;
  // HA's REST notify nests service-call extras under `data`; accept both shapes.
  const b = { ...top, ...(top.data as Record<string, unknown> | undefined) };
  const tier = b.tier === "critical" || b.tier === "info" ? b.tier : "normal";
  const message: PushMessage = {
    title: typeof b.title === "string" && b.title ? b.title : "dobby",
    body: typeof b.body === "string" ? b.body
      : typeof b.message === "string" ? b.message : "",
    tag: typeof b.tag === "string" ? b.tag : undefined,
    tier,
  };
  const byTier: Record<PushMessage["tier"], webpush.RequestOptions> = {
    critical: { urgency: "high", TTL: 3600 },
    normal: { urgency: "normal", TTL: 4 * 3600 },
    info: { urgency: "low", TTL: 24 * 3600 },
  };
  return { message, options: byTier[tier] };
}

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

export function registerPush(app: FastifyInstance, storePath: string = PUSH_STORE): void {
  let subscriptions: webpush.PushSubscription[] = (() => {
    try { return JSON.parse(readFileSync(storePath, "utf8")); } catch { return []; }
  })();
  const persist = (): void => {
    try {
      mkdirSync(path.dirname(storePath), { recursive: true });
      writeFileSync(storePath, JSON.stringify(subscriptions));
    } catch (e) {
      app.log.warn(`push store not writable (${storePath}): ${(e as Error).message}`);
    }
  };

  app.get("/api/push/pubkey", async () => ({ key: VAPID_PUBLIC }));

  app.post("/api/push/subscribe", async (req) => {
    const sub = req.body as webpush.PushSubscription;
    if (!subscriptions.find((s) => s.endpoint === sub.endpoint)) {
      subscriptions.push(sub);
      persist();
    }
    return { ok: true, count: subscriptions.length };
  });

  // Called by HA via notify.dobby_push (header x-push-secret).
  // Body: {title, body, tag?, tier?: critical|normal|info}.
  app.post("/api/push/notify", async (req, reply) => {
    if (!PUSH_SHARED_SECRET || req.headers["x-push-secret"] !== PUSH_SHARED_SECRET) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    const { message, options } = pushPlan(req.body);
    const payload = JSON.stringify(message);
    const results = await Promise.allSettled(
      subscriptions.map((s) => webpush.sendNotification(s, payload, options)),
    );
    // Drop dead subscriptions (410 Gone / 404) by endpoint, not by index.
    const dead = new Set(
      results
        .map((r, i) =>
          r.status === "rejected" && [404, 410].includes((r.reason as { statusCode?: number })?.statusCode ?? 0)
            ? subscriptions[i].endpoint : null)
        .filter((e): e is string => e !== null),
    );
    if (dead.size) {
      subscriptions = subscriptions.filter((s) => !dead.has(s.endpoint));
      persist();
    }
    return { sent: subscriptions.length, tier: message.tier };
  });
}
