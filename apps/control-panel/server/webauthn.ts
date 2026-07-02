// Passkey (WebAuthn) ceremonies over the household user store. Registration
// binds a platform authenticator (Face ID / fingerprint) to the session's
// user; step-up verifies an assertion and mints a *fresh* session, replacing
// the passphrase re-prompt for sensitive services. Ceremony crypto is
// @simplewebauthn's; what is ours: RP-ID/origin derivation (pinned to the
// ts.net hostname in production — docs/14), challenge lifecycle, counter
// updates, and the fresh-session issue.
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON, RegistrationResponseJSON,
} from "@simplewebauthn/types";
import { issueSession, effectiveProto, type Session } from "./auth.js";
import { ALLOWED_ORIGINS, STEP_UP_TTL_MS, WEBAUTHN_RP_ID } from "./config.js";
import type { UserStore } from "./users.js";

/** RP ID + expected origin: the explicit env pin wins; else the first allowed
 * origin; else the request host (dev). Pure — unit-tested. */
export function deriveRp(rpIdEnv: string, origins: string[], host: string | undefined,
                         proto: string): { rpID: string; origin: string } {
  if (rpIdEnv) return { rpID: rpIdEnv, origin: origins[0] ?? `https://${rpIdEnv}` };
  if (origins.length) {
    const u = new URL(origins[0]);
    return { rpID: u.hostname, origin: u.origin };
  }
  const h = host ?? "localhost";
  return { rpID: h.split(":")[0], origin: `${proto}://${h}` };
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function registerWebAuthn(app: FastifyInstance, users: UserStore): void {
  const challenges = new Map<string, { challenge: string; exp: number }>();
  const takeChallenge = (sub: string, now: number): string | undefined => {
    const c = challenges.get(sub);
    challenges.delete(sub);
    return c && c.exp > now ? c.challenge : undefined;
  };
  const rp = (req: FastifyRequest) => deriveRp(
    WEBAUTHN_RP_ID, ALLOWED_ORIGINS, req.headers.host,
    effectiveProto(req.headers["x-forwarded-proto"] as string | undefined,
                   Boolean((req.raw.socket as { encrypted?: boolean }).encrypted)),
  );
  // The env-bootstrapped admin has no store row until a passkey needs one.
  const ensureUser = (s: Session) =>
    users.find(s.sub) ??
    (users.upsert({ sub: s.sub, role: s.role, creds: [] }), users.find(s.sub)!);

  app.post("/api/webauthn/register/options", async (req) => {
    const u = ensureUser(req.session!);
    const { rpID } = rp(req);
    const options = await generateRegistrationOptions({
      rpName: "dobby", rpID,
      userID: new TextEncoder().encode(u.sub), userName: u.sub,
      attestationType: "none",
      excludeCredentials: u.creds.map((c) => ({ id: c.id, transports: c.transports as never })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    challenges.set(u.sub, { challenge: options.challenge, exp: Date.now() + CHALLENGE_TTL_MS });
    return options;
  });

  app.post("/api/webauthn/register/verify", async (req, reply) => {
    const s = req.session!;
    const { rpID, origin } = rp(req);
    const expectedChallenge = takeChallenge(s.sub, Date.now());
    if (!expectedChallenge) { reply.code(400); return { error: "no pending challenge" }; }
    const result = await verifyRegistrationResponse({
      response: req.body as RegistrationResponseJSON,
      expectedChallenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true,
    }).catch(() => null);
    if (!result?.verified || !result.registrationInfo) {
      reply.code(400); return { error: "registration not verified" };
    }
    const info = result.registrationInfo;
    ensureUser(s);
    users.addCredential(s.sub, {
      id: info.credentialID,
      publicKey: Buffer.from(info.credentialPublicKey).toString("base64url"),
      counter: info.counter,
      transports: (req.body as RegistrationResponseJSON).response?.transports,
    });
    return { ok: true };
  });

  app.post("/api/webauthn/stepup/options", async (req, reply) => {
    const u = users.find(req.session!.sub);
    if (!u?.creds.length) { reply.code(404); return { error: "no_passkey" }; }
    const options = await generateAuthenticationOptions({
      rpID: rp(req).rpID,
      allowCredentials: u.creds.map((c) => ({ id: c.id, transports: c.transports as never })),
      userVerification: "required",
    });
    challenges.set(u.sub, { challenge: options.challenge, exp: Date.now() + CHALLENGE_TTL_MS });
    return options;
  });

  app.post("/api/webauthn/stepup/verify", async (req, reply) => {
    const s = req.session!;
    const body = req.body as AuthenticationResponseJSON;
    const u = users.find(s.sub);
    const cred = u?.creds.find((c) => c.id === body.id);
    const expectedChallenge = takeChallenge(s.sub, Date.now());
    if (!u || !cred || !expectedChallenge) { reply.code(400); return { error: "no pending challenge" }; }
    const { rpID, origin } = rp(req);
    const result = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge, expectedOrigin: origin, expectedRPID: rpID,
      authenticator: {
        credentialID: cred.id,
        credentialPublicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter,
        transports: cred.transports as never,
      },
      requireUserVerification: true,
    }).catch(() => null);
    if (!result?.verified) { reply.code(401); return { error: "assertion not verified" }; }
    users.setCounter(u.sub, cred.id, result.authenticationInfo.newCounter);
    issueSession(reply, u.sub, u.role, Date.now());
    return { ok: true, freshForMs: STEP_UP_TTL_MS };
  });
}
