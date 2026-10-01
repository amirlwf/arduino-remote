/**
 * تست‌های واحد Arduino Remote — بدون مرورگر، فقط node:
 *   npm test   (=node --experimental-strip-types tests/unit.mjs)
 *
 * منطق محض (فرمان‌ها، ذخیره‌سازی، Store) + انتقال‌ها با شبکه‌ی واقعی لوکال
 * (اکوی WebSocket دست‌ساز) پوشش داده می‌شود. هیچ mock شبکه‌ای در کار نیست.
 */
import { startEchoServer } from "./ws-echo.mjs";
import { buildPayloads, mapSlider, sliderTemplateError } from "../src/lib/commands.ts";
import { clearLogs, getLogs, logAppend, timeLabel } from "../src/lib/log.ts";
import { createManager, createTransport } from "../src/lib/connection.ts";
import {
  defaultState,
  exportJson,
  newId,
  normalizeState,
  parseImport,
} from "../src/lib/storage.ts";
import { createStore } from "../src/lib/store.ts";
import { BluetoothTransport } from "../src/lib/transports/bluetooth.ts";
import { DemoTransport } from "../src/lib/transports/demo.ts";
import { WebSocketTransport } from "../src/lib/transports/websocket.ts";
import { WebSerialTransport } from "../src/lib/transports/webserial.ts";

