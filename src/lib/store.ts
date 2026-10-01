/**
 * فروشگاه وضعیت — الگوی «یک شیء خارجی + useSyncExternalStore».
 * وضعیت نامتغیر جایگزین می‌شود تا هوک React هر تغییر را با Object.is ببیند.
 */
import type { AppState, Control, Profile, TransportConfig } from "./types.ts";
import {
  clearState,
  defaultState,
  loadState,
  newId,
  normalizeState,
  parseImport,
  saveState,
} from "./storage.ts";

export type Listener = () => void;
export type ImportResult = { ok: true } | { ok: false; error: string };

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial?: AppState) {
    this.state = initial ?? loadState();
  }

  /** امضای پایدار برای useSyncExternalStore */
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  /** امضای پایدار برای useSyncExternalStore */
  snapshot = (): AppState => this.state;

  private set(next: AppState): void {
    this.state = next;
    saveState(next);
    for (const l of [...this.listeners]) l();
  }

  /* ------------------------------------------------ پروفایل‌ها */

  get activeProfile(): Profile {
    const found = this.state.profiles.find((p) => p.id === this.state.activeProfileId);
    return found ?? this.state.profiles[0]!;
  }

  get profileCount(): number {
    return this.state.profiles.length;
  }

  setActiveProfile(id: string): boolean {
    if (!this.state.profiles.some((p) => p.id === id)) return false;
    this.set({ ...this.state, activeProfileId: id });
    return true;
  }

  addProfile(name: string, icon: string): Profile {
    const profile: Profile = {
      id: newId(),
      name: name.trim() || "دستگاه",
      icon: icon.trim() || "🔧",
      controls: [],
    };
    this.set({
      ...this.state,
      profiles: [...this.state.profiles, profile],
      activeProfileId: profile.id,
    });
    return profile;
  }

  renameProfile(id: string, name: string, icon: string): boolean {
    let done = false;
    const profiles = this.state.profiles.map((p) => {
      if (p.id !== id) return p;
      done = true;
      return { ...p, name: name.trim() || p.name, icon: icon.trim() || p.icon };
    });
    if (done) this.set({ ...this.state, profiles });
    return done;
  }

  /** حذف پروفایل — آخرین پروفایل قابل حذف نیست (همیشه باید یکی بماند) */
  removeProfile(id: string): boolean {
    if (this.state.profiles.length <= 1) return false;
    const idx = this.state.profiles.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    const profiles = this.state.profiles.filter((p) => p.id !== id);
    const activeProfileId =
      this.state.activeProfileId === id ? profiles[0]!.id : this.state.activeProfileId;
    this.set({ ...this.state, profiles, activeProfileId });
    return true;
  }

  /* ------------------------------------------------ کنترل‌ها (روی پروفایل فعال) */

  private mapActive(fn: (p: Profile) => Profile): boolean {
    const idx = this.state.profiles.findIndex((p) => p.id === this.state.activeProfileId);
    if (idx < 0) return false;
    const profiles = [...this.state.profiles];
    profiles[idx] = fn(profiles[idx]!);
    this.set({ ...this.state, profiles });
    return true;
  }

  addControl(control: Control): boolean {
    return this.mapActive((p) => ({ ...p, controls: [...p.controls, control] }));
  }

  replaceControl(id: string, next: Control): boolean {
    let done = false;
    const ok = this.mapActive((p) => {
      const controls = p.controls.map((c) => {
        if (c.id !== id) return c;
        done = true;
        return { ...next, id };
      });
      return { ...p, controls };
    });
    return ok && done;
  }

  removeControl(id: string): boolean {
    let done = false;
    const ok = this.mapActive((p) => {
      if (!p.controls.some((c) => c.id === id)) return p;
      done = true;
      return { ...p, controls: p.controls.filter((c) => c.id !== id) };
    });
    return ok && done;
  }

  /** جابه‌جایی کنترل با کنترل همسایه (direction: -1 بالا، +1 پایین) */
  moveControl(id: string, dir: -1 | 1): boolean {
    let done = false;
    const ok = this.mapActive((p) => {
      const i = p.controls.findIndex((c) => c.id === id);
      if (i < 0) return p;
      const j = i + dir;
      if (j < 0 || j >= p.controls.length) return p;
      const controls = [...p.controls];
      const a = controls[i]!;
      controls[i] = controls[j]!;
      controls[j] = a;
      done = true;
      return { ...p, controls };
    });
    return ok && done;
  }

  /* ------------------------------------------------ اتصال */

  setTransport(patch: Partial<TransportConfig>): void {
    this.set({ ...this.state, transport: { ...this.state.transport, ...patch } });
  }

  /* ------------------------------------------------ داده */

  importJson(json: string): ImportResult {
    const res = parseImport(json);
    if (!res.ok) return res;
    this.set(res.state);
    return { ok: true };
  }

  exportJson(): string {
    return JSON.stringify(this.state, null, 2);
  }

  /** بازنشانی کامل — داده‌ی فعلی از بین می‌رود */
  resetDefaults(): AppState {
    const fresh = normalizeState(defaultState()) ?? defaultState();
    this.set(fresh);
    return fresh;
  }

  wipe(): void {
    clearState();
    this.set(defaultState());
  }
}

/* ------------------------------------------------ سینگلتون */

let singleton: Store | null = null;

export function getStore(): Store {
  if (!singleton) singleton = new Store();
  return singleton;
}

/** فقط برای تست — نمونه‌ی جدا می‌سازد */
export function createStore(initial?: AppState): Store {
  return new Store(initial);
}
