/**
 * پچ‌های cordova-plugin-bluetooth-serial برای این پروژه — ایدمپوتنت، بدون وابستگی.
 *
 * پچ ۱ — discover gate (اندروید ۱۲+):
 *   باگ: discoverUnpaired روی چک قدیمی ACCESS_COARSE_LOCATION گیر می‌کرد؛ مانیفست این مجوز
 *   را با maxSdkVersion=30 ثبت کرده (روی ۱۲+ اصلاً وجود ندارد) → requestPermission بدون دیالوگ
 *   رد می‌شد → «دسترسی ندارم» با مجوزهای داده‌شده. روی API ≥ 31 از چک می‌پریم و جستجو با
 *   BLUETOOTH_SCAN (درخواستی در MainActivity) انجام می‌شود.
 *
 * پچ ۲ تا ۵ — جفت‌سازی (pair):
 *   اکشن جدید `pair` با BluetoothDevice.createBond (بازتاب) + گیرنده‌ی BOND_STATE_CHANGED،
 *   در www هم متد pair اضافه می‌شود. بدون آن، اتصال به HC-05 جفت‌نشده با
 *   «Unable to connect to device» شکست می‌خورد.
 *
 * اجرا: postinstall و android:sync (زنجیره‌ی npm). هر تکه با نشان خودش شناسایی می‌شود.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const JAVA_TARGETS = [
  path.join(root, "node_modules", "cordova-plugin-bluetooth-serial", "src", "android", "com", "megster", "cordova", "BluetoothSerial.java"),
  path.join(root, "android", "capacitor-cordova-android-plugins", "src", "main", "java", "com", "megster", "cordova", "BluetoothSerial.java"),
];
const WWW_TARGETS = [
  path.join(root, "node_modules/cordova-plugin-bluetooth-serial/www/bluetoothSerial.js"),
  path.join(root, "android/app/src/main/assets/public/plugins/cordova-plugin-bluetooth-serial/www/bluetoothSerial.js"),
];
const SERVICE_TARGETS = [
  path.join(root, "node_modules/cordova-plugin-bluetooth-serial/src/android/com/megster/cordova/BluetoothSerialService.java"),
  path.join(root, "android/capacitor-cordova-android-plugins/src/main/java/com/megster/cordova/BluetoothSerialService.java"),
];

/* ---------------------------------------------- پچ ۱: درِ جستجوی اندروید ۱۲+ */
const P1_OLD = `            if (cordova.hasPermission(ACCESS_COARSE_LOCATION)) {
                discoverUnpairedDevices(callbackContext);
            } else {
                permissionCallback = callbackContext;
                cordova.requestPermission(this, CHECK_PERMISSIONS_REQ_CODE, ACCESS_COARSE_LOCATION);
            }`;

const P1_NEW = `            // PATCH(arduino-remote): Android 12+ (API 31) از BLUETOOTH_SCAN استفاده می‌کند؛
            // ACCESS_COARSE_LOCATION با maxSdkVersion=30 در مانیفست نیست و requestPermission
            // بدون دیالوگ رد می‌شد → خطای «دسترسی ندارم» با مجوزهای داده‌شده.
            if (android.os.Build.VERSION.SDK_INT >= 31 || cordova.hasPermission(ACCESS_COARSE_LOCATION)) {
                discoverUnpairedDevices(callbackContext);
            } else {
                permissionCallback = callbackContext;
                cordova.requestPermission(this, CHECK_PERMISSIONS_REQ_CODE, ACCESS_COARSE_LOCATION);
            }`;

/* ---------------------------------------------- پچ ۲: ثابت اکشن pair */
const P2_OLD = `    private static final String IS_CONNECTED = "isConnected";`;
const P2_NEW = `    private static final String IS_CONNECTED = "isConnected";
    // PATCH(arduino-remote-pair-const)
    private static final String PAIR_DEVICE = "pair";`;

