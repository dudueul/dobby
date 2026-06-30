// Web Push (VAPID) fan-out. The BFF holds the VAPID private key; HA fires a
// rest_command to POST /api/push/notify with the shared secret to deliver a
// notification to all subscribed browsers. Per docs/11: use this for
// informational alerts; keep the HA Companion app for security-critical
// (Time-Sensitive/Critical) alerts on iOS.
import type { FastifyInstance } from "fastify";
import webpush from "web-push";
import { VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, PUSH_SHARED_SECRET } from "./config.js";

// NOTE: in-memory for the scaffold. Persist subscriptions (Postgres or a file)
// so they survive a restart.
const subscriptions: webpush.PushSubscription[] = [];

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

export function registerPush(app: FastifyInstance): void {
  app.get("/api/push/pubkey", async () => ({ key: VAPID_PUBLIC }));

  app.post("/api/push/subscribe", async (req) => {
    const sub = req.body as webpush.PushSubscription;
    if (!subscriptions.find((s) => s.endpoint === sub.endpoint)) subscriptions.push(sub);
    return { ok: true, count: subscriptions.length };
  });

  // Called by HA via rest_command (header x-push-secret). Body: {title, body, tag?}.
  app.post("/api/push/notify", async (req, reply) => {
    if (!PUSH_SHARED_SECRET || req.headers["x-push-secret"] !== PUSH_SHARED_SECRET) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    const payload = JSON.stringify(req.body ?? {});
    const results = await Promise.allSettled(
      subscriptions.map((s) => webpush.sendNotification(s, payload)),
    );
    // Drop dead subscriptions (410 Gone / 404).
    results.forEach((r, i) => {
      if (r.status === "rejected" && [404, 410].includes((r.reason as any)?.statusCode)) {
        subscriptions.splice(i, 1);
      }
    });
    return { sent: subscriptions.length };
  });
}
