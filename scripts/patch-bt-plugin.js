/**
 * پچ cordova-plugin-bluetooth-serial برای اندروید ۱۲+ (API 31):
 *
 * باگ: discoverUnpaired روی چک قدیمی ACCESS_COARSE_LOCATION گیر می‌کند.
 * مانیفست اپ این مجوز را با maxSdkVersion=30 ثبت کرده (روی ۱۲+ اصلاً وجود ندارد) →
 * requestPermission سیستم فوراً و بدون دیالوگ رد می‌کند → کاربر با وجود مجوز
 * «دستگاه‌های اطراف» (BLUETOOTH_SCAN) پیام «دسترسی ندارم» می‌گیرد.
 *
 * درمان: روی API ≥ 31 از چک موقعیت بپریم — جستجو با BLUETOOTH_SCAN که
 * MainActivity درخواست می‌کند و manifest با neverForLocation ثبت کرده انجام می‌شود.
 *
 * ایدمپوتنت: اگر «PATCH(arduino-remote)» را دید دست نمی‌زند.
 * هم فایل node_modules و هم کپی پروژه‌ی android/ را پچ می‌کند.
 * اجرا: postinstall و android:sync (زنجیره‌ی npm)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const REL_SRC = path.join("src", "android", "com", "megster", "cordova", "BluetoothSerial.java");
const REL_APP = path.join("android", "capacitor-cordova-android-plugins", "src", "main", "java", "com", "megster", "cordova", "BluetoothSerial.java");

const OLD = `            if (cordova.hasPermission(ACCESS_COARSE_LOCATION)) {
                discoverUnpairedDevices(callbackContext);
            } else {
                permissionCallback = callbackContext;
                cordova.requestPermission(this, CHECK_PERMISSIONS_REQ_CODE, ACCESS_COARSE_LOCATION);
            }`;

const NEW = `            // PATCH(arduino-remote): Android 12+ (API 31) از BLUETOOTH_SCAN استفاده می‌کند؛
            // ACCESS_COARSE_LOCATION با maxSdkVersion=30 در مانیفست نیست و requestPermission
            // بدون دیالوگ رد می‌شد → خطای «دسترسی ندارم» با مجوزهای داده‌شده.
            if (android.os.Build.VERSION.SDK_INT >= 31 || cordova.hasPermission(ACCESS_COARSE_LOCATION)) {
                discoverUnpairedDevices(callbackContext);
            } else {
                permissionCallback = callbackContext;
                cordova.requestPermission(this, CHECK_PERMISSIONS_REQ_CODE, ACCESS_COARSE_LOCATION);
            }`;

const MARK = "PATCH(arduino-remote)";
const targets = [path.join(root, "node_modules", "cordova-plugin-bluetooth-serial", REL_SRC), path.join(root, REL_APP)];

let patched = 0;
let already = 0;
let missing = 0;

for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(MARK)) {
    already++;
    continue;
  }
  if (!src.includes(OLD)) {
    console.error(`bt-plugin patch: الگو پیدا نشد (پلاگین به‌روز شده؟): ${file}`);
    missing++;
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(file, src.replace(OLD, NEW), "utf8");
  patched++;
}

console.log(`bt-plugin patch: ${patched} patched, ${already} already, ${missing} missing`);
