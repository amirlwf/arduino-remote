import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { store } from "../lib/appState.ts";
import { toggleConnection } from "../lib/connectAction.ts";
import { getManager } from "../lib/connection.ts";
import { exportJson } from "../lib/storage.ts";
import { toast } from "../lib/toast.ts";
import { TRANSPORT_LABELS, type Profile, type TransportKind } from "../lib/types.ts";
import { btAvailable, btDiscover, btList, openBtSettings, type BtDevice } from "../lib/transports/bluetooth.ts";

const KIND_ICON: Record<TransportKind, string> = {
  demo: "🎮",
  bluetooth: "📶",
  webserial: "🔌",
  websocket: "🌐",
};

const KIND_DESC: Record<TransportKind, string> = {
  demo: "بدون سخت‌افزار — برای یادگیری و تست. هر دستور بلافاصله به‌صورت پیام دریافتی برمی‌گردد.",
  bluetooth: "اتصال مستقیم به HC-05 با بلوتوث گوشی. فقط داخل نسخه‌ی APK کار می‌کند؛ اتصال، جفت‌سازی (pair) را هم خودش انجام می‌دهد.",
  webserial: "کابل USB به رایانه با کروم/اِج دسکتاپ — برای تست رومیزی با سرعت ۹۶۰۰.",
  websocket: "وصل شدن به یک پل سوکت (رایانه، ESP یا سرور) که خودش به دستگاه وصل است.",
};

const KINDS: TransportKind[] = ["demo", "bluetooth", "webserial", "websocket"];

