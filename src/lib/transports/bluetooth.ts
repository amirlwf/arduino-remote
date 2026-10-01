/**
 * انتقال بلوتوث کلاسیک (HC-05 / HC-06) از طریق پل Cordova.
 *
 * واقعیت مهم: مرورگرها بلوتوث کلاسیک (SPP) را در اختیار صفحه‌وب نمی‌گذارند؛
 * این مسیر فقط داخل وب‌ویوی اپ اندرویدی (که با این پروژه ساخته می‌شود) کار می‌کند.
 * پس این فایل هم لایه‌ی اصلی محصول است، هم تست «نبودن پل» در node دارد.
 */
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
}

export function getBridge(): BluetoothSerialBridge | undefined {
  return (globalThis as { bluetoothSerial?: BluetoothSerialBridge }).bluetoothSerial;
}

export function btAvailable(): boolean {
  return getBridge() !== undefined;
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
      (err) => reject(new Error(errText(err, "خواندن فهرست دستگاه‌ها ناموفق بود")))
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
      (err) => reject(new Error(errText(err, "جستجو ناموفق بود — مجوزهای بلوتوث را بدهید")))
    );
  });
}

export function btConnect(address: string): Promise<void> {
  const b = getBridge();
  if (!b) return Promise.reject(new Error("پل بلوتوث در دسترس نیست (فقط در APK اندروید)"));
  if (address.trim() === "") {
    return Promise.reject(new Error("آدرس دستگاه بلوتوث خالی است — از بخش تنظیمات انتخاب کنید"));
  }
  return new Promise((resolve, reject) => {
    b.connect(
      address.trim(),
      () => resolve(),
      (err) => reject(new Error(errText(err, "اتصال بلوتوث ناموفق بود")))
    );
  });
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
      (err) => reject(new Error(errText(err, "ارسال به بلوتوث ناموفق بود")))
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
