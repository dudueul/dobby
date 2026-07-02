// One assertion per test; names read as English sentences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveRp } from "./webauthn.js";

test("deriveRp_pinsToTheExplicitEnvRpId", () => {
  assert.equal(deriveRp("hub.tail1234.ts.net", [], "lan-host:8088", "http").rpID, "hub.tail1234.ts.net");
});

test("deriveRp_fallsBackToTheFirstAllowedOriginHostname", () => {
  assert.equal(deriveRp("", ["https://hub.tail1234.ts.net"], undefined, "https").rpID, "hub.tail1234.ts.net");
});

test("deriveRp_usesTheRequestHostOnlyAsALastResort", () => {
  assert.deepEqual(deriveRp("", [], "localhost:8088", "http"),
    { rpID: "localhost", origin: "http://localhost:8088" });
});
