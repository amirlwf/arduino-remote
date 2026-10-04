/**
 * انتقال بلوتوث کلاسیک (HC-05 / HC-06) از طریق پل Cordova.
 *
 * واقعیت مهم: مرورگرها بلوتوث کلاسیک (SPP) را در اختیار صفحه‌وب نمی‌گذارند؛
 * این مسیر فقط داخل وب‌ویوی اپ اندرویدی (که با این پروژه ساخته می‌شود) کار می‌کند.
 * پس این فایل هم لایه‌ی اصلی محصول است، هم تست «نبودن پل» در node دارد.
 */
import { logAppend } from "../log.ts";
import { toast } from "../toast.ts";
import { Transport, type TransportEvents } from "./transport.ts";

export interface BtDevice {
  id: string;
  name: string;
}

interface BluetoothSerialBridge {
  connect(deviceId: string, success: () => void, failure: (err: unknown) => void): void;
  disconnect(success?: () => void, failure?: (err: unknown) => void): void;
  write(data: string, success: () => void, failure: (err: unknown) => void): void;
  subscribe(delimiter: string, success: (data: string) => void, failure: (err: unknown) => void): void;
  unsubscribe(success?: () => void, failure?: (err: unknown) => void): void;
  isConnected(success: () => void, failure: (err: unknown) => void): void;
  list(success: (devices: Array<Record<string, unknown>>) => void, failure: (err: unknown) => void): void;
  discoverUnpaired(success: (devices: Array<Record<string, unknown>>) => void, failure: (err: unknown) => void): void;
  /** افزوده‌ی پچ این پروژه: جفت‌سازی با createBond (پنجره‌ی PIN سیستم) */
  pair?(device: string, success: (result: string) => void, failure: (err: unknown) => void): void;
  /** اتصال RFCOMM ناامن — پشتیبان برای دستگاه‌های جفت‌نشده مثل HC-05 */
  connectInsecure?(device: string, success: () => void, failure: (err: unknown) => void): void;
  showBluetoothSettings?(success: () => void, failure: (err: unknown) => void): void;
}

export function getBridge(): BluetoothSerialBridge | undefined {
  return (globalThis as { bluetoothSerial?: BluetoothSerialBridge }).bluetoothSerial;
}

export function btAvailable(): boolean {
  return getBridge() !== undefined;
}

/**
 * خطای مجوز را از پیام خام انگلیسی پلاگین تشخیص می‌دهد و به فارسیِ قابل‌اقدام تبدیل می‌کند.
 * پیام خام در کنسول می‌ماند تا عیب‌یابی از دست نرود.
 */
function friendlyBtError(err: unknown, fallback: string): string {
  const raw = errText(err, fallback);
  // دلیل خام را در تب کنسول ثبت کن تا گزارش بعدی بدون حدس باشد
  if (raw !== fallback) logAppend("err", "بلوتوث: " + raw);
  if (/permission|SecurityException|denied|not granted/i.test(raw)) {
    console.warn("[bt] permission error:", raw);
    return (
      "دسترسی بلوتوث داده نشده — از تنظیمات گوشی «برنامه‌ها → Arduino Remote → مجوزها» " +
      "«دستگاه‌های اطراف» (اندروید ۱۲+) یا «موقعیت مکانی» (اندروید قدیمی‌تر) را فعال کنید و دوباره تلاش کنید"
    );
  }
  if (/unable to connect|connection attempt|connect-failed/i.test(raw)) {
    console.warn("[bt] connect error:", raw);
    return (
      "اتصال برقرار نشد — چک کنید: ۱) جفت (pair) شده باشد ۲) به اپ یا کامپیوتر دیگری وصل نباشد " +
      "(LED ثابت = الان وصل است؛ چشمک تند = آماده و درست) ۳) چشمک دوتایی = حالت AT؛ دکمه EN/POW را رها کنید " +
      "۴) بعد از قطع اتصال دستگاه دیگر ۲ ثانیه صبر و دوباره بزنید — جزئیات خام در تب کنسول (✕)"
    );
  }
  if (/pairing-cancelled/i.test(raw)) return "جفت‌سازی لغو شد — رمز پیش‌فرض معمول HC-05 عدد 1234 است";
  if (/pair-timeout/i.test(raw)) return "جفت‌سازی بیش از حد طول کشید — ماژول را روشن و نزدیک گوشی نگه دارید و دوباره تلاش کنید";
  if (/createBond-rejected|pair-error/i.test(raw)) {
    console.warn("[bt] pair error:", raw);
    return "جفت‌سازی از داخل اپ ممکن نشد — از «تنظیمات بلوتوث گوشی» دستگاه را جفت کنید (رمز 1234) و بعد از فهرست «جفت‌شده‌ها» وصل شوید";
  }
  return raw;
}