/* ---------------------------------------------- پچ ۳: شاخه‌ی اکشن pair */
const P3_OLD = `        } else if (action.equals(SET_DEVICE_DISCOVERED_LISTENER)) {`;
const P3_NEW = `        } else if (action.equals(PAIR_DEVICE)) {
            // PATCH(arduino-remote-pair-action)
            pairDevice(args.getString(0), callbackContext);
        } else if (action.equals(SET_DEVICE_DISCOVERED_LISTENER)) {`;

/* ---------------------------------------------- پچ ۴: متد pairDevice */
const P4_OLD = `    private void listBondedDevices(CallbackContext callbackContext) throws JSONException {`;
const P4_NEW = `    // PATCH(arduino-remote-pair-method): جفت‌سازی از داخل اپ با createBond (بازتاب — متد @hide)
    // نتیجه از رویداد BOND_STATE_CHANGED می‌آید؛ پنجره‌ی PIN را خود سیستم نشان می‌دهد.
    private void pairDevice(final String address, final CallbackContext callbackContext) {
        final boolean[] done = { false };
        android.content.BroadcastReceiver receiver = null;
        try {
            final BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                callbackContext.success("paired");
                return;
            }
            final android.content.BroadcastReceiver r = new android.content.BroadcastReceiver() {
                @Override
                public void onReceive(android.content.Context context, android.content.Intent intent) {
                    BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (d == null || !address.equalsIgnoreCase(d.getAddress())) {
                        return;
                    }
                    int st = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
                    int prev = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.BOND_NONE);
                    if (st == BluetoothDevice.BOND_BONDED) {
                        finish("paired");
                    } else if (st == BluetoothDevice.BOND_NONE && prev == BluetoothDevice.BOND_BONDING) {
                        finish(null);
                    }
                }

                private void finish(String result) {
                    if (done[0]) {
                        return;
                    }
                    done[0] = true;
                    try { cordova.getActivity().unregisterReceiver(this); } catch (Exception ignored) { }
                    if (result != null) {
                        callbackContext.success(result);
                    } else {
                        callbackContext.error("pairing-cancelled");
                    }
                }
            };
            receiver = r;
            cordova.getActivity().registerReceiver(r, new android.content.IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED));
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (done[0]) {
                        return;
                    }
                    done[0] = true;
                    try { cordova.getActivity().unregisterReceiver(r); } catch (Exception ignored) { }
                    callbackContext.error("pair-timeout");
                }
            }, 60000);
            java.lang.reflect.Method m = device.getClass().getMethod("createBond");
            if (!Boolean.TRUE.equals(m.invoke(device))) {
                if (!done[0]) {
                    done[0] = true;
                    try { cordova.getActivity().unregisterReceiver(r); } catch (Exception ignored) { }
                    callbackContext.error("createBond-rejected");
                }
            }
        } catch (Exception e) {
            if (receiver != null) {
                try { cordova.getActivity().unregisterReceiver(receiver); } catch (Exception ignored) { }
            }
            if (!done[0]) {
                done[0] = true;
                callbackContext.error("pair-error: " + e.getMessage());
            }
        }
    }

    private void listBondedDevices(CallbackContext callbackContext) throws JSONException {`;

/* ---------------------------------------------- پچ ۵: متد www */
const P5_OLD = `    // Android only - see http://goo.gl/1mFjZY
    connectInsecure: function (macAddress, success, failure) {
        cordova.exec(success, failure, "BluetoothSerial", "connectInsecure", [macAddress]);
    },`;
const P5_NEW = `    // Android only - see http://goo.gl/1mFjZY
    connectInsecure: function (macAddress, success, failure) {
        cordova.exec(success, failure, "BluetoothSerial", "connectInsecure", [macAddress]);
    },

    // PATCH(arduino-remote-pair-www): جفت‌سازی (createBond) — پنجره‌ی PIN سیستم
    pair: function (macAddress, success, failure) {
        cordova.exec(success, failure, "BluetoothSerial", "pair", [macAddress]);
    },`;

