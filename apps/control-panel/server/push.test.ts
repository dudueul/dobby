// One assertion per test; names read as English sentences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { pushPlan, registerPush } from "./push.js";

test("pushPlan_marksCriticalAsHighUrgency", () => {
  assert.equal(pushPlan({ title: "t", body: "b", tier: "critical" }).options.urgency, "high");
});

test("pushPlan_defaultsUnknownTierToNormal", () => {
  assert.equal(pushPlan({ title: "t", body: "b", tier: "loud" }).message.tier, "normal");
});

test("pushPlan_acceptsMessageAsBodyAlias", () => {
  assert.equal(pushPlan({ message: "hello" }).message.body, "hello");
});

test("subscriptions_surviveARestart", async () => {
  const store = path.join(mkdtempSync(path.join(tmpdir(), "push-")), "subs.json");
  const sub = { endpoint: "https://push.example/1", keys: { p256dh: "k", auth: "a" } };
  const app1 = Fastify();
  registerPush(app1, store);
  await app1.inject({ method: "POST", url: "/api/push/subscribe", payload: sub });
  const app2 = Fastify();
  registerPush(app2, store);
  const res = await app2.inject({
    method: "POST", url: "/api/push/subscribe",
    payload: { ...sub, endpoint: "https://push.example/2" },
  });
  assert.equal(res.json().count, 2);
});