function errText(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim() !== "") return err;
  if (err instanceof Error && err.message !== "") return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m !== "") return m;
  }
  return fallback;
}

function toDevices(raw: Array<Record<string, unknown>>): BtDevice[] {
  return raw.map((d) => {
    const address = typeof d.address === "string" ? d.address : typeof d.id === "string" ? d.id : "";
    const name = typeof d.name === "string" && d.name !== "" ? d.name : "بدون نام";
    return { id: address, name };
  });
}

/** دستگاه‌های جفت‌شده */
export function btList(): Promise<BtDevice[]> {
  const b = getBridge();
  if (!b) return Promise.reject(new Error("پل بلوتوث در دسترس نیست (فقط در APK اندروید)"));
  return new Promise((resolve, reject) => {
    b.list(
      (devices) => resolve(toDevices(devices)),
      (err) => reject(new Error(friendlyBtError(err, "خواندن فهرست دستگاه‌ها ناموفق بود")))
    );
  });
}

/** جستجوی دستگاه‌های جفت‌نشده (نیازمند مجوزهای بلوتوث اندروید ۱۲+) */
export function btDiscover(): Promise<BtDevice[]> {
  const b = getBridge();
  if (!b) return Promise.reject(new Error("پل بلوتوث در دسترس نیست (فقط در APK اندروید)"));
  return new Promise((resolve, reject) => {
    b.discoverUnpaired(
      (devices) => resolve(toDevices(devices)),
      (err) => reject(new Error(friendlyBtError(err, "جستجو ناموفق بود — بلوتوث را روشن کنید")))
    );
  });
}

/** جفت‌سازی (createBond) — پنجره‌ی PIN سیستم را باز می‌کند؛ رمز پیش‌فرض HC-05: 1234 */
export function btPair(address: string): Promise<void> {
  const b = getBridge();
  if (!b) return Promise.reject(new Error("پل بلوتوث در دسترس نیست (فقط در APK اندروید)"));
  if (typeof b.pair !== "function") {
    return Promise.reject(new Error("این نسخه از پلاگین جفت‌سازی ندارد — از تنظیمات بلوتوث گوشی جفت کنید (رمز 1234)"));
  }
  return new Promise((resolve, reject) => {
    b.pair!(
      address.trim(),
      () => resolve(),
      (err) => reject(new Error(errText(err, "pair-error")))
    );
  });
}

/** باز کردن صفحه‌ی تنظیمات بلوتوث سیستم (برای جفت‌سازی دستی) */
export function openBtSettings(): void {
  const b = getBridge();
  if (!b || typeof b.showBluetoothSettings !== "function") return;
  try {
    b.showBluetoothSettings!(() => undefined, () => undefined);
  } catch {
    /* پل در دسترس نیست */
  }
}

/** یک تلاش اتصال (امن یا ناامن) */
function connectAttempt(b: BluetoothSerialBridge, addr: string, secure: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (err: unknown) => reject(new Error(errText(err, "connect-failed")));
    if (secure) {
      b.connect(addr, () => resolve(), fail);
    } else if (typeof b.connectInsecure === "function") {
      b.connectInsecure(addr, () => resolve(), fail);
    } else {
      fail("connectInsecure-n/a");
    }
  });
}

/**
 * اتصال با جفت‌سازی خودکار:
 * ۱) اگر دستگاه در فهرست جفت‌شده‌ها نیست، اول pair می‌زنیم (پنجره‌ی PIN سیستم).
 * ۲) اتصال امن؛ اگر شکست خورد تلاش ناامن (SPP بدون باندینگ — رایج برای HC-05).
 * خطاها با friendlyBtError فارسی و قابل‌اقدام می‌شوند.
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isResetError(e: Error): boolean {
  return /read failed|Connection reset|socket closed|Broken pipe/i.test(e.message);
}

/** چند دور تلاش امن/ناامن با فاصله‌ی ۲ ثانیه — پنجره‌ی ریست ماژول را رد می‌کند */
async function tryRounds(
  b: BluetoothSerialBridge,
  addr: string,
  rounds: number
): Promise<{ ok: boolean; lastErr: Error }> {
  let lastErr: Error = new Error("connect-failed");
  for (let i = 1; i <= rounds; i++) {
    if (i > 1) {
      logAppend("sys", `تلاش اتصال ${i}/${rounds} بعد از ۲ ثانیه…`);
      await sleep(2000);
    }
    try {
      await connectAttempt(b, addr, true);
      return { ok: true, lastErr };
    } catch (e) {
      lastErr = e as Error;
    }
    try {
      await connectAttempt(b, addr, false);
      return { ok: true, lastErr };
    } catch (e) {
      lastErr = e as Error;
    }
    if (!isResetError(lastErr)) {
      break; // خطای دیگر (مثلاً اشغال بودن) تکرارش بی‌فایده است
    }
  }
  return { ok: false, lastErr };
}

