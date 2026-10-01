/**
 * مدیریت‌کننده‌ی اتصال: ساخت Transport از تنظیمات، سیم‌کشی رویدادها،
 * ارسال امن. یک نمونه‌ی سینگلتون برای کل اپ.
 */
import { Emitter } from "./events.ts";
import { getStore } from "./store.ts";
import type { TransportConfig, TransportKind } from "./types.ts";
import { TRANSPORT_LABELS } from "./types.ts";
import { BluetoothTransport } from "./transports/bluetooth.ts";
import { DemoTransport } from "./transports/demo.ts";
import { Transport, type ConnectionStatus } from "./transports/transport.ts";
import { WebSocketTransport } from "./transports/websocket.ts";
import { WebSerialTransport } from "./transports/webserial.ts";

export function createTransport(cfg: TransportConfig): Transport {
  switch (cfg.kind) {
    case "demo":
      return new DemoTransport();
    case "bluetooth":
      return new BluetoothTransport(cfg.btAddress);
    case "webserial":
      return new WebSerialTransport(9600);
    case "websocket":
      return new WebSocketTransport(cfg.wsUrl);
    default: {
      const never: never = cfg.kind;
      throw new Error(`نوع انتقال ناشناخته: ${String(never)}`);
    }
  }
}

interface ManagerEvents {
  status: (status: ConnectionStatus, detail: string) => void;
  data: (text: string) => void;
}

export class ConnectionManager extends Emitter<ManagerEvents> {
  private transport: Transport | null = null;
  private offs: Array<() => void> = [];
  private readonly getConfig: () => TransportConfig;

  constructor(getConfig: () => TransportConfig) {
    super();
    this.getConfig = getConfig;
  }

  get status(): ConnectionStatus {
    return this.transport?.status ?? "disconnected";
  }

  get label(): string {
    if (this.transport) return this.transport.label;
    return TRANSPORT_LABELS[this.getConfig().kind];
  }

  get kind(): TransportKind {
    return this.getConfig().kind;
  }

  /** قطع اتصال قبلی و برقراری اتصال تازه با تنظیمات فعلی */
  async connect(): Promise<void> {
    await this.teardown(false);
    const cfg = this.getConfig();
    const transport = createTransport(cfg);
    this.transport = transport;
    this.offs = [
      transport.on("status", (s, d) => this.emit("status", s, d)),
      transport.on("data", (t) => this.emit("data", t)),
    ];
    try {
      await transport.connect();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // فقط اگر هنوز همین transport سر جایش است خطا را گزارش کن (لغویِ کاربر نباید خطا شود)
      if (this.transport === transport) {
        await this.teardown(false);
        this.emit("status", "error", msg);
      }
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  async disconnect(): Promise<void> {
    await this.teardown(false);
    this.emit("status", "disconnected", "قطع شد");
  }

  private async teardown(emitDisconnected: boolean): Promise<void> {
    for (const off of this.offs) off();
    this.offs = [];
    const t = this.transport;
    this.transport = null;
    if (t) {
      try {
        await t.disconnect();
      } catch {
        /* قطع باید همیشه ممکن باشد */
      }
    }
    if (emitDisconnected) this.emit("status", "disconnected", "قطع شد");
  }

  async send(payload: string): Promise<void> {
    if (!this.transport || this.transport.status !== "connected") {
      throw new Error("اتصال برقرار نیست — اول از نوار بالا وصل شوید");
    }
    await this.transport.send(payload);
  }
}

/* ------------------------------------------------------- سینگلتون + اکشن‌ها */

let singleton: ConnectionManager | null = null;

export function getManager(): ConnectionManager {
  if (!singleton) singleton = new ConnectionManager(() => getStore().snapshot().transport);
  return singleton;
}

/** برای تست — مدیر جدا با تنظیمات دلخواه */
export function createManager(cfg: () => TransportConfig): ConnectionManager {
  return new ConnectionManager(cfg);
}