const PATCHES = [
  { id: "discover-12", marker: "PATCH(arduino-remote): Android 12+", old: P1_OLD, new: P1_NEW, targets: JAVA_TARGETS },
  { id: "pair-const", marker: "PATCH(arduino-remote-pair-const)", old: P2_OLD, new: P2_NEW, targets: JAVA_TARGETS },
  { id: "pair-action", marker: "PATCH(arduino-remote-pair-action)", old: P3_OLD, new: P3_NEW, targets: JAVA_TARGETS },
  { id: "pair-method", marker: "PATCH(arduino-remote-pair-method)", old: P4_OLD, new: P4_NEW, targets: JAVA_TARGETS },
  { id: "pair-www", marker: "PATCH(arduino-remote-pair-www)", old: P5_OLD, new: P5_NEW, targets: WWW_TARGETS },

  /* پچ ۶ — دیاگ: دلیل واقعی شکست connect را تا JS بکشان (لاگکت‌کت در دسترس کاربر نیست) */
  {
    id: "diag-field",
    marker: "PATCH(arduino-remote-diag-field)",
    old: `    // Debugging
    private static final String TAG = "BluetoothSerialService";
    private static final boolean D = true;`,
    new: `    // Debugging
    private static final String TAG = "BluetoothSerialService";
    private static final boolean D = true;
    // PATCH(arduino-remote-diag-field): دلیل واقعی شکست اتصال — در کنسول اپ نمایش داده می‌شود
    public static volatile String lastConnectError = null;`,
    targets: SERVICE_TARGETS,
  },
  {
    id: "diag-toast",
    marker: "PATCH(arduino-remote-diag-toast)",
    old: `        bundle.putString(BluetoothSerial.TOAST, "Unable to connect to device");`,
    new: `        // PATCH(arduino-remote-diag-toast): پیام خام استثنا را هم بفرست
        bundle.putString(BluetoothSerial.TOAST, "Unable to connect to device"
            + (lastConnectError != null ? (": " + lastConnectError) : ""));`,
    targets: SERVICE_TARGETS,
  },
  {
    id: "diag-io",
    marker: "PATCH(arduino-remote-diag-io)",
    old: `            } catch (IOException e) {
                Log.e(TAG, e.toString());

                // Some 4.1 devices have problems, try an alternative way to connect`,
    new: `            } catch (IOException e) {
                Log.e(TAG, e.toString());
                lastConnectError = e.toString(); // PATCH(arduino-remote-diag-io)

                // Some 4.1 devices have problems, try an alternative way to connect`,
    targets: SERVICE_TARGETS,
  },
  {
    id: "diag-e2",
    marker: "PATCH(arduino-remote-diag-e2)",
    old: `                } catch (Exception e2) {
                    Log.e(TAG, "Couldn't establish a Bluetooth connection.");`,
    new: `                } catch (Exception e2) {
                    Log.e(TAG, "Couldn't establish a Bluetooth connection.");
                    lastConnectError = e2.toString(); // PATCH(arduino-remote-diag-e2)`,
    targets: SERVICE_TARGETS,
  },

  /* پچ ۷ — بازسازی جفت (v2): جفت کهنه را removeBond بزن و تازه جفت کن
     دلیل: java.io.IOException: read failed = کلید ناهماهنگ (link-key desync) */
  {
    id: "pair-v2-a",
    marker: "PATCH(arduino-remote-pair-method-v2-a)",
    old: `    private void pairDevice(final String address, final CallbackContext callbackContext) {
        final boolean[] done = { false };
        android.content.BroadcastReceiver receiver = null;
        try {
            final BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                callbackContext.success("paired");
                return;
            }`,
    new: `    private void pairDevice(final String address, final CallbackContext callbackContext) {
        // PATCH(arduino-remote-pair-method-v2-a): جفت کهنه اول removeBond می‌شود (رفع read failed)
        final boolean[] done = { false };
        final String[] stage = { "bond" };
        android.content.BroadcastReceiver receiver = null;
        try {
            final BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);`,
    targets: JAVA_TARGETS,
  },
  {
    id: "pair-v2-b",
    marker: "PATCH(arduino-remote-pair-method-v2-b)",
    old: `                    int st = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
                    int prev = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.BOND_NONE);
                    if (st == BluetoothDevice.BOND_BONDED) {
                        finish("paired");
                    } else if (st == BluetoothDevice.BOND_NONE && prev == BluetoothDevice.BOND_BONDING) {
                        finish(null);
                    }`,
    new: `                    int st = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
                    int prev = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.BOND_NONE);
                    // PATCH(arduino-remote-pair-method-v2-b): مرحله‌ی unbond → بعد createBond
                    if ("unbond".equals(stage[0])) {
                        if (st == BluetoothDevice.BOND_NONE) {
                            stage[0] = "bond";
                            try {
                                java.lang.reflect.Method mb = device.getClass().getMethod("createBond");
                                if (!Boolean.TRUE.equals(mb.invoke(device))) {
                                    finish("pair-error: createBond rejected after removeBond");
                                }
                            } catch (Exception ex) {
                                finish("pair-error: " + ex.getMessage());
                            }
                        }
                        return;
                    }
                    if (st == BluetoothDevice.BOND_BONDED) {
                        finish("paired");
                    } else if (st == BluetoothDevice.BOND_NONE && prev == BluetoothDevice.BOND_BONDING) {
                        finish(null);
                    }`,
    targets: JAVA_TARGETS,
  },
  {
    id: "pair-v2-c",
    marker: "PATCH(arduino-remote-pair-method-v2-c)",
    old: `            java.lang.reflect.Method m = device.getClass().getMethod("createBond");
            if (!Boolean.TRUE.equals(m.invoke(device))) {
                if (!done[0]) {
                    done[0] = true;
                    try { cordova.getActivity().unregisterReceiver(r); } catch (Exception ignored) { }
                    callbackContext.error("createBond-rejected");
                }
            }`,
    new: `            // PATCH(arduino-remote-pair-method-v2-c): جفت کهنه؟ اول حذف، بعد جفت تازه
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                stage[0] = "unbond";
                java.lang.reflect.Method rm = device.getClass().getMethod("removeBond");
                if (!Boolean.TRUE.equals(rm.invoke(device))) {
                    stage[0] = "bond";
                    if (!done[0]) {
                        done[0] = true;
                        try { cordova.getActivity().unregisterReceiver(r); } catch (Exception ignored) { }
                        callbackContext.success("paired");
                    }
                }
            } else {
                java.lang.reflect.Method m = device.getClass().getMethod("createBond");
                if (!Boolean.TRUE.equals(m.invoke(device))) {
                    if (!done[0]) {
                        done[0] = true;
                        try { cordova.getActivity().unregisterReceiver(r); } catch (Exception ignored) { }
                        callbackContext.error("createBond-rejected");
                    }
                }
            }`,
    targets: JAVA_TARGETS,
  },
];

let patched = 0;
let already = 0;
let missing = 0;

for (const p of PATCHES) {
  for (const file of p.targets) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    if (src.includes(p.marker)) {
      already++;
      continue;
    }
    if (!src.includes(p.old)) {
      console.error(`bt-plugin patch [${p.id}]: الگو پیدا نشد (پلاگین به‌روز شده؟): ${file}`);
      missing++;
      process.exitCode = 1;
      continue;
    }
    fs.writeFileSync(file, src.replace(p.old, p.new), "utf8");
    patched++;
  }
}

console.log(`bt-plugin patch: ${patched} patched, ${already} already, ${missing} missing`);
