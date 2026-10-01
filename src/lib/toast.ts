/** ریز اعلان‌ها (Toast) — اتوبوس رویداد تا بدون prop drilling استفاده شوند */
import { Emitter } from "./events.ts";

export type ToastKind = "ok" | "err" | "";

interface ToastEvents {
  add: (msg: string, kind: ToastKind) => void;
}

class ToastBus extends Emitter<ToastEvents> {
  show(msg: string, kind: ToastKind = ""): void {
    this.emit("add", msg, kind);
  }
}

export const toastBus = new ToastBus();

export function toast(msg: string, kind: ToastKind = ""): void {
  toastBus.show(msg, kind);
}
