/**
 * ماندگاری وضعیت در localStorage + حالت پیش‌فرض + اعتبارسنجی هنگام ورود داده.
 * این فایل در node هم اجرا می‌شود (تست) — پس همه‌ی دسترسی‌ها try/catch دارند.
 */
import type {
  AppState,
  Control,
  ControlType,
  Profile,
  Suffix,
  TransportKind,
} from "./types.ts";

const KEY = "arduremote.state.v1";

export const COLORS = ["#00e0a4", "#4d9dff", "#ffb347", "#ff5c7a", "#b48bff", "#f78fb3"] as const;
export const SUFFIXES: Suffix[] = ["", "\n", "\r\n"];

export function newId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------- حالت پیش‌فرض */

export function defaultState(): AppState {
  const profile: Profile = {
    id: newId(),
    name: "دستگاه من",
    icon: "🔧",
    controls: [
      {
        id: newId(),
        type: "toggle",
        name: "چراغ اتاق",
        icon: "💡",
        color: "#00e0a4",
        suffix: "",
        onPayload: "1",
        offPayload: "0",
        on: false,
      },
      {
        id: newId(),
        type: "momentary",
        name: "آژیر",
        icon: "🔔",
        color: "#ffb347",
        suffix: "",
        pressPayload: "H",
        releasePayload: "",
      },
      {
        id: newId(),
        type: "slider",
        name: "سرعت موتور",
        icon: "⚡",
        color: "#4d9dff",
        suffix: "",
        template: "V{v}",
        min: 0,
        max: 100,
        outMin: 0,
        outMax: 255,
        value: 0,
        sendOnRelease: false,
      },
      {
        id: newId(),
        type: "text",
        name: "دستور دلخواه",
        icon: "🎛️",
        color: "#b48bff",
        suffix: "",
        placeholder: "مثلاً: P",
        text: "",
      },
    ],
  };
  return {
    version: 1,
    profiles: [profile],
    activeProfileId: profile.id,
    transport: { kind: "demo", wsUrl: "ws://192.168.1.10:81", btAddress: "", btName: "" },
  };
}

/* ------------------------------------------------------- اعتبارسنجی */

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function str(v: unknown, fallback = ""): string {
  return isStr(v) ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return isNum(v) ? v : fallback;
}
function suffix(v: unknown): Suffix {
  return v === "\n" || v === "\r\n" ? v : "";
}
function color(v: unknown): string {
  return isStr(v) && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : COLORS[0];
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const TYPES: ControlType[] = ["toggle", "momentary", "slider", "text"];
const KINDS: TransportKind[] = ["demo", "bluetooth", "webserial", "websocket"];

/** هر کنترل ناقص را ترمیم می‌کند؛ اگر اساساً قابل نجات نبود null برمی‌گرداند */
export function normalizeControl(x: unknown): Control | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const type = oneOf(o.type, TYPES, "toggle");
  const base = {
    id: str(o.id) || newId(),
    name: str(o.name).trim() || "بدون نام",
    icon: str(o.icon, "🔧").slice(0, 4),
    color: color(o.color),
    suffix: suffix(o.suffix),
  };

  switch (type) {
    case "toggle": {
      const onPayload = str(o.onPayload);
      const offPayload = str(o.offPayload);
      if (onPayload === "" && offPayload === "") return null;
      return { ...base, type, onPayload, offPayload, on: o.on === true };
    }
    case "momentary": {
      const pressPayload = str(o.pressPayload);
      if (pressPayload === "") return null;
      return { ...base, type, pressPayload, releasePayload: str(o.releasePayload) };
    }
    case "slider": {
      const template = str(o.template);
      if (!template.includes("{v}")) return null;
      const min = num(o.min, 0);
      const max = num(o.max, 100);
      if (min === max) return null;
      return {
        ...base,
        type,
        template,
        min,
        max,
        outMin: num(o.outMin, 0),
        outMax: num(o.outMax, 255),
        value: num(o.value, min),
        sendOnRelease: o.sendOnRelease === true,
      };
    }
    case "text": {
      return {
        ...base,
        type,
        placeholder: str(o.placeholder, "متن را بنویس"),
        text: str(o.text),
      };
    }
  }
}

function normalizeProfile(x: unknown): Profile | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.controls)) return null;
  const controls = o.controls.map(normalizeControl).filter((c): c is Control => c !== null);
  return {
    id: str(o.id) || newId(),
    name: str(o.name).trim() || "دستگاه",
    icon: str(o.icon, "🔧").slice(0, 4),
    controls,
  };
}

/** هر ورودی خام (ذخیره‌شده یا ایمپورت‌شده) را به AppState سالم تبدیل می‌کند */
export function normalizeState(x: unknown): AppState | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.profiles)) return null;
  const profiles = o.profiles.map(normalizeProfile).filter((p): p is Profile => p !== null);
  if (profiles.length === 0) return null;

  const activeId = str(o.activeProfileId);
  const activeProfileId = profiles.some((p) => p.id === activeId) ? activeId : profiles[0]!.id;

  const t =
    typeof o.transport === "object" && o.transport !== null
      ? (o.transport as Record<string, unknown>)
      : {};
  const kind = oneOf(t.kind, KINDS, "demo");

  return {
    version: 1,
    profiles,
    activeProfileId,
    transport: {
      kind,
      wsUrl: str(t.wsUrl, "ws://192.168.1.10:81"),
      btAddress: str(t.btAddress),
      btName: str(t.btName),
    },
  };
}

/* ------------------------------------------------------- I/O */

export function loadState(): AppState {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw)) ?? defaultState();
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state));
  } catch {
    /* سهمیه‌ی پر یا حالت خصوصی — بی‌صدا رد شو */
  }
}

export function clearState(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** ایمپورت JSON دستی — خطای قابل نمایش برمی‌گرداند، exception نمی‌دهد */
export function parseImport(json: string): { ok: true; state: AppState } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "متن واردشده JSON معتبر نیست" };
  }
  const state = normalizeState(parsed);
  if (!state) return { ok: false, error: "ساختار فایل خوانده نشد (پروفایل/کنترل نامعتبر)" };
  return { ok: true, state };
}

export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}
