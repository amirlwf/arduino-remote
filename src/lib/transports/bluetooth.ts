/**
 * انتقال بلوتوث کلاسیک (HC-05 / HC-06) — روی پل نیتیو جاوای اختصاصی این پروژه
 * (BtSerialPlugin — android/app/.../BtSerialPlugin.java).
 *
 * الگوی اتصال از kai-morich/SimpleBluetoothTerminal (اپی که روی HC-05 واقعاً جواب می‌دهد):
 *   سوکت مستقیم: اول SPP UUID، در خطا fallback به کانال‌های ۱..۳ (بدون رمزنگاری) —
 *   همه در سمت جاوا؛ اینجا فقط نردبان تلاش، watchdog و پیام‌های فارسی.
 *
 * واقعیت مهم: مرورگرها بلوتوث کلاسیک (SPP) را در اختیار صفحه‌وب نمی‌گذارند؛
 * این مسیر فقط داخل وب‌ویوی اپ اندرویدی کار می‌کند.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { logAppend } from "../log.ts";
import { toast } from "../toast.ts";
import { Transport, type TransportEvents } from "./transport.ts";

export interface BtDevice {
  id: string;
  name: string;
}

interface BtDeviceEvent {
  id?: string;
  address?: string;
  name?: string;
}

interface BtSerialPlugin {
  list(): Promise<{ devices: BtDeviceEvent[] }>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  pair(options: { address: string }): Promise<void>;
  unpair(options: { address: string }): Promise<void>;
  connect(options: { address: string }): Promise<void>;
  write(options: { data: string }): Promise<void>;
  disconnect(): Promise<void>;
  openSettings(): Promise<void>;
  addListener(
    eventName: "data",
    cb: (e: { text: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "connectionLost",
    cb: (e: { message: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(eventName: "deviceFound", cb: (e: BtDeviceEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "discoveryFinished", cb: () => void): Promise<PluginListenerHandle>;
}

const webOnlyError = (): never => {
  throw new Error("پل بلوتوث کلاسیک فقط داخل APK اندروید کار می‌کند");
};

const BtSerialNative = registerPlugin<BtSerialPlugin>("BtSerial", {
  web: {
    list: async () => webOnlyError(),
    startDiscovery: async () => webOnlyError(),
    stopDiscovery: async () => webOnlyError(),
    pair: async () => webOnlyError(),
    unpair: async () => webOnlyError(),
    connect: async () => webOnlyError(),
    write: async () => webOnlyError(),
    disconnect: async () => webOnlyError(),
    openSettings: async () => webOnlyError(),
    addListener: async () => webOnlyError(),
  },
});

/** پل فعال — در تست‌ها با setBtSerialForTests جایگزین می‌شود */
let bt: BtSerialPlugin = BtSerialNative;
let testImplActive = false;

/** فقط برای تست — پل ساختگی بگذار / برگردان */
export function setBtSerialForTests(impl: BtSerialPlugin | null): void {
  bt = impl ?? BtSerialNative;
  testImplActive = impl !== null;
}

export function btAvailable(): boolean {
  return testImplActive || Capacitor.isNativePlatform();
}

