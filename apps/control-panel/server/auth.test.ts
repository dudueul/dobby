// Pure-helper tests for the auth seam. One assertion per fact; sentence names.
// Run: npm test  (node --test via tsx)
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import {
  signSession, verifySession, isFresh, verifyPassphrase, isAllowedOrigin, effectiveProto,
} from "./auth.js";

const SECRET = "unit-secret";
const at = (now: number, ttl = 10_000) =>
  ({ sub: "admin", role: "admin" as const, authAt: now, exp: now + ttl });

test("verifySession_acceptsAFreshlySignedToken", () => {
  const s = at(1000);
  assert.deepEqual(verifySession(signSession(s, SECRET), SECRET, 1001), s);
});

test("verifySession_rejectsATamperedToken", () => {
  const tok = signSession(at(1000), SECRET);
  assert.equal(verifySession(tok + "x", SECRET, 1001), null);
});

test("verifySession_rejectsAnExpiredToken", () => {
  const tok = signSession(at(1000, 10), SECRET);
  assert.equal(verifySession(tok, SECRET, 2000), null);
});

test("verifySession_rejectsAWrongSecret", () => {
  const tok = signSession(at(1000), SECRET);
  assert.equal(verifySession(tok, "other-secret", 1001), null);
});

test("isFresh_isFalsePastTheStepUpWindow", () => {
  assert.equal(isFresh(at(0), 5000, 2000), false);
});

test("isFresh_isTrueInsideTheStepUpWindow", () => {
  assert.equal(isFresh(at(0), 1000, 2000), true);
});

test("verifyPassphrase_acceptsTheCorrectPassphrase", () => {
  const salt = randomBytes(16);
  const stored = `${salt.toString("hex")}:${scryptSync("hunter2", salt, 32).toString("hex")}`;
  assert.equal(verifyPassphrase("hunter2", stored), true);
});

test("verifyPassphrase_rejectsAWrongPassphrase", () => {
  const salt = randomBytes(16);
  const stored = `${salt.toString("hex")}:${scryptSync("hunter2", salt, 32).toString("hex")}`;
  assert.equal(verifyPassphrase("nope", stored), false);
});

test("isAllowedOrigin_rejectsARequestWithNoOrigin", () => {
  assert.equal(isAllowedOrigin(undefined, "dobby:8088", []), false);
});

test("isAllowedOrigin_defaultsToSameOriginAsHost", () => {
  assert.equal(isAllowedOrigin("http://dobby:8088", "dobby:8088", []), true);
});

test("isAllowedOrigin_rejectsACrossOriginRequest", () => {
  assert.equal(isAllowedOrigin("http://evil:8088", "dobby:8088", []), false);
});

test("effectiveProto_trustsAForwardedHttpsHeader", () => {
  assert.equal(effectiveProto("https", false), "https");
});

test("effectiveProto_reportsPlainHttpWhenNothingSaysOtherwise", () => {
  assert.equal(effectiveProto(undefined, false), "http");
});
