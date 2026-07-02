// The seam: this BFF only ever exposes these entities and only calls these
// services. Adding a capability to the panel = adding it here, on purpose.
// Edit these lists to match your actual entity ids.

export const HA_BASE_URL = process.env.HA_BASE_URL ?? "http://homeassistant:8123";
export const HA_TOKEN = process.env.HA_TOKEN ?? "";
// go2rtc API (Frigate bundles go2rtc; default API port 1984). Used for WebRTC.
export const GO2RTC_URL = process.env.GO2RTC_URL ?? "http://frigate:1984";
export const PORT = Number(process.env.CONTROL_PANEL_PORT ?? 8088);

// Web Push (VAPID). Generate once: `npx web-push generate-vapid-keys`.
export const VAPID_PUBLIC = process.env.VAPID_PUBLIC ?? "";
export const VAPID_PRIVATE = process.env.VAPID_PRIVATE ?? "";
export const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@home.arpa";
// Shared secret HA presents (header x-push-secret) to fan out a push.
export const PUSH_SHARED_SECRET = process.env.PUSH_SHARED_SECRET ?? "";
// Where push subscriptions persist (survives container restarts).
export const PUSH_STORE = process.env.PUSH_STORE ?? "/data/push-subscriptions.json";

// --- Auth (the BFF is fail-closed: no SESSION_SECRET/ADMIN_PASSPHRASE_HASH -> all
// /api routes are refused). Generate the hash with:
//   node -e "const c=require('crypto');const s=c.randomBytes(16);process.stdout.write(s.toString('hex')+':'+c.scryptSync(process.argv[1],s,32).toString('hex'))" "YOUR-PASSPHRASE"
export const SESSION_SECRET = process.env.SESSION_SECRET ?? "";
export const ADMIN_PASSPHRASE_HASH = process.env.ADMIN_PASSPHRASE_HASH ?? "";
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
export const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 12 * 60 * 60 * 1000);
export const STEP_UP_TTL_MS = Number(process.env.STEP_UP_TTL_MS ?? 2 * 60 * 1000);
// Secure cookie flag; requires HTTPS. Only set false for a plain-HTTP LAN setup.
export const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? "true") !== "false";
// Household users (roles + passkeys) persist beside the push subscriptions.
export const USERS_STORE = process.env.USERS_STORE ?? "/data/users.json";
// WebAuthn RP ID — pin to the ts.net hostname (docs/14); renaming it later
// invalidates every registered passkey. Empty = derive from ALLOWED_ORIGINS.
export const WEBAUTHN_RP_ID = process.env.WEBAUTHN_RP_ID ?? "";
// Append-only attribution log of panel commands (who/role/what), on the
// persisted volume so it survives restarts and rides the nightly backups.
export const COMMAND_LOG = process.env.COMMAND_LOG ?? "/data/panel-commands.jsonl";

// Entities the panel may read AND the only ones state is forwarded for.
export const ENTITY_ALLOW: string[] = [
  "lock.front_door_nuki",
  "lock.back_door_nuki",
  "climate.zone_1",      // two-zone heat pump behind the TrueZONE HZ221 (docs/10)
  "climate.zone_2",
  "alarm_control_panel.dobby",
  "input_select.house_mode",
  "light.front_porch",
  "light.driveway",
  "binary_sensor.front_door_contact",
  "binary_sensor.back_door_contact",
  "binary_sensor.front_porch_motion",
  "binary_sensor.presence_kitchen",
  "binary_sensor.presence_living",
  "sensor.front_door_nuki_battery",
  "sensor.front_porch_lux",
];

// Services the panel may invoke. Anything else is rejected by the BFF.
export const SERVICE_ALLOW = new Set<string>([
  "lock.lock",
  "lock.unlock",
  "climate.set_temperature",
  "climate.set_hvac_mode",
  "alarm_control_panel.alarm_arm_home",
  "alarm_control_panel.alarm_arm_away",
  "alarm_control_panel.alarm_arm_night",
  "alarm_control_panel.alarm_disarm",
  "input_select.select_option",
  "light.turn_on",
  "light.turn_off",
]);

// go2rtc stream names (must match configs/frigate/config.yml go2rtc:streams).
// Only advertise cameras Frigate actually defines — add back_door/driveway here
// AND in configs/frigate/config.yml when the hardware lands.
export const CAMERAS: string[] = ["front_door"];

// Actions that should require a biometric re-confirm in the UI (advisory; the
// client enforces the prompt, the BFF still only allows the service above).
// Disarm is deliberately sensitive: the panel step-up IS the deliberate act
// the no-auto-disarm policy (docs/13) requires.
export const SENSITIVE_SERVICES = new Set<string>([
  "lock.unlock",
  "input_select.select_option",
  "alarm_control_panel.alarm_disarm",
]);
