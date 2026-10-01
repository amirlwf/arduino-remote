#!/usr/bin/env python3
"""
QA واقعی Arduino Remote روی Chrome سیستمی از طریق CDP (بدون وابستگی به مرورگر Hermes).

اجرا:  python scripts/qa_cdp.py
پیش‌نیاز: بیلد شده (npm run build) + vite preview روی 4173 + سرور اکوی وب‌سوکت روی 8099
خروجی: خطوط PASS/FAIL + خلاصه‌ی JSON + اسکرین‌شات‌ها در مسیر ذکرشده.
خروجی process: صفر = همه سبز.
"""
import json
import os
import sys
import time
import urllib.request

import websocket  # websocket-client

PORT = 9333
URL = "http://127.0.0.1:4173/"
SHOT_DIR = os.path.join(os.environ.get("TMPDIR") or ".", "arduremote-qa")

checks = []


def ck(name, cond, detail=""):
    checks.append({"name": name, "ok": bool(cond), "detail": str(detail)[:300]})
    print(("PASS  " if cond else "FAIL  ") + name + (("  | " + str(detail)[:300]) if detail else ""), flush=True)


# ---------- CDP ----------
def get_tab():
    for _ in range(40):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=2))
            pages = [t for t in tabs if t.get("type") == "page"]
            if pages:
                return pages[0]
        except Exception:
            pass
        time.sleep(0.4)
    raise SystemExit("ERROR: صفحه‌ای روی پورت 9333 پیدا نشد — chrome بالا نیست؟")


tab = get_tab()
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], suppress_origin=True, timeout=20)
_mid = 0


