/**
 * ترجمه‌ی رویدادهای UI به دستورهای متنی که به دستگاه فرستاده می‌شوند.
 * خالص و بدون DOM تا با node تست شود.
 */
import type { Control, SliderControl } from "./types.ts";

export type ControlEvent =
  | { kind: "toggle"; on: boolean }
  | { kind: "press" }
  | { kind: "release" }
  | { kind: "slider"; value: number }
  | { kind: "send"; text: string };

/** تبدیل مقدار نمایشی لغزنده به بازه‌ی خروجی (خطی، گردشده، محدودشده) */
export function mapSlider(ctrl: SliderControl, value: number): number {
  const { min, max, outMin, outMax } = ctrl;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const clamped = Math.min(Math.max(value, lo), hi);
  const span = max - min;
  const ratio = span === 0 ? 0 : (clamped - min) / span;
  const mapped = outMin + ratio * (outMax - outMin);
  const rounded = Math.round(mapped);
  // داخل بازه‌ی خروجی نگه دار (با احتساب جهت معکوس)
  return Math.min(Math.max(rounded, Math.min(outMin, outMax)), Math.max(outMin, outMax));
}

/** ساخت آرایه‌ی دستورهای خروجی برای یک رویداد؛ آرایه‌ی خالی = ارسالی در کار نیست */
export function buildPayloads(ctrl: Control, ev: ControlEvent): string[] {
  const pack = (base: string): string[] => {
    const full = base + ctrl.suffix;
    return full === "" ? [] : [full];
  };

  switch (ctrl.type) {
    case "toggle": {
      if (ev.kind !== "toggle") return [];
      return pack(ev.on ? ctrl.onPayload : ctrl.offPayload);
    }
    case "momentary": {
      if (ev.kind === "press") return pack(ctrl.pressPayload);
      if (ev.kind === "release") return pack(ctrl.releasePayload);
      return [];
    }
    case "slider": {
      if (ev.kind !== "slider") return [];
      const v = mapSlider(ctrl, ev.value);
      return pack(ctrl.template.replace(/\{v\}/g, String(v)));
    }
    case "text": {
      if (ev.kind !== "send") return [];
      return pack(ev.text.trim());
    }
  }
}

/** بررسی سلامت الگوی لغزنده — پیش از ذخیره در مودال صدا زده می‌شود */
export function sliderTemplateError(template: string): string | null {
  if (!template.includes("{v}")) return "الگو باید شامل {v} باشد — مثلاً V{v}";
  if (template.trim() === "") return "الگو خالی است";
  return null;
}
