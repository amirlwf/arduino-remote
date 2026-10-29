import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clearLogs, getLogs, subscribeLogs, timeLabel } from "../lib/log.ts";
import { sendRaw } from "../lib/runner.ts";
import { toast } from "../lib/toast.ts";

const MARK: Record<string, string> = { tx: "→", rx: "←", sys: "·", err: "✕" };
const DIR_NAME: Record<string, string> = { tx: "ارسال", rx: "دریافت", sys: "سیستم", err: "خطا" };

export function ConsoleView() {
  const logs = useSyncExternalStore(subscribeLogs, getLogs);
  const [raw, setRaw] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const doSend = async () => {
    const text = raw;
    if (text.trim() === "") return;
    const r = await sendRaw(text);
    if (r.ok) setRaw("");
    else if (r.error) toast(r.error, "err");
  };

  const copyAll = async () => {
    const text = logs
      .map((e) => `${timeLabel(e.ts)} [${DIR_NAME[e.dir] ?? e.dir}] ${e.text}`)
      .join("\n");
    if (text === "") {
      toast("لاگی برای کپی نیست", "err");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("کل لاگ در کلیپ‌بورد کپی شد", "ok");
    } catch {
      // WebView اندروید ممکن است Clipboard API را ندهد — راه دوم
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast("کل لاگ در کلیپ‌بورد کپی شد", "ok");
      } catch {
        toast("کپی خودکار نشد", "err");
      }
    }
  };

  return (
    <>
      <div className="sect-head">
        <div>
          <h2>کنسول</h2>
          <span className="sub" data-testid="log-count">
            {logs.length} پیام — TX ارسال / RX دریافت
          </span>
        </div>
        <div className="rowbtns">
          <button type="button" className="btn small" data-testid="log-copy" onClick={() => void copyAll()}>
            کپی
          </button>
          <button type="button" className="btn small" data-testid="log-clear" onClick={() => clearLogs()}>
            پاک کردن
          </button>
        </div>
      </div>

      <div className="logbox" ref={boxRef} data-testid="logbox">
        {logs.length === 0 ? (
          <div className="logline sys">
            <span className="t">--:--:--</span>
            <span>هنوز پیامی نیست — وصل شو و یک کنترل بزن تا این‌جا ببینیش.</span>
          </div>
        ) : (
          logs.map((e) => (
            <div key={e.id} className={`logline ${e.dir}`}>
              <span className="t">{timeLabel(e.ts)}</span>
              <span className="d" title={DIR_NAME[e.dir]}>
                {MARK[e.dir]}
              </span>
              <span dir="auto">{e.text}</span>
            </div>
          ))
        )}
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>ارسال خام (بدون کنترل)</label>
        <div className="txtc">
          <input
            type="text"
            value={raw}
            dir="ltr"
            placeholder="مثلاً: 1"
            data-testid="raw-input"
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doSend();
            }}
          />
          <button type="button" className="btn primary small" data-testid="raw-send" onClick={() => void doSend()}>
            ارسال
          </button>
        </div>
        <div className="hint">برای ارسال باید وصل باشی؛ دستور خام هم در همین کنسول ثبت می‌شود.</div>
      </div>
    </>
  );
}