def send(method, **params):
    global _mid
    _mid += 1
    my = _mid
    ws.send(json.dumps({"id": my, "method": method, "params": params}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == my:
            if "error" in m:
                raise RuntimeError(f"{method}: {m['error']}")
            return m.get("result", {})


def ev(expr, promise=False):
    r = send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=promise)
    if "exceptionDetails" in r:
        d = r["exceptionDetails"]
        raise RuntimeError(d.get("text", "") + " " + str(d.get("exception", {}).get("description", ""))[:200])
    return r.get("result", {}).get("value")


def wait(expr, timeout=8.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            v = ev(expr)
            if v:
                return v
        except Exception:
            pass
        time.sleep(0.2)
    return None


def shot(name):
    os.makedirs(SHOT_DIR, exist_ok=True)
    import base64
    data = send("Page.captureScreenshot", format="png").get("data", "")
    path = os.path.join(SHOT_DIR, name)
    with open(path, "wb") as f:
        f.write(base64.b64decode(data))
    print("SHOT", path, flush=True)
    return path


def set_input(sel, value):
    """مقدار input کنترل‌شده‌ی React را ست می‌کند (native setter + رویداد input)"""
    js = f"""(()=>{{const el=document.querySelector({json.dumps(sel)});
if(!el) return 'NO_EL';
const proto = el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
Object.getOwnPropertyDescriptor(proto,'value').set.call(el,{json.dumps(value)});
el.dispatchEvent(new Event('input',{{bubbles:true}}));
el.dispatchEvent(new Event('change',{{bubbles:true}}));return 'ok';}})()"""
    return ev(js)


# ---------- شروع ----------
send("Page.enable")
send("Runtime.enable")
send(
    "Page.addScriptToEvaluateOnNewDocument",
    source="window.__pageErrors=[];"
    "addEventListener('error',e=>__pageErrors.push(String(e.message)));"
    "addEventListener('unhandledrejection',e=>__pageErrors.push(String(e.reason)));",
)
send("Page.navigate", url=URL)
send("Page.bringToFront")
time.sleep(2.0)

print("== PHASE 1: بارگذاری و کنترل‌های پیش‌فرض ==", flush=True)
# SW از جلسه‌ی قبل نباشد که کش کهنه بخواند
ev("(async()=>{for(const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();"
   "if(window.caches) for(const k of await caches.keys()) await caches.delete(k);})()", promise=True)
# state تازه → اجرای قطعی و تکرارپذیر تست
ev("localStorage.clear()")
send("Page.navigate", url=URL)
send("Page.bringToFront")
time.sleep(2.0)

ck("app mount (conn-pill)", bool(wait("!!document.querySelector('#conn-pill')")))
ck("title", "Arduino Remote" in (ev("document.title") or ""), ev("document.title"))
ck("۴ کنترل پیش‌فرض", bool(wait("document.querySelectorAll('.ccard').length===4")), ev("document.querySelectorAll('.ccard').length"))
ck("وضعیت اولیه قطع", ev("document.querySelector('#conn-text').textContent") == "قطع", ev("document.querySelector('#conn-text').textContent"))

ev("document.querySelector('#conn-pill').click()")
ck("اتصال شبیه‌ساز", bool(wait("document.querySelector('#conn-text').textContent==='متصل'", 5)), ev("document.querySelector('#conn-text').textContent"))

G = "window.__ARDUINO_REMOTE__"
ev("document.querySelector('.ccard [data-testid=toggle-btn]').click()")
time.sleep(0.2)
t_on = ev(f"{G}.store.snapshot().profiles[0].controls.find(c=>c.type==='toggle').on")
ck("کلید: on=true شد", t_on is True, t_on)
lg = ev(f"{G}.getLogs().map(e=>e.dir+' | '+e.text)")
tx = [l for l in lg if l.startswith("tx")]
rx = [l for l in lg if l.startswith("rx")]
ck("کلید: فرمان tx", len(tx) >= 1, tx[-2:])
ck("کلید: echo rx", len(rx) >= 1, rx[-2:])

sl = ev(f"{G}.store.snapshot().profiles[0].controls.find(c=>c.type==='slider')")
mn, mx, om, ox = sl["min"], sl["max"], sl["outMin"], sl["outMax"]
expected = sl["template"].replace("{v}", str(int(round(om + (80 - mn) / (mx - mn) * (ox - om)))))
ev("""(()=>{const r=document.querySelector('.ccard input[type=range]');
const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
s.call(r,'80'); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true})); return 'ok';})()""")
time.sleep(0.25)
lg = ev(f"{G}.getLogs().map(e=>e.dir+' | '+e.text)")
tx = [l.split(" | ", 1)[-1] for l in lg if l.startswith("tx")]
ck("لغزنده: نگاشت عددی رفت", expected in tx, f"expected={expected} last={tx[-3:]}")

mo = ev(f"{G}.store.snapshot().profiles[0].controls.find(c=>c.type==='momentary')")
n_before = len(lg)
ev("""document.querySelectorAll('.ccard')[1].querySelector('[data-testid=momentary-btn]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))""")
time.sleep(0.2)
lg = ev(f"{G}.getLogs().map(e=>e.dir+' | '+e.text)")
new_tx = [l.split(" | ", 1)[-1] for l in lg[n_before:] if l.startswith("tx")]
ck("لحظه‌ای: دستور فشردن", bool(new_tx) and new_tx[0].strip() == mo["pressPayload"], f"{new_tx} pressPayload={mo['pressPayload']}")

ck("بدون خطای JS پس از تعامل فاز ۱", ev("window.__appErrors.length") == 0 and ev("window.__pageErrors.length") == 0,
   {"app": ev("window.__appErrors"), "page": ev("window.__pageErrors")})

print("== PHASE 2: مودال افزودن، ویرایش/حذف، ماندگاری ==", flush=True)
ev("document.querySelector('[data-testid=fab-add]').click()")
ck("مودال کنترل جدید باز شد", bool(wait("document.querySelector('[data-testid=control-modal]')?.open", 4)))
ck("ست کردن نام", set_input("[data-testid=ctrl-name]", "کنترل آزمایشی") == "ok")
ev("document.querySelector('[data-testid=type-grid] [data-type=toggle]').click()")
ck("ست کردن دستور ON", set_input("[data-testid=on-payload]", "ON_TEST") == "ok")
ev("document.querySelector('[data-testid=modal-save]').click()")
ck("کنترل جدید ساخته شد (۵ تا)", bool(wait("document.querySelectorAll('.ccard').length===5", 5)), ev("document.querySelectorAll('.ccard').length"))
ck("مودال بسته شد", not ev("document.querySelector('[data-testid=control-modal]').open"))

n_tx = len([l for l in ev(f"{G}.getLogs().map(e=>e.dir)") if l == "tx"])
ev("document.querySelectorAll('.ccard')[4].querySelector('[data-testid=toggle-btn]').click()")
time.sleep(0.25)
lg = ev(f"{G}.getLogs().map(e=>e.dir+' | '+e.text)")
ck("کنترل جدید: دستور ON_TEST رفت", any(l == "tx | ON_TEST" for l in lg), lg[-3:])

# ویرایش: حذف دومرحله‌ای
ev("document.querySelector('[data-testid=edit-toggle]').click()")
ck("حالت ویرایش: tools ظاهر شد", bool(wait("!!document.querySelectorAll('.ccard')[4]?.querySelector('.tools')", 3)))
ev("document.querySelectorAll('.ccard')[4].querySelector('[aria-label=حذف]').click()")
ev("document.querySelectorAll('.ccard')[4].querySelector('[aria-label=حذف]').click()")
ck("حذف دومرحله‌ای: برگشت به ۴ کنترل", bool(wait("document.querySelectorAll('.ccard').length===4", 4)), ev("document.querySelectorAll('.ccard').length"))
ev("document.querySelector('[data-testid=edit-toggle]').click()")

# کنسول
ev("document.querySelector('.tab[data-tab=console]').click()")
ck("تب کنسول: ردیف tx واقعی", bool(wait("document.querySelectorAll('[data-testid=logbox] .logline.tx').length>0", 4)),
   ev("document.querySelectorAll('[data-testid=logbox] .logline').length"))
set_input("[data-testid=raw-input]", "RAW1")
ev("document.querySelector('[data-testid=raw-send]').click()")
time.sleep(0.25)
lg = ev(f"{G}.getLogs().map(e=>e.dir+' | '+e.text)")
ck("کنسول: ارسال دستور آزاد", any(l == "tx | RAW1" for l in lg), lg[-2:])

# تنظیمات: پروفایل + خروجی JSON + اتصال وب‌سوکت
ev("document.querySelector('.tab[data-tab=settings]').click()")
ck("پنل تنظیمات", bool(wait("!!document.querySelector('[data-testid=panel-transport]')")))
ev("document.querySelector('[data-testid=add-profile]').click()")
ck("مودال پروفایل باز شد", bool(wait("document.querySelector('[data-testid=profile-modal]')?.open", 4)))
set_input("[data-testid=prof-name]", "تست ماندگاری")
ev("document.querySelector('[data-testid=prof-save]').click()")
ck("پروفایل دوم ساخته شد", ev("window.__ARDUINO_REMOTE__.store.snapshot().profiles.length") == 2,
   ev("window.__ARDUINO_REMOTE__.store.snapshot().profiles.length"))

# addProfile خودکار پروفایل جدید را فعال می‌کند → باید خالی باشد
ev("document.querySelector('.tab[data-tab=controls]').click()")
ck("پروفایل جدید فعال شد و خالی است", bool(wait("!!document.querySelector('.empty')", 4)), ev("document.querySelectorAll('.ccard').length"))
pid0 = ev("window.__ARDUINO_REMOTE__.store.snapshot().profiles[0].id")
ev("document.querySelector(" + json.dumps("[data-pid='" + pid0 + "']") + ").click()")
ck("برگشت به پروفایل اول: ۴ کنترل", bool(wait("document.querySelectorAll('.ccard').length===4", 4)), ev("document.querySelectorAll('.ccard').length"))
ev("document.querySelector('.tab[data-tab=settings]').click()")

ev("document.querySelector('[data-testid=export-btn]').click()")
exp = ev("document.querySelector('[data-testid=export-text]').value")
ck("خروجی JSON معتبر", bool(exp) and json.loads(exp).get("profiles") and len(json.loads(exp)["profiles"]) == 2, (exp or "")[:80])

# جدا شدن از شبیه‌ساز و وصل شدن به وب‌سوکت اکو (سرور واقعی tests/ws-echo.mjs)
st = ev("document.querySelector('#conn-text').textContent")
if st == "متصل":
    ev("document.querySelector('[data-testid=connect-btn]').click()")
    ck("قطع از شبیه‌ساز", bool(wait("document.querySelector('#conn-text').textContent==='قطع'", 5)), ev("document.querySelector('#conn-text').textContent"))
ev("document.querySelector('[data-testid=panel-transport] [data-kind=websocket]').click()")
ck("ست شدن آدرس سوکت", set_input("[data-testid=ws-url]", "ws://127.0.0.1:8099") == "ok")
ev("document.querySelector('[data-testid=connect-btn]').click()")
ck("اتصال وب‌سوکت واقعی", bool(wait("document.querySelector('#conn-text').textContent==='متصل'", 6)), ev("document.querySelector('#conn-text').textContent"))

# رفت و برگشت واقعی روی سوکت: تغییر کلید اصلی
ev("document.querySelector('.tab[data-tab=controls]').click()")
ck("تب کنترل‌ها: کارت‌ها برگشتند", bool(wait("!!document.querySelector('.ccard [data-testid=toggle-btn]')", 4)))
n_rx = len([l for l in ev(f"{G}.getLogs().map(e=>e.dir)") if l == "rx"])
ev("document.querySelector('.ccard [data-testid=toggle-btn]').click()")
time.sleep(0.5)
lg = ev(f"{G}.getLogs().map(e=>e.dir+' | '+e.text)")
rx = [l.split(" | ", 1)[-1] for l in lg if l.startswith("rx")]
ck("Round-trip وب‌سوکت: اکوی پس از ارسال", len(rx) > n_rx, f"rx_before={n_rx} rx_now={len(rx)} last={rx[-3:]}")

# ماندگاری پس از بارگذاری مجدد (navigate به‌جای eval ریدلوود که باعث شکست context می‌شود)
send("Page.navigate", url=URL)
send("Page.bringToFront")
time.sleep(2.2)
ck("reload: کنترل‌ها برگشتند", bool(wait("document.querySelectorAll('.ccard').length===4", 6)), ev("document.querySelectorAll('.ccard').length"))
ck("reload: پروفایل ماندگار ماند", ev("window.__ARDUINO_REMOTE__.store.snapshot().profiles.length") == 2,
   ev("window.__ARDUINO_REMOTE__.store.snapshot().profiles.length"))
ck("reload: وضعیت کلید ماندگار ماند", ev("window.__ARDUINO_REMOTE__.store.snapshot().profiles[0].controls.find(c=>c.type==='toggle').on") is False,
   ev("window.__ARDUINO_REMOTE__.store.snapshot().profiles[0].controls.find(c=>c.type==='toggle').on"))
ck("reload: اتصال (قطع، چون web‌سوکت بعد از reload خودکار وصل نمی‌شود)", ev("document.querySelector('#conn-text').textContent") in ("قطع", "متصل"), ev("document.querySelector('#conn-text').textContent"))

ck("بدون خطای JS در کل جلسه", ev("window.__appErrors.length") == 0 and ev("window.__pageErrors.length") == 0,
   {"app": ev("window.__appErrors"), "page": ev("window.__pageErrors")})

# ---------- نمای پر برای اسکرین‌شات: وصل شو و کلید بزن ----------
ev("document.querySelector('#conn-pill').click()")
ck("قبل از شات: اتصال دوباره", bool(wait("document.querySelector('#conn-text').textContent==='متصل'", 6)), ev("document.querySelector('#conn-text').textContent"))
ev("document.querySelector('.ccard [data-testid=toggle-btn]').click()")
time.sleep(0.35)

# ---------- اسکرین‌شات موبایل ----------
send("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=2, mobile=True)
time.sleep(0.6)
shot("qa-controls.png")
ev("document.querySelector('.tab[data-tab=settings]').click()")
time.sleep(0.4)
shot("qa-settings.png")
ev("document.querySelector('.tab[data-tab=console]').click()")
time.sleep(0.4)
shot("qa-console.png")
send("Emulation.clearDeviceMetricsOverride")

summary = {
    "total": len(checks),
    "passed": sum(1 for c in checks if c["ok"]),
    "failed": [c["name"] for c in checks if not c["ok"]],
    "shots": SHOT_DIR,
}
print("\nQA_SUMMARY " + json.dumps(summary, ensure_ascii=False), flush=True)
sys.exit(0 if not summary["failed"] else 1)
