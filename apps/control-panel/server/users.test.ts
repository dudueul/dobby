// One assertion per test; names read as English sentences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openUserStore, roleAllows, hashPassphrase } from "./users.js";
import { verifyPassphrase } from "./auth.js";

test("roleAllows_deniesAGuestTheUnlockService", () => {
  assert.equal(roleAllows("guest", "lock.unlock"), false);
});

test("roleAllows_deniesAGuestTheAlarmDisarmService", () => {
  assert.equal(roleAllows("guest", "alarm_control_panel.alarm_disarm"), false);
});

test("roleAllows_letsAGuestAdjustTheClimate", () => {
  assert.equal(roleAllows("guest", "climate.set_temperature"), true);
});

test("roleAllows_letsFamilyUnlockTheDoor", () => {
  assert.equal(roleAllows("family", "lock.unlock"), true);
});

test("userStore_persistsAUserAcrossReopen", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "users-")), "users.json");
  openUserStore(file).upsert({ sub: "kid", role: "guest", creds: [] });
  assert.equal(openUserStore(file).find("kid")?.role, "guest");
});

test("hashPassphrase_roundTripsWithVerifyPassphrase", () => {
  assert.equal(verifyPassphrase("s3cret", hashPassphrase("s3cret")), true);
});
