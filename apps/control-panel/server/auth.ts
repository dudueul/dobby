// Authenticated session gate for the BFF. Every /api route except login/logout
// and the shared-secret push webhook requires a valid signed session cookie;
// sensitive services (unlock/arm) additionally require a *fresh* session
// (step-up). Fails CLOSED: if the admin secret or session key is unset, all
// gated routes are refused. NON-GOALS (follow-up slices): WebAuthn/passkey, TLS
// termination, persisted sessions, per-user roles.
import { createHmac, timingSafeEqual, scryptSync } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  SESSION_SECRET, ADMIN_PASSPHRASE_HASH, ALLOWED_ORIGINS,
  SESSION_TTL_MS, STEP_UP_TTL_MS, COOKIE_SECURE, SENSITIVE_SERVICES,
} from "./config.js";
import { hashPassphrase, type Role, type UserStore } from "./users.js";

export interface Session { sub: string; role: Role; authAt: number; exp: number }

declare module "fastify" {
  interface FastifyRequest { session?: Session }
}

const COOKIE = "dobby_session";
const OPEN_PATHS = new Set(["/api/login", "/api/logout", "/api/push/notify"]);

// ---- pure helpers (no I/O; unit-tested in auth.test.ts) ----
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A state-changing request must carry an Origin; default to same-origin as Host. */
export function isAllowedOrigin(
  origin: string | undefined, host: string | undefined, allow: string[],
): boolean {
  if (!origin) return false;
  if (allow.length) return allow.includes(origin);
  try { return new URL(origin).host === host; } catch { return false; }
}

export function needsStepUp(service: string): boolean {
  return SENSITIVE_SERVICES.has(service);
}

export function signSession(s: Session, secret: string): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined, secret: string, now: number): Session | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!timingSafeEqualStr(token.slice(dot + 1), expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    if (typeof s.exp !== "number" || s.exp <= now) return null;
    return { ...s, role: s.role ?? "admin" };
  } catch { return null; }
}

export function isFresh(s: Session, now: number, ttlMs: number): boolean {
  return now - s.authAt < ttlMs;
}

/** Effective request protocol behind a loopback TLS proxy (tailscale serve
 * sets X-Forwarded-Proto). Diagnostic, not a security gate: a spoofed header
 * only earns the client a Secure cookie its own browser then refuses. */
export function effectiveProto(xfProto: string | undefined, socketEncrypted: boolean): "https" | "http" {
  return xfProto === "https" || socketEncrypted ? "https" : "http";
}

