// Household user store — file-backed like the push store, sized for a family
// (a handful of users), hiding persistence + role policy behind one seam.
// Bootstrap: with no store file, ADMIN_PASSPHRASE_HASH (config.ts) acts as the
// sole "admin" login so the panel works before any user management happens.
import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Role = "admin" | "family" | "guest";

export interface StoredCredential {
  id: string;          // base64url credential id
  publicKey: string;   // base64url COSE public key
  counter: number;
  transports?: string[];
}

export interface PanelUser {
  sub: string;
  role: Role;
  passHash?: string;   // "salthex:hashhex" scrypt, same format as the env admin
  creds: StoredCredential[];
}

export interface UserStore {
  all(): PanelUser[];
  find(sub: string): PanelUser | undefined;
  upsert(user: PanelUser): void;
  addCredential(sub: string, cred: StoredCredential): boolean;
  setCounter(sub: string, credId: string, counter: number): void;
}

export function openUserStore(storePath: string): UserStore {
  let users: PanelUser[] = (() => {
    try { return JSON.parse(readFileSync(storePath, "utf8")); } catch { return []; }
  })();
  const persist = (): void => {
    mkdirSync(path.dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify(users, null, 2));
  };
  return {
    all: () => users,
    find: (sub) => users.find((u) => u.sub === sub),
    upsert(user) {
      users = [...users.filter((u) => u.sub !== user.sub), user];
      persist();
    },
    addCredential(sub, cred) {
      const u = users.find((x) => x.sub === sub);
      if (!u) return false;
      u.creds = [...u.creds.filter((c) => c.id !== cred.id), cred];
      persist();
      return true;
    },
    setCounter(sub, credId, counter) {
      const c = users.find((x) => x.sub === sub)?.creds.find((x) => x.id === credId);
      if (c) { c.counter = counter; persist(); }
    },
  };
}

/** Guests get comfort controls only — locks, arming, and house-mode never.
 * Enforced server-side in /api/command regardless of what the UI shows. */
const GUEST_SERVICES = new Set([
  "climate.set_temperature", "climate.set_hvac_mode", "light.turn_on", "light.turn_off",
]);

export function roleAllows(role: Role | string, service: string): boolean {
  if (role === "admin" || role === "family") return true;
  return GUEST_SERVICES.has(service);
}

/** Hash a new user's passphrase in the same format verifyPassphrase reads. */
export function hashPassphrase(pass: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pass, salt, 32).toString("hex")}`;
}
