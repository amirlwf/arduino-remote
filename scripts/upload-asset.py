#!/usr/bin/env python3
"""تلاش مجدد آپلود asset ریلیز — وقتی uploads.github.com قطع می‌کند.

خروجی را در stdout می‌نویسد؛ پس از موفقیت readback نهایی می‌گیرد.
"""
import json, subprocess, time, socket, urllib.request

socket.setdefaulttimeout(45)

out = subprocess.run(["git", "credential", "fill"],
                     input="protocol=https\nhost=github.com\n\n",
                     capture_output=True, text=True, timeout=20)
pw = None
for line in (out.stdout or "").splitlines():
    if line.startswith("password="):
        pw = line.split("=", 1)[1].strip()
if not pw:
    print("NO_TOKEN", flush=True)
    raise SystemExit(1)

API = "https://api.github.com"

def get_json(url, timeout=40):
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + pw,
        "Accept": "application/vnd.github+json",
        "User-Agent": "hermes"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

APK = r"A:\ai-secure\hermes-agent\arduino-remote\releases\ArduinoRemote-v1.0.2.apk"
raw = open(APK, "rb").read()
print("apk bytes:", len(raw), flush=True)

for attempt in range(40):
    try:
        rel = get_json(API + "/repos/amirlwf/arduino-remote/releases/tags/v1.0.2")
        assets = rel.get("assets", [])
        if assets and any(a.get("state") == "uploaded" for a in assets):
            print("ALREADY:", [(a["name"], a["size"]) for a in assets], flush=True)
            raise SystemExit(0)
        up_url = rel["upload_url"].split("{", 1)[0]
    except SystemExit:
        raise
    except Exception as e:
        print(f"[{attempt}] rel-fetch failed: {type(e).__name__} {str(e)[:80]}", flush=True)
        time.sleep(8)
        continue

    try:
        req = urllib.request.Request(up_url + "?name=ArduinoRemote-v1.0.2.apk", data=raw, method="POST",
            headers={"Authorization": "Bearer " + pw,
                     "Content-Type": "application/vnd.android.package-archive",
                     "Accept": "application/vnd.github+json",
                     "User-Agent": "hermes",
                     "Connection": "close"})
        with urllib.request.urlopen(req, timeout=90) as r:
            resp = json.loads(r.read().decode("utf-8"))
        print("UPLOADED:", resp.get("state"), resp.get("size"), flush=True)
        final = get_json(API + "/repos/amirlwf/arduino-remote/releases/tags/v1.0.2")
        print("READBACK:", [(a["name"], a["size"], a["state"]) for a in final.get("assets", [])], flush=True)
        raise SystemExit(0)
    except SystemExit:
        raise
    except Exception as e:
        print(f"[{attempt}] upload failed: {type(e).__name__} {str(e)[:90]}", flush=True)
        time.sleep(12)

print("GIVE_UP_AFTER_40", flush=True)
raise SystemExit(2)