/** Verify a passphrase against a stored "salthex:hashhex" scrypt hash. */
export function verifyPassphrase(pass: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = scryptSync(pass, Buffer.from(saltHex, "hex"), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---- effectful wiring ----
function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function setSessionCookie(reply: FastifyReply, token: string, maxAgeMs: number): void {
  const attrs = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (COOKIE_SECURE) attrs.push("Secure");
  reply.header("Set-Cookie", attrs.join("; "));
}

const attempts = new Map<string, { n: number; until: number }>();
function rateLimited(ip: string, now: number): boolean {
  const a = attempts.get(ip);
  return Boolean(a && a.until > now && a.n >= 5);
}
function recordFail(ip: string, now: number): void {
  const a = attempts.get(ip);
  const n = a && a.until > now ? a.n + 1 : 1;
  attempts.set(ip, { n, until: now + 15 * 60 * 1000 });
}

export function authConfigured(): boolean {
  return Boolean(SESSION_SECRET && ADMIN_PASSPHRASE_HASH);
}

/** Issue (or refresh) the signed session cookie. Also the seam the passkey
 * step-up uses to mint a *fresh* session after a verified assertion. */
export function issueSession(reply: FastifyReply, sub: string, role: Role, now: number): Session {
  const s: Session = { sub, role, authAt: now, exp: now + SESSION_TTL_MS };
  setSessionCookie(reply, signSession(s, SESSION_SECRET), SESSION_TTL_MS);
  return s;
}

export function registerAuth(app: FastifyInstance, users?: UserStore): void {
  app.post("/api/login", async (req, reply) => {
    const now = Date.now();
    if (!authConfigured()) { reply.code(503); return { error: "auth not configured" }; }
    // Fail loudly instead of issuing a Secure cookie the browser will drop:
    // the shipped COOKIE_SECURE=true default used to break plain-HTTP login
    // silently (it looked like a wrong passphrase).
    const proto = effectiveProto(
      req.headers["x-forwarded-proto"] as string | undefined,
      Boolean((req.raw.socket as { encrypted?: boolean }).encrypted),
    );
    if (COOKIE_SECURE && proto !== "https") {
      reply.code(400);
      return { error: "insecure_origin", hint: "COOKIE_SECURE=true needs HTTPS (tailscale serve) or set COOKIE_SECURE=false for a LAN test" };
    }
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, ALLOWED_ORIGINS)) {
      reply.code(403); return { error: "bad origin" };
    }
    if (rateLimited(req.ip, now)) { reply.code(429); return { error: "too many attempts" }; }
    const body = (req.body ?? {}) as { passphrase?: string; user?: string };
    const pass = body.passphrase ?? "";
    // "admin" is the env-bootstrapped account; everyone else lives in the store.
    const who = body.user?.trim() || "admin";
    let role: Role = "admin";
    let ok = false;
    if (who === "admin") {
      ok = verifyPassphrase(pass, ADMIN_PASSPHRASE_HASH);
    } else {
      const u = users?.find(who);
      ok = Boolean(u?.passHash) && verifyPassphrase(pass, u!.passHash!);
      role = u?.role ?? "guest";
    }
    if (!ok) {
      recordFail(req.ip, now); reply.code(401); return { error: "invalid" };
    }
    attempts.delete(req.ip);
    const s = issueSession(reply, who, role, now);
    return { ok: true, role: s.role, freshForMs: STEP_UP_TTL_MS };
  });

  // Household user management — admin only. Passkeys register separately.
  app.get("/api/users", async (req, reply) => {
    if (req.session?.role !== "admin") { reply.code(403); return { error: "admin only" }; }
    return (users?.all() ?? []).map((u) => ({ sub: u.sub, role: u.role, passkeys: u.creds.length }));
  });

  app.post("/api/users", async (req, reply) => {
    if (req.session?.role !== "admin") { reply.code(403); return { error: "admin only" }; }
    const b = (req.body ?? {}) as { sub?: string; role?: Role; passphrase?: string };
    if (!users || !b.sub || !b.role || !b.passphrase || b.sub === "admin") {
      reply.code(400); return { error: "sub, role, passphrase required" };
    }
    users.upsert({ sub: b.sub, role: b.role, passHash: hashPassphrase(b.passphrase),
                   creds: users.find(b.sub)?.creds ?? [] });
    return { ok: true };
  });

  app.post("/api/logout", async (_req, reply) => {
    setSessionCookie(reply, "", 0);
    return { ok: true };
  });

  // Gate every other /api/* route (static PWA files are served ungated so the
  // login page can load).
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split("?")[0];
    if (!url.startsWith("/api/") || OPEN_PATHS.has(url)) return;
    if (!authConfigured()) { reply.code(503).send({ error: "auth not configured" }); return; }
    if (req.method !== "GET" && req.method !== "HEAD" &&
        !isAllowedOrigin(req.headers.origin, req.headers.host, ALLOWED_ORIGINS)) {
      reply.code(403).send({ error: "bad origin" }); return;
    }
    const s = verifySession(parseCookie(req.headers.cookie, COOKIE), SESSION_SECRET, Date.now());
    if (!s) { reply.code(401).send({ error: "unauthenticated" }); return; }
    req.session = s;
  });
}