/**
 * خطای مجوز را از پیام خام پلاگین تشخیص می‌دهد و به فارسیِ قابل‌اقدام تبدیل می‌کند.
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
  if (/unable to connect|connect-failed|invalid bluetooth mac/i.test(raw)) {
    console.warn("[bt] connect error:", raw);
    return (
      "اتصال برقرار نشد — چک کنید: ۱) جفت (pair) شده باشد ۲) به اپ یا کامپیوتر دیگری وصل نباشد " +
      "(LED ثابت = الان وصل است؛ چشمک تند = آماده و درست) ۳) چشمک دوتایی = حالت AT؛ دکمه EN/POW را رها کنید " +
      "۴) بعد از قطع اتصال دستگاه دیگر ۲ ثانیه صبر و دوباره بزنید — جزئیات خام در تب کنسول (✕)"
    );
  }
  if (/not connected/i.test(raw)) {
    return "اتصال برقرار نیست — ماژول خاموش شده یا از رنج خارج شده؛ دوباره وصل شو (جزئیات در تب کنسول)";
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

function toDevices(events: BtDeviceEvent[]): BtDevice[] {
  return events.map((d) => {
    const address = typeof d.address === "string" ? d.address : typeof d.id === "string" ? d.id : "";
    const name = typeof d.name === "string" && d.name !== "" ? d.name : "بدون نام";
    return { id: address, name };
  });
}

/** دستگاه‌های جفت‌شده */
export async function btList(): Promise<BtDevice[]> {
  try {
    const res = await bt.list();
    return toDevices(res?.devices ?? []);
  } catch (e) {
    throw new Error(friendlyBtError(e, "خواندن فهرست دستگاه‌ها ناموفق بود"));
  }
}

/**
 * جستجوی دستگاه‌های اطراف — با رویداد زنده‌ی deviceFound؛
 * Promise وقتی resolve می‌شود که discovery تمام شود (سقف ۲۰ ثانیه).
 */
export function btDiscover(): Promise<BtDevice[]> {
  return new Promise<BtDevice[]>((resolve, reject) => {
    const found = new Map<string, BtDevice>();
    let done = false;
    const subs: Array<Promise<PluginListenerHandle>> = [];
    const finish = (err?: unknown): void => {
      if (done) return;
      done = true;
      for (const s of subs) void s.then((h) => h.remove()).catch(() => undefined);
      clearTimeout(cap);
      if (err) reject(err);
      else resolve([...found.values()]);
    };
    const cap = setTimeout(() => finish(), 20_000);
    subs.push(
      bt.addListener("deviceFound", (e) => {
        const list = toDevices([e]);
        if (list[0]?.id) found.set(list[0].id, list[0]);
      })
    );
    subs.push(bt.addListener("discoveryFinished", () => finish()));
    bt.startDiscovery().catch((e) => finish(new Error(friendlyBtError(e, "جستجو ناموفق بود — بلوتوث را روشن کنید"))));
  });
}

/** جفت‌سازی (createBond) — پنجره‌ی PIN سیستم را باز می‌کند؛ رمز پیش‌فرض HC-05: 1234 */
export async function btPair(address: string): Promise<void> {
  try {
    await bt.pair({ address: address.trim() });
  } catch (e) {
    throw new Error(errText(e, "pair-error"));
  }
}

/** فقط حذف جفت (removeBond) — برای تلاش اتصال بدون رمزنگاری مثل اپ‌های استاندارد */
export async function btUnpair(address: string): Promise<void> {
  try {
    await bt.unpair({ address: address.trim() });
  } catch {
    /* چیزی برای حذف نبود — بی‌خیال */
  }
}

/** رویداد زنده‌ی «دستگاه پیدا شد» حین جستجو — خروجی: تابع لغو اشتراک */
export function btOnFound(onDevice: (d: BtDevice) => void): () => void {
  let handle: PluginListenerHandle | null = null;
  void bt
    .addListener("deviceFound", (e) => {
      const list = toDevices([e]);
      if (list[0]?.id) onDevice(list[0]);
    })
    .then((h) => {
      handle = h;
    })
    .catch(() => undefined);
  return () => {
    const h = handle;
    handle = null;
    if (h) void h.remove().catch(() => undefined);
  };
}

/** رویداد دائمی «اتصال قطع شد» از سمت ماژول — خروجی: تابع لغو اشتراک */
export function btOnConnectionLost(onLost: (message: string) => void): () => void {
  let handle: PluginListenerHandle | null = null;
  void bt
    .addListener("connectionLost", (e) => {
      if (typeof e?.message === "string" && e.message !== "") onLost(e.message);
    })
    .then((h) => {
      handle = h;
    })
    .catch(() => undefined);
  return () => {
    const h = handle;
    handle = null;
    if (h) void h.remove().catch(() => undefined);
  };
}