export function SettingsView() {
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  const mgr = getManager();
  const transport = state.transport;

  // وضعیت اتصال از مدیر می‌آید، نه از store — باید جداگانه اشتراک شود
  const [mgrStatus, setMgrStatus] = useState(mgr.status);
  useEffect(() => getManager().on("status", (s) => setMgrStatus(s)), []);

  /* ---- بلوتوث ---- */
  const [devices, setDevices] = useState<BtDevice[]>([]);
  const [devicesKind, setDevicesKind] = useState<"paired" | "discover" | null>(null);
  const [btBusy, setBtBusy] = useState(false);
  const scan = async (mode: "paired" | "discover") => {
    setBtBusy(true);
    setDevicesKind(mode);
    try {
      const list = mode === "paired" ? await btList() : await btDiscover();
      setDevices(list);
      if (list.length === 0) toast("دستگاهی پیدا نشد", "err");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBtBusy(false);
    }
  };

  /* ---- پروفایل‌ها ---- */
  const [profModal, setProfModal] = useState<{ mode: "add" } | { mode: "edit"; p: Profile } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  /* ---- داده‌ها ---- */
  const [exportText, setExportText] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [resetArmed, setResetArmed] = useState(false);

  const copyExport = async () => {
    if (!exportText) return;
    try {
      await navigator.clipboard.writeText(exportText);
      toast("در کلیپ‌بورد کپی شد", "ok");
    } catch {
      toast("کپی خودکار نشد — متن را دستی انتخاب کن", "err");
    }
  };

  const doImport = () => {
    const res = store.importJson(importText);
    if (res.ok) {
      setImportText("");
      toast("داده‌ها بازیابی شد", "ok");
    } else {
      toast(res.error, "err");
    }
  };

  return (
    <>
      <div className="sect-head">
        <div>
          <h2>تنظیمات</h2>
          <span className="sub">اتصال، دستگاه‌ها (پروفایل) و داده‌ها</span>
        </div>
      </div>

      {/* ---------------------------------------------- اتصال */}
      <section className="panel" data-testid="panel-transport">
        <h3>📡 نوع اتصال</h3>
        <div className="choices">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              data-kind={k}
              className={"choice" + (transport.kind === k ? " sel" : "")}
              onClick={() => store.setTransport({ kind: k })}
            >
              <span className="ci">{KIND_ICON[k]}</span>
              <span>
                <span className="ct">{TRANSPORT_LABELS[k]}</span>
                <span className="cd">{KIND_DESC[k]}</span>
              </span>
            </button>
          ))}
        </div>

        {transport.kind === "websocket" && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>آدرس سوکت پل</label>
            <input
              type="text"
              dir="ltr"
              value={transport.wsUrl}
              placeholder="ws://192.168.1.10:81"
              data-testid="ws-url"
              onChange={(e) => store.setTransport({ wsUrl: e.target.value })}
            />
            <div className="hint">
              پل باید متن‌های دریافتی را به سوکت بفرستد و دستورهای سوکت را به دستگاه برساند.
            </div>
          </div>
        )}

        {transport.kind === "bluetooth" && (
          <div style={{ marginTop: 12 }}>
            <div className="field">
              <label>آدرس دستگاه (MAC)</label>
              <input
                type="text"
                dir="ltr"
                value={transport.btAddress}
                placeholder="مثال: 98:D3:31:F7:43:6C"
                data-testid="bt-address"
                onChange={(e) => store.setTransport({ btAddress: e.target.value })}
              />
            </div>
            <div className="rowbtns">
              <button type="button" className="btn small" disabled={btBusy} onClick={() => void scan("paired")}>
                دستگاه‌های جفت‌شده
              </button>
              <button type="button" className="btn small" disabled={btBusy} onClick={() => void scan("discover")}>
                جستجو…
              </button>
              <button type="button" className="btn small" data-testid="bt-open-settings" onClick={openBtSettings}>
                تنظیمات بلوتوث گوشی
              </button>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              {devicesKind === "discover"
                ? "این لیست «جفت‌نشده‌ها»ست — «انتخاب» بزنید و بعد «اتصال»؛ اپ خودش جفت‌سازی را راه می‌اندازد (رمز معمول 1234)."
                : "فهرست جفت‌شده‌ها — اتصال از همین‌جاست."}
            </div>
            {devices.length > 0 && (
              <div className="plist" style={{ marginTop: 10 }}>
                {devices.map((d) => (
                  <div key={d.id} className="prow">
                    <span className="pname">
                      {d.name}
                      <span className="pmeta">{d.id}</span>
                      {devicesKind === "discover" && <span className="badge-mini">جفت‌نشده</span>}
                    </span>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => store.setTransport({ btAddress: d.id })}
                    >
                      انتخاب
                    </button>
                  </div>
                ))}
              </div>
            )}
            {!btAvailable() && (
              <div className="note warn" style={{ marginTop: 10 }}>
                <b>این مرورگر بلوتوث کلاسیک ندارد</b>
                بلوتوث SPP (HC-05) از صفحه‌وب در دسترس نیست؛ این گزینه داخل نسخه‌ی APK کار می‌کند.
                برای تست همین‌جا، «بازی» را انتخاب کن.
              </div>
            )}
          </div>
        )}

        {transport.kind === "webserial" && (
          <div className="note" style={{ marginTop: 12 }}>
            <b>سریال USB</b>
            فقط در کروم/اِج رومیزی. هنگام اتصال، پنجره‌ی انتخاب پورت باز می‌شود؛ سرعت ۹۶۰۰ با
            پیش‌فرض اسکچ‌های آردوینو یکی است.
          </div>
        )}

        {transport.kind === "demo" && (
          <div className="note" style={{ marginTop: 12 }}>
            <b>حالت شبیه‌ساز</b>
            برای یادگیری اپ و تست کنترل‌ها بدون هیچ سخت‌افزاری. هر دستور ارسال‌شده با تاخیر کوتاه
            به‌صورت پیام دریافتی در کنسول برمی‌گردد.
          </div>
        )}

        <hr className="sep" />
        <div className="rowbtns" data-testid="conn-actions">
          <button type="button" className="btn primary" data-testid="connect-btn" onClick={() => void toggleConnection()}>
            {mgrStatus === "connected" || mgrStatus === "connecting" ? "قطع اتصال" : "اتصال"}
          </button>
          <span className={"badge" + (mgrStatus === "connected" ? " ok" : "")} data-testid="conn-status">
            {TRANSPORT_LABELS[transport.kind]} — {mgrStatus}
          </span>
        </div>
      </section>

      {/* ---------------------------------------------- پروفایل‌ها */}
      <section className="panel" data-testid="panel-profiles">
        <h3>🗂️ دستگاه‌ها (پروفایل‌ها)</h3>
        <div className="plist">
          {state.profiles.map((p) => (
            <div key={p.id} className={"prow" + (p.id === state.activeProfileId ? " active" : "")}>
              <span
                className="pname"
                onClick={() => store.setActiveProfile(p.id)}
                title="فعال‌سازی"
              >
                {p.icon} {p.name}
                <span className="pmeta">
                  {p.id === state.activeProfileId ? "فعال — " : ""}
                  {p.controls.length} کنترل
                </span>
              </span>
              <button type="button" className="btn small icon" aria-label="ویرایش" onClick={() => setProfModal({ mode: "edit", p })}>
                ✎
              </button>
              <button
                type="button"
                className={"btn small icon" + (confirmDel === p.id ? " danger" : "")}
                aria-label="حذف"
                onClick={() => {
                  if (confirmDel !== p.id) {
                    setConfirmDel(p.id);
                    setTimeout(() => setConfirmDel((v) => (v === p.id ? null : v)), 3000);
                    return;
                  }
                  if (store.removeProfile(p.id)) toast("دستگاه حذف شد", "ok");
                  else toast("آخرین دستگاه قابل حذف نیست", "err");
                  setConfirmDel(null);
                }}
              >
                {confirmDel === p.id ? "حذف؟" : "🗑"}
              </button>
            </div>
          ))}
        </div>
        <div className="rowbtns" style={{ marginTop: 10 }}>
          <button type="button" className="btn small" data-testid="add-profile" onClick={() => setProfModal({ mode: "add" })}>
            + دستگاه جدید
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          هر دستگاه مجموعه‌ی کنترل‌های خودش را دارد؛ با زدن روی نامش جابه‌جا می‌شوی.
        </div>
      </section>

      {/* ---------------------------------------------- داده‌ها */}
      <section className="panel" data-testid="panel-data">
        <h3>💾 داده‌ها</h3>
        <div className="rowbtns">
          <button type="button" className="btn small" data-testid="export-btn" onClick={() => setExportText(exportJson(store.snapshot()))}>
            خروجی JSON
          </button>
          <button type="button" className="btn small" onClick={() => setExportText(null)}>
            بستن خروجی
          </button>
          <button
            type="button"
            className={"btn small" + (resetArmed ? " danger" : "")}
            data-testid="reset-btn"
            onClick={() => {
              if (!resetArmed) {
                setResetArmed(true);
                setTimeout(() => setResetArmed(false), 3000);
                return;
              }
              store.resetDefaults();
              setResetArmed(false);
              toast("به حالت پیش‌فرض برگشت", "ok");
            }}
          >
            {resetArmed ? "واقعاً بازنشانی؟" : "بازنشانی"}
          </button>
        </div>

        {exportText && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>خروجی — برای نگهداری یا انتقال به دستگاه دیگر</label>
            <textarea rows={5} readOnly value={exportText} dir="ltr" data-testid="export-text" />
            <div className="rowbtns" style={{ marginTop: 8 }}>
              <button type="button" className="btn small primary" onClick={() => void copyExport()}>
                کپی
              </button>
            </div>
          </div>
        )}

        <div className="field" style={{ marginTop: 12 }}>
          <label>بازیابی از JSON</label>
          <textarea
            rows={4}
            value={importText}
            dir="ltr"
            placeholder='{"version":1, ...}'
            data-testid="import-text"
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="rowbtns" style={{ marginTop: 8 }}>
            <button type="button" className="btn small primary" data-testid="import-btn" onClick={doImport}>
              بازیابی
            </button>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------- راهنما */}
      <section className="panel">
        <h3>❓ راهنمای اتصال واقعی (HC-05)</h3>
        <div className="note">
          <b>چرا بلوتوث فقط در APK کار می‌کند؟</b>
          مرورگرها بلوتوث کلاسیک (SPP) را در اختیار صفحه‌وب نمی‌گذارند؛ این محدودیت امنیتی
          مرورگر است، نه اپ. برای همین همین کد با افزوده‌شدن لایه‌ی بلوتوث اندروید، داخل فایل
          APK که در ادامه ساخته می‌شود، مستقیم با HC-05 حرف می‌زند.
        </div>
        <div className="note" style={{ marginTop: 8 }}>
          <b>مسیرهای امروز بدون سخت‌افزار</b>
          شبیه‌ساز برای یادگیری، وب‌سوکت برای پل‌های سفارشی، سریال USB برای تست با کابل.
        </div>
        <div className="hint" style={{ marginTop: 8 }} data-testid="creator">
          نسخه ۱.۰.۲ — Arduino Remote · ساخته‌شده با TypeScript + React + Capacitor
          <br />
          سازنده:{" "}
          <a href="https://amirlwf.ir" target="_blank" rel="noreferrer">
            امیررضا لطفی
          </a>
        </div>
      </section>

      <ProfileModal state={profModal} onClose={() => setProfModal(null)} />
    </>
  );
}

