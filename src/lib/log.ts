/** کنسول رویداد — فقط در حافظه؛ با useSyncExternalStore خوانده می‌شود */

export type LogDir = "tx" | "rx" | "sys" | "err";

export interface LogEntry {
  id: number;
  dir: LogDir;
  text: string;
  ts: number;
}

const MAX = 300;

let entries: LogEntry[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of [...listeners]) l();
}

export function logAppend(dir: LogDir, text: string): void {
  const entry: LogEntry = { id: seq++, dir, text, ts: Date.now() };
  let next = [...entries, entry];
  if (next.length > MAX) next = next.slice(next.length - MAX);
  entries = next;
  notify();
}

export const getLogs = (): readonly LogEntry[] => entries;

export const subscribeLogs = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function clearLogs(): void {
  entries = [];
  notify();
}

export function timeLabel(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