/** باز کردن صفحه‌ی تنظیمات بلوتوث سیستم (برای جفت‌سازی دستی) */
export function openBtSettings(): void {
  void bt.openSettings().catch(() => undefined);
}

/**
 * اتصال سه‌مرحله‌ای روی پل نیتیو (هر connect جاوایی خودش SPP + کانال‌ها را امتحان می‌کند):
 * ۱) چند دور اتصال مستقیم با فاصله — پنجره‌ی ریست ماژول را رد می‌کند
 * ۲) اگر read failed ماند: حذف جفت کهنه (unpair) و باز هم تلاش
 * ۳) آخرین راه: جفت‌سازی کامل (پنجره‌ی رمز ۱۲۳۴)
 * سقف زمانی کل: watchdog — اپ تا ابد «در حال اتصال» نمی‌ماند.
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isResetError(e: Error): boolean {
  return /read failed|Connection reset|socket closed|Broken pipe/i.test(e.message);
}

/** سقف زمانی کل فرایند اتصال — اتصال نیتیو timeout داخلی ندارد و می‌تواند تا ابد بماند */
export const BT_CONNECT_TIMEOUT_MS = 90_000;

export async function btConnect(address: string, timeoutMs: number = BT_CONNECT_TIMEOUT_MS): Promise<void> {
  if (!btAvailable()) {
    throw new Error("پل بلوتوث در دسترس نیست (فقط در APK اندروید)");
  }
  const addr = address.trim();
  if (addr === "") {
    throw new Error("آدرس دستگاه بلوتوث خالی است — از بخش تنظیمات انتخاب کنید");
  }
  // MAC نامعتبر در سمت جاوا IllegalArgumentException می‌دهد — اینجا زودتر با پیام درست می‌گیریم
  if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(addr)) {
    throw new Error("قالب آدرس MAC درست نیست — مثال: 98:D3:31:F7:43:6C (از فهرست دستگاه‌ها انتخاب کن)");
  }

  const start = Date.now();
  const elapsed = (): string => `${Math.round((Date.now() - start) / 1000)}ثانیه`;
  logAppend("sys", `اتصال به ${addr} شروع شد — پیشرفت مرحله‌به‌مرحله در همین کنسول (سقف ${Math.round(timeoutMs / 1000)}ثانیه)`);

  const timedOut = { v: false };
  const isCancelled = (): boolean => timedOut.v || Date.now() - start > timeoutMs;

  /** یک تلاش اتصال (خودش SPP + کانال‌ها را در جاوا امتحان می‌کند) */
  const attempt = async (): Promise<void> => {
    await bt.connect({ address: addr });
  };

  /** چند دور تلاش با فاصله‌ی ۲ ثانیه */
  const tryRounds = async (rounds: number): Promise<{ ok: boolean; lastErr: Error }> => {
    let lastErr: Error = new Error("connect-failed");
    for (let i = 1; i <= rounds; i++) {
      if (isCancelled()) return { ok: false, lastErr: new Error("connect-cancelled") };
      if (i > 1) await sleep(2000);
      logAppend("sys", `اتصال… دور ${i}/${rounds} (${elapsed()})`);
      try {
        await attempt();
        return { ok: true, lastErr };
      } catch (e) {
        lastErr = e as Error;
      }
      if (!isResetError(lastErr)) break; // خطای دیگر (مثلاً اشغال بودن) تکرارش بی‌فایده است
    }
    return { ok: false, lastErr };
  };

  const ladder = (async (): Promise<{ ok: boolean; lastErr: Error }> => {
    // نشست اولیه: ماژول بعد از هر تلاش چند ثانیه ریست/پردازش می‌شود (LED خاموش می‌شود) —
    // وصل کردن داخل این پنجره دقیقاً java.io.IOException: read failed می‌دهد
    await sleep(1000);

    let res = await tryRounds(3);

    // مرحله ۲: کلید احتمالی کهنه را حذف کن و باز هم تلاش کن (حالت اپ استاندارد)
    if (!res.ok && !isCancelled() && isResetError(res.lastErr)) {
      logAppend("sys", `حذف جفت کهنه و تلاش بدون رمزنگاری (حالت اپ‌های استاندارد)… (${elapsed()})`);
      await btUnpair(addr);
      await sleep(2000);
      res = await tryRounds(2);
    }

    // مرحله ۳ (آخرین راه): جفت‌سازی کامل با پنجره‌ی رمز
    if (!res.ok && !isCancelled() && isResetError(res.lastErr)) {
      logAppend("sys", `آخرین راه: جفت‌سازی کامل با رمز ۱۲۳۴… (${elapsed()})`);
      toast("آخرین راه: جفت‌سازی با رمز ۱۲۳۴ — لطفاً تأیید کن", "err");
      try {
        await btPair(addr);
        await sleep(2000);
        res = await tryRounds(2);
      } catch (e2) {
        res = { ok: false, lastErr: e2 as Error };
      }
    }
    return res;
  })();

  const winner = await Promise.race([
    ladder.then((res) => ({ done: true as const, res })),
    sleep(timeoutMs).then(() => ({ done: false as const })),
  ]);

  if (!winner.done) {
    timedOut.v = true;
    logAppend("err", `اتصال از سقف ${Math.round(timeoutMs / 1000)}ثانیه گذشت — قطع اجباری و لغو (${elapsed()})`);
    // سوکت نیتیو را ببند تا ترد connectِ گیرکرده آزاد شود
    await btDisconnect();
    throw new Error(
      "اتصال برقرار نشد (بیش از حد طول کشید) — چک کن: ۱) ماژول روشن و LED چشمک‌تند باشد " +
        "۲) اپ یا Serial Monitor دیگری اشغالش نکرده باشد (LED ثابت = اشغال) ۳) بلوتوث گوشی روشن باشد — بعد دوباره بزن"
    );
  }

  const res = winner.res;
  if (!res.ok) {
    if (res.lastErr.message === "connect-cancelled") return; // watchdog پیام خودش را داده
    throw new Error(friendlyBtError(res.lastErr, "اتصال بلوتوث ناموفق بود"));
  }
  logAppend("sys", `اتصال برقرار شد (${elapsed()})`);
}