/* ------------------------------------------------------ مودال پروفایل */

type ProfState = { mode: "add" } | { mode: "edit"; p: Profile } | null;

function ProfileModal({ state, onClose }: { state: ProfState; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🔧");
  const [err, setErr] = useState("");

  const open = state !== null;
  const editing = state?.mode === "edit";

  // هر بار که باز می‌شود مقادیر را تازه کن
  const lastKey = editing ? state.p.id : "add";
  const [lastApplied, setLastApplied] = useState<string | null>(null);
  if (open && lastApplied !== lastKey) {
    setLastApplied(lastKey);
    setName(editing ? state.p.name : "");
    setIcon(editing ? state.p.icon : "🔧");
    setErr("");
  }

  if (ref.current) {
    if (open && !ref.current.open) ref.current.showModal();
    else if (!open && ref.current.open) ref.current.close();
  }

  const save = () => {
    if (name.trim() === "") {
      setErr("نام دستگاه را بنویس");
      return;
    }
    if (state?.mode === "edit") store.renameProfile(state.p.id, name, icon);
    else store.addProfile(name, icon);
    toast("ذخیره شد", "ok");
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className="modal"
      data-testid="profile-modal"
      onClose={() => {
        if (open) onClose();
      }}
    >
      <div className="m-head">
        <h3>{editing ? "ویرایش دستگاه" : "دستگاه جدید"}</h3>
        <button type="button" className="m-close" aria-label="بستن" onClick={() => onClose()}>
          ✕
        </button>
      </div>
      <div className="m-body">
        <div className="field row">
          <div>
            <label>نام</label>
            <input
              type="text"
              value={name}
              placeholder="مثلاً: ربات اتاق"
              data-testid="prof-name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div style={{ maxWidth: 96 }}>
            <label>آیکن</label>
            <input type="text" value={icon} maxLength={4} aria-label="آیکن" onChange={(e) => setIcon(e.target.value)} />
          </div>
        </div>
        <div className="err-line">{err}</div>
      </div>
      <div className="m-foot">
        <button type="button" className="btn ghost" onClick={() => onClose()}>
          انصراف
        </button>
        <button type="button" className="btn primary" data-testid="prof-save" onClick={save}>
          ذخیره
        </button>
      </div>
    </dialog>
  );
}