export async function btConnect(address: string): Promise<void> {
  const b = getBridge();
  if (!b) throw new Error("پل بلوتوث در دسترس نیست (فقط در APK اندروید)");
  const addr = address.trim();
  if (addr === "") {
    throw new Error("آدرس دستگاه بلوتوث خالی است — از بخش تنظیمات انتخاب کنید");
  }

  try {
    const bonded = await btList();
    if (!bonded.some((d) => d.id.toUpperCase() === addr.toUpperCase())) {
      await btPair(addr);
    }
  } catch (e) {
    throw new Error(friendlyBtError(e, "دستگاه جفت نشد — از تنظیمات بلوتوث گوشی جفت کنید (رمز 1234) و دوباره تلاش کنید"));
  }

  // نشست اولیه: ماژول بعد از جفت/تلاش چند ثانیه ریست می‌شود (LED خاموش می‌شود) —
  // وصل کردن داخل این پنجره دقیقاً java.io.IOException: read failed می‌دهد
  await sleep(1200);

  // چند دور تلاش با فاصله تا پنجره‌ی خاموشی LED رد شود
  let res = await tryRounds(b, addr, 3);

  // اگر هنوز read failed بود → جفت کهنه را بازسازی کن و دو دور دیگر بزن
  if (!res.ok && isResetError(res.lastErr)) {
    logAppend("sys", "خطای read failed — بازسازی جفت‌سازی (پاک‌کردن کلید کهنه)…");
    toast("کلید جفت کهنه پاک شد — دوباره ۱۲۳۴ را بزن تا جفت تازه ساخته شود", "err");
    try {
      await btPair(addr);
      await sleep(2000);
      res = await tryRounds(b, addr, 2);
    } catch (e2) {
      res = { ok: false, lastErr: e2 as Error };
    }
  }

  if (!res.ok) {
    throw new Error(friendlyBtError(res.lastErr, "اتصال بلوتوث ناموفق بود"));
  }
}

export function btDisconnect(): Promise<void> {
  const b = getBridge();
  if (!b) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      b.disconnect(
        () => resolve(),
        () => resolve()
      );
    } catch {
      resolve();
    }
  });
}

export function btWrite(data: string): Promise<void> {
  const b = getBridge();
  if (!b) return Promise.reject(new Error("پل بلوتوث در دسترس نیست"));
  return new Promise((resolve, reject) => {
    b.write(
      data,
      () => resolve(),
      (err) => reject(new Error(friendlyBtError(err, "ارسال به بلوتوث ناموفق بود")))
    );
  });
}

/** پیام‌های رسیده از دستگاه — با جداکننده‌ی \n از پل گرفته می‌شود */
export function btSubscribe(onData: (text: string) => void): void {
  const b = getBridge();
  if (!b) return;
  try {
    b.subscribe(
      "\n",
      (data) => {
        if (typeof data === "string" && data !== "") onData(data);
      },
      () => {
        /* اشتراک قطع شد */
      }
    );
  } catch {
    /* پل آماده نیست */
  }
}

export function btUnsubscribe(): void {
  const b = getBridge();
  if (!b) return;
  try {
    b.unsubscribe();
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------- Transport */

export class BluetoothTransport extends Transport {
  readonly kind = "bluetooth" as const;
  private readonly address: string;

  constructor(address: string) {
    super();
    this.address = address.trim();
  }

  get label(): string {
    return this.address !== "" ? `بلوتوث ${this.address}` : "بلوتوث کلاسیک (HC-05)";
  }

  async connect(): Promise<void> {
    if (!btAvailable()) {
      throw new Error(
        "پل بلوتوث کلاسیک پیدا نشد — این مسیر فقط داخل نسخه‌ی اندروید (APK) کار می‌کند؛ " +
          "فعلاً «شبیه‌ساز» یا «وب‌سوکت» را انتخاب کنید"
      );
    }
    this.setStatus("connecting", this.label);
    try {
      await btConnect(this.address);
    } catch (e) {
      this.setStatus("error", e instanceof Error ? e.message : String(e));
      throw e;
    }
    btSubscribe((text) => this.emit("data", text));
    this.setStatus("connected", this.label);
  }

  async disconnect(): Promise<void> {
    btUnsubscribe();
    await btDisconnect();
    this.setStatus("disconnected", "قطع شد");
  }

  async send(payload: string): Promise<void> {
    this.ensureConnected();
    await btWrite(payload);
  }
}

// type-only re-export used by the manager
export type { TransportEvents };