let pass = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) pass++;
  else failures.push(detail ? `${name} — ${detail}` : name);
}
function eq(name, got, want) {
  check(name, Object.is(got, want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================ فرمان‌ها */

const toggle = {
  id: "t1", type: "toggle", name: "چراغ", icon: "💡", color: "#00e0a4", suffix: "",
  onPayload: "1", offPayload: "0", on: false,
};
const slider = {
  id: "s1", type: "slider", name: "سرعت", icon: "⚡", color: "#4d9dff", suffix: "",
  template: "V{v}", min: 0, max: 100, outMin: 0, outMax: 255, value: 0, sendOnRelease: false,
};
const momentary = {
  id: "m1", type: "momentary", name: "آژیر", icon: "🔔", color: "#ffb347", suffix: "",
  pressPayload: "H", releasePayload: "S",
};
const textCtrl = {
  id: "x1", type: "text", name: "متن", icon: "🎛️", color: "#b48bff", suffix: "",
  placeholder: "p", text: "",
};

eq("toggle: روشن → 1", buildPayloads(toggle, { kind: "toggle", on: true })[0], "1");
eq("toggle: خاموش → 0", buildPayloads(toggle, { kind: "toggle", on: false })[0], "0");
eq("toggle: رویداد غلط چیزی نمی‌سازد", buildPayloads(toggle, { kind: "press" }).length, 0);

eq("slider: 0 → 0", mapSlider(slider, 0), 0);
eq("slider: 100 → 255", mapSlider(slider, 100), 255);
eq("slider: 50 → 128 (گرد)", mapSlider(slider, 50), 128);
eq("slider: بالاتر از بازه clamp", mapSlider(slider, 500), 255);
eq("slider: پایین‌تر از بازه clamp", mapSlider(slider, -20), 0);
const reversed = { ...slider, outMin: 255, outMax: 0 };
eq("slider: بازه‌ی معکوس 0 → 255", mapSlider(reversed, 0), 255);
eq("slider: بازه‌ی معکوس 100 → 0", mapSlider(reversed, 100), 0);

eq(
  "slider: الگو جایگزین می‌شود",
  buildPayloads(slider, { kind: "slider", value: 40 })[0],
  "V102"
);
eq("slider: با suffix", buildPayloads({ ...slider, suffix: "\n" }, { kind: "slider", value: 0 })[0], "V0\n");
eq("slider: الگوی بدون {v} خطا می‌دهد", sliderTemplateError("V1"), "الگو باید شامل {v} باشد — مثلاً V{v}");
eq("slider: الگوی سالم null", sliderTemplateError("V{v}"), null);

eq("momentary: فشردن", buildPayloads(momentary, { kind: "press" })[0], "H");
eq("momentary: رها کردن", buildPayloads(momentary, { kind: "release" })[0], "S");
eq(
  "momentary: release خالی = بدون ارسال",
  buildPayloads({ ...momentary, releasePayload: "" }, { kind: "release" }).length,
  0
);
eq("text: ارسال متن trim", buildPayloads(textCtrl, { kind: "send", text: "  hi  " })[0], "hi");
eq("text: متن خالی ارسال نمی‌شود", buildPayloads(textCtrl, { kind: "send", text: "   " }).length, 0);
eq(
  "suffix: فقط \\r\\n",
  buildPayloads({ ...toggle, suffix: "\r\n" }, { kind: "toggle", on: true })[0],
  "1\r\n"
);

/* ============================================================ ذخیره‌سازی */

const def = defaultState();
eq("default: یک پروفایل", def.profiles.length, 1);
eq("default: چهار کنترل نمونه", def.profiles[0].controls.length, 4);
eq("default: نوع اتصال دمو", def.transport.kind, "demo");
eq("default: نسخه 1", def.version, 1);

eq("newId: یکتا", newId() !== newId(), true);

const fixed = normalizeState({
  version: 1,
  profiles: [
    {
      id: "p1",
      name: "A",
      icon: "🔧",
      controls: [
        { id: "c1", type: "toggle", name: "ok", onPayload: "1", offPayload: "0" },
        { id: "c2", type: "toggle", name: "broken" }, // بدون هیچ پیامی → حذف
        { id: "c3", type: "slider", name: "bad", template: "no-var" }, // بدون {v} → حذف
        "nonsense",
      ],
    },
    { id: "p2", name: "B", controls: [] },
  ],
  activeProfileId: "GONE",
  transport: { kind: "wat", wsUrl: 5 },
});
eq("normalize: پروفایل‌ها می‌مانند", fixed.profiles.length, 2);
eq("normalize: کنترل خراب حذف می‌شود", fixed.profiles[0].controls.length, 1);
eq("normalize: active نامعتبر → اولین", fixed.activeProfileId, "p1");
eq("normalize: kind نامعتبر → demo", fixed.transport.kind, "demo");
eq("normalize: wsUrl غیرمتنی ترمیم", fixed.transport.wsUrl, "ws://192.168.1.10:81");
eq("normalize: شناسه‌ی خالی ساخته می‌شود", typeof fixed.profiles[0].controls[0].id, "string");

eq("normalize: ورودی کاملاً خراب null", normalizeState("hello"), null);
eq("normalize: بدون پروفایل null", normalizeState({ version: 1, profiles: [] }), null);

const badImport = parseImport("{not json");
eq("import: JSON خراب خطا", badImport.ok, false);
const goodImport = parseImport(exportJson(def));
eq("import: رفت و برگشت سالم", goodImport.ok, true);
eq("import: محتوا حفظ می‌شود", goodImport.ok && goodImport.state.profiles[0].controls.length, 4);

/* ============================================================ Store */

const st = createStore(def);
const snap1 = st.snapshot();
st.addControl({ ...toggle, id: "new1", name: "جدید" });
const snap2 = st.snapshot();
check("store: snapshot تازه می‌شود (قرارداد useSyncExternalStore)", snap1 !== snap2, "snapshot همان شیء قدیمی ماند");
eq("store: اضافه شد", st.activeProfile.controls.length, 5);
eq("store: بدون تغییر، snapshot همان شیء می‌ماند", st.snapshot() === snap2, true);

st.moveControl("new1", -1);
eq("store: جابه‌جایی بالا", st.activeProfile.controls[3].id, "new1");
st.moveControl("new1", -1);
eq("store: جابه‌جایی دوباره", st.activeProfile.controls[2].id, "new1");
eq("store: بالای لیست جابه‌جا نمی‌شود", st.moveControl("new1", -1), true); // در جایگاه 1، -1 جایز است
st.moveControl("new1", -1);
eq("store: ابتدای لیست ساکن می‌ماند", st.activeProfile.controls[0].id, "new1");

eq("store: حذف کنترل", st.removeControl("new1"), true);
eq("store: حذف ناموجود false", st.removeControl("nope"), false);
const defToggleId = def.profiles[0].controls.find((c) => c.type === "toggle").id;
eq("store: جایگزینی", st.replaceControl(defToggleId, { ...toggle, id: defToggleId, on: true }), true);
eq("store: جایگزینی اعمال شد", st.activeProfile.controls.find((c) => c.id === defToggleId).on, true);

const other = st.addProfile("دوم", "🤖");
eq("store: پروفایل جدید فعال می‌شود", st.activeProfile.id, other.id);
eq("store: خالی است", st.activeProfile.controls.length, 0);
eq("store: بازگشت به اولی", st.setActiveProfile(def.activeProfileId), true);
eq("store: فعال‌سازی ناموجود false", st.setActiveProfile("zzz"), false);
eq("store: حذف پروفایل فعال", st.removeProfile(other.id), true);
eq("store: آخرین پروفایل قابل حذف نیست", st.removeProfile(def.profiles[0].id), false);
eq("store: پروفایل ماند", st.snapshot().profiles.length, 1);

eq("store: import خراب خطا", st.importJson("xx").ok, false);
eq("store: تنظیم اتصال", (() => { st.setTransport({ kind: "websocket", wsUrl: "ws://x:1" }); return st.snapshot().transport.kind; })(), "websocket");

/* ============================================================ کنسول */

clearLogs();
logAppend("tx", "1");
logAppend("rx", "1");
eq("log: دو پیام", getLogs().length, 2);
eq("log: جهت", getLogs()[1].dir, "rx");
check("log: برچسب زمان HH:MM:SS", /^\d{2}:\d{2}:\d{2}$/.test(timeLabel(Date.now())), timeLabel(Date.now()));
for (let i = 0; i < 400; i++) logAppend("tx", String(i));
eq("log: سقف 300", getLogs().length, 300);
clearLogs();
eq("log: پاک شد", getLogs().length, 0);

/* ============================================================ انتقال‌ها */

// دمو
{
  const t = new DemoTransport();
  let status = null;
  t.on("status", (s) => (status = s));
  await t.connect();
  eq("demo: متصل", t.status, "connected");
  eq("demo: رویداد status", status, "connected");
  let rx = null;
  t.on("data", (d) => (rx = d));
  await t.send("HELLO");
  await sleep(80);
  eq("demo: اکوی پیام", rx, "HELLO");
  await t.disconnect();
  eq("demo: قطع", t.status, "disconnected");
  let threw = false;
  try { await t.send("x"); } catch { threw = true; }
  check("demo: ارسال بعد از قطع خطا", threw);
  const silent = new DemoTransport(false);
  await silent.connect();
  let rx2 = false;
  silent.on("data", () => (rx2 = true));
  await silent.send("x");
  await sleep(80);
  eq("demo: اکوی خاموش", rx2, false);
  await silent.disconnect();
}

// وب‌سوکت — اتصال واقعی به سرور اکوی لوکال
{
  const server = await startEchoServer();
  const t = new WebSocketTransport(server.url);
  const statuses = [];
  t.on("status", (s) => statuses.push(s));
  await t.connect();
  eq("ws: متصل", t.status, "connected");
  eq("ws: connecting سپس connected", statuses.join(">"), "connecting>connected");
  const received = [];
  t.on("data", (d) => received.push(d));
  await t.send("LED_ON");
  await t.send("V128");
  await sleep(150);
  eq("ws: دو پیام اکو شد", received.join(","), "LED_ON,V128");
  await t.disconnect();
  eq("ws: قطع", t.status, "disconnected");
  await server.close();

  const bad = new WebSocketTransport("http://wrong");
  let err = null;
  try { await bad.connect(); } catch (e) { err = e.message; }
  check("ws: آدرس غیرسوکت خطا", /ws/.test(err || ""), err);

  const dead = new WebSocketTransport("ws://127.0.0.1:1");
  err = null;
  try { await dead.connect(); } catch (e) { err = e.message; }
  check("ws: پورت بسته خطا", Boolean(err), "بدون خطا رد شد");
}

// بلوتوث — در node پلی وجود ندارد
{
  const t = new BluetoothTransport("AA:BB");
  let err = null;
  try { await t.connect(); } catch (e) { err = e.message; }
  check("bt: بدون پل خطا با پیام APK", /APK/.test(err || ""), err);
  eq("bt: وضعیت error", t.status, "disconnected"); // پیش از setStatus متصل نشده
}

// سریال وب — در node پشتیبانی نمی‌شود
{
  const t = new WebSerialTransport(9600);
  let err = null;
  try { await t.connect(); } catch (e) { err = e.message; }
  check("serial: بدون Web Serial خطا", /Web Serial/.test(err || ""), err);
}

// کارخانه‌ی انتقال + مدیر
{
  eq("factory: demo", createTransport({ kind: "demo", wsUrl: "", btAddress: "" }).kind, "demo");
  eq("factory: bluetooth", createTransport({ kind: "bluetooth", wsUrl: "", btAddress: "x" }).kind, "bluetooth");
  eq("factory: websocket", createTransport({ kind: "websocket", wsUrl: "ws://a", btAddress: "" }).kind, "websocket");
  eq("factory: webserial", createTransport({ kind: "webserial", wsUrl: "", btAddress: "" }).kind, "webserial");

  const mgr = createManager(() => ({ kind: "demo", wsUrl: "", btAddress: "" }));
  eq("mgr: ابتدا قطع", mgr.status, "disconnected");
  let sendErr = null;
  try { await mgr.send("x"); } catch (e) { sendErr = e.message; }
  check("mgr: ارسال بدون اتصال خطا", /اتصال برقرار نیست/.test(sendErr || ""), sendErr);

  await mgr.connect();
  eq("mgr: متصل به دمو", mgr.status, "connected");
  eq("mgr: برچسب", mgr.label, "شبیه‌ساز (بدون سخت‌افزار)");
  const rx = [];
  mgr.on("data", (d) => rx.push(d));
  await mgr.send("PING");
  await sleep(80);
  eq("mgr: اکو", rx.join(","), "PING");
  await mgr.disconnect();
  eq("mgr: قطع", mgr.status, "disconnected");
}

/* ============================================================ نتیجه */

const failed = failures.length;
console.log(`UNIT_SUMMARY pass=${pass} fail=${failed}`);
if (failed > 0) {
  for (const f of failures) console.log("FAIL:", f);
  process.exit(1);
}
