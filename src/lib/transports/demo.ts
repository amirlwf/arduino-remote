/**
 * لایه‌ی «اتصال» روی مرورگر و اندروید: هیچ بلوتوثی در کار نیست، همه‌چیز شبیه‌سازی
 * می‌شود. برای آموزش، تست UI و عیب‌یابی بدون سخت‌افزار.
 */
import { Transport } from "./transport.ts";

export class DemoTransport extends Transport {
  readonly kind = "demo" as const;

  /** اگر روشن باشد هر دستور ارسال‌شده به‌صورت پیام دریافتی برمی‌گردد */
  echo: boolean;

  constructor(echo = true) {
    super();
    this.echo = echo;
  }

  get label(): string {
    return "شبیه‌ساز (بدون سخت‌افزار)";
  }

  async connect(): Promise<void> {
    this.setStatus("connecting");
    await new Promise<void>((r) => setTimeout(r, 120));
    this.setStatus("connected", "شبیه‌ساز آماده است — دستگاه مجازی پاسخ می‌دهد");
  }

  async disconnect(): Promise<void> {
    this.setStatus("disconnected", "قطع شد");
  }

  async send(payload: string): Promise<void> {
    this.ensureConnected();
    if (this.echo) {
      setTimeout(() => this.emit("data", payload), 35);
    }
  }
}
