/**
 * اکشن‌های سطح بالای «فرستادن» — ترکیب کنترل + اتصال + کنسول + اعلان.
 * لایه‌ی UI فقط این‌ها را صدا می‌زند.
 */
import { buildPayloads, type ControlEvent } from "./commands.ts";
import { getManager } from "./connection.ts";
import { logAppend } from "./log.ts";
import type { Control } from "./types.ts";

export interface RunResult {
  ok: boolean;
  sent: number;
  error?: string;
}

/** ارسال دستورهای یک کنترل؛ خطاها در کنسول ثبت و پیام قابل نمایش برمی‌گردد */
export async function runControl(ctrl: Control, ev: ControlEvent): Promise<RunResult> {
  const payloads = buildPayloads(ctrl, ev);
  if (payloads.length === 0) return { ok: true, sent: 0 };
  return sendAll(payloads);
}

/** ارسال خام از کنسول (بدون کنترل) */
export async function sendRaw(text: string): Promise<RunResult> {
  if (text === "") return { ok: true, sent: 0 };
  return sendAll([text]);
}

async function sendAll(payloads: string[]): Promise<RunResult> {
  const mgr = getManager();
  let sent = 0;
  for (const p of payloads) {
    try {
      await mgr.send(p);
      logAppend("tx", p);
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logAppend("err", `ارسال ناموفق ${JSON.stringify(p)} — ${msg}`);
      return { ok: false, sent, error: msg };
    }
  }
  return { ok: true, sent };
}