export async function btDisconnect(): Promise<void> {
  try {
    await bt.disconnect();
  } catch {
    /* قطع باید همیشه ممکن باشد */
  }
}

export async function btWrite(data: string): Promise<void> {
  try {
    await bt.write({ data });
  } catch (e) {
    throw new Error(friendlyBtError(e, "ارسال به بلوتوث ناموفق بود"));
  }
}

/* ------------------------------------------------------------- Transport */

export class BluetoothTransport extends Transport {
  readonly kind = "bluetooth" as const;
  private readonly address: string;
  private offLost: (() => void) | null = null;
  private dataHandle: PluginListenerHandle | null = null;

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
    // پیام‌های رسیده از دستگاه — رویداد data از ترد خواندن جاوا
    void bt
      .addListener("data", (e) => {
        if (typeof e?.text === "string" && e.text !== "") this.emit("data", e.text);
      })
      .then((h) => {
        this.dataHandle = h;
      })
      .catch(() => undefined);
    // قطع‌شدن ناگهانی ماژول (خاموشی/خروج از رنج) → وضعیت اپ هم عوض شود
    this.offLost = btOnConnectionLost((message) => {
      if (this.status !== "connected") return;
      logAppend("err", "اتصال بلوتوث قطع شد: " + message);
      toast("اتصال دستگاه قطع شد — ماژول خاموش یا خارج از رنج است", "err");
      this.setStatus("error", "اتصال دستگاه قطع شد — دوباره وصل شو");
    });
    this.setStatus("connected", this.label);
  }

  async disconnect(): Promise<void> {
    this.offLost?.();
    this.offLost = null;
    const h = this.dataHandle;
    this.dataHandle = null;
    if (h) void h.remove().catch(() => undefined);
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
