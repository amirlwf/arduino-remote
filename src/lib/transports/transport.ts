/** قرارداد مشترک همه‌ی لایه‌های انتقال (Transport) */
import { Emitter } from "../events.ts";
import type { TransportKind } from "../types.ts";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface TransportEvents {
  status: (status: ConnectionStatus, detail: string) => void;
  data: (text: string) => void;
}

export abstract class Transport extends Emitter<TransportEvents> {
  abstract readonly kind: TransportKind;
  status: ConnectionStatus = "disconnected";

  /** نام نمایشی برای نوار وضعیت */
  abstract get label(): string;

  protected setStatus(status: ConnectionStatus, detail = ""): void {
    if (this.status === status && detail === "") return;
    this.status = status;
    this.emit("status", status, detail);
  }

  protected ensureConnected(): void {
    if (this.status !== "connected") throw new Error("اتصال برقرار نیست");
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(payload: string): Promise<void>;

  get connected(): boolean {
    return this.status === "connected";
  }
}
