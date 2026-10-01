/**
 * انتقال Web Serial (پورت USB) — برای تست رومیزی با کروم/اِج دسکتاپ.
 * هیچ‌وقت در اندروید کار نمی‌کند؛ خطای روشن می‌دهد.
 */
import { Transport } from "./transport.ts";

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

function getSerial(): SerialLike | undefined {
  return (navigator as unknown as { serial?: SerialLike }).serial;
}

export class WebSerialTransport extends Transport {
  readonly kind = "webserial" as const;
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readonly baudRate: number;

  constructor(baudRate = 9600) {
    super();
    this.baudRate = baudRate;
  }

  get label(): string {
    return `سریال USB (${this.baudRate} baud)`;
  }

  async connect(): Promise<void> {
    const serial = getSerial();
    if (!serial) {
      throw new Error("Web Serial فقط در کروم/اِج رومیزی پشتیبانی می‌شود — در اینجا در دسترس نیست");
    }
    this.setStatus("connecting");
    // requestPort نیازمند کلیک کاربر است — connect همیشه از دکمه صدا زده می‌شود
    const port = await serial.requestPort();
    await port.open({ baudRate: this.baudRate });
    this.port = port;
    this.setStatus("connected", `پورت باز شد (${this.baudRate} baud)`);
    void this.readLoop(port);
  }

  private async readLoop(port: SerialPortLike): Promise<void> {
    const readable = port.readable;
    if (!readable) return;
    const reader = readable.getReader();
    this.reader = reader;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) this.emit("data", decoder.decode(value, { stream: true }));
      }
    } catch {
      /* پورت بسته شد */
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
      if (this.reader === reader) this.reader = null;
      if (this.port === port) {
        this.port = null;
        if (this.status === "connected") this.setStatus("disconnected", "پورت بسته شد");
      }
    }
  }

  async disconnect(): Promise<void> {
    const reader = this.reader;
    this.reader = null;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    const port = this.port;
    this.port = null;
    if (port) {
      try {
        await port.close();
      } catch {
        /* ignore */
      }
    }
    this.setStatus("disconnected", "قطع شد");
  }

  async send(payload: string): Promise<void> {
    this.ensureConnected();
    const writable = this.port?.writable;
    if (!writable) throw new Error("پورت سریال برای نوشتن باز نیست");
    const writer = writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(payload));
    } finally {
      writer.releaseLock();
    }
  }
}
