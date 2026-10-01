/**
 * انتقال وب‌سوکت — پل به هر دستگاهی که سوکت باز کند (بریج رایانه/ESP/سرور).
 * در node هم کار می‌کند (WebSocket سراسری node ≥ 21) پس تست واقعی دارد.
 */
import { Transport } from "./transport.ts";

export class WebSocketTransport extends Transport {
  readonly kind = "websocket" as const;
  private ws: WebSocket | null = null;
  private readonly url: string;

  constructor(url: string) {
    super();
    this.url = url.trim();
  }

  get label(): string {
    return `وب‌سوکت ${this.url}`;
  }

  async connect(): Promise<void> {
    if (!/^wss?:\/\//i.test(this.url)) {
      throw new Error("آدرس باید با ws:// یا wss:// شروع شود");
    }
    if (this.ws) await this.disconnect();

    this.setStatus("connecting", this.url);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        this.setStatus("error", "زمان اتصال سوکت تمام شد");
        reject(new Error("زمان اتصال وب‌سوکت تمام شد (۸ ثانیه)"));
      }, 8000);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws = ws;
        this.setStatus("connected", this.url);
        resolve();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.setStatus("error", "خطای سوکت");
        reject(new Error("اتصال وب‌سوکت برقرار نشد"));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        const wasConnected = this.status === "connected";
        this.ws = null;
        if (wasConnected) this.setStatus("disconnected", "سوکت بسته شد");
        if (!settled) {
          settled = true;
          reject(new Error("سوکت پیش از آماده شدن بسته شد"));
        }
      };
      ws.onmessage = (ev: MessageEvent<unknown>) => {
        void this.readData(ev.data);
      };
    });
  }

  private async readData(data: unknown): Promise<void> {
    if (typeof data === "string") {
      this.emit("data", data);
      return;
    }
    if (data instanceof Blob) {
      this.emit("data", await data.text());
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.emit("data", new TextDecoder().decode(data));
    }
  }

  async disconnect(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* قبلاً بسته شده */
      }
    }
    this.setStatus("disconnected", "قطع شد");
  }

  async send(payload: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("اتصال وب‌سوکت برقرار نیست");
    }
    this.ws.send(payload);
  }
}
