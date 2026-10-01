#!/usr/bin/env node
/**
 * خط لوله‌ی APK اندروید: gradle assembleRelease → امضا → verify → چک محتوا.
 *
 * نکته‌ی مهم: مسیر پروژه فاصله دارد («My Sweet») —
 * برای همین همه‌چیز با shell:false اجرا می‌شود تا آرگومان‌ها بشکنند/قلاب نشوند؛
 * به‌جای apksigner.bat هم از apksigner.jar با java استفاده می‌شود.
 *
 * اجرا:  npm run android:release   (یا مستقیم: node scripts/android-release.mjs)
 * پیش‌نیاز: JAVA_HOME و ANDROID_HOME
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const JAVA_HOME = process.env.JAVA_HOME || "C:/Users/My Sweet/toolchain/jdk17.0.20_10";
const ANDROID_HOME = process.env.ANDROID_HOME || "C:/Users/My Sweet/android-sdk";
const BUILD_TOOLS = process.env.BUILD_TOOLS || path.join(ANDROID_HOME, "build-tools", "34.0.0");
const KS = path.join(root, "release.keystore");
const KS_ALIAS = "arduremote";
const KS_PASS = "arduremote2026";

const env = { ...process.env, JAVA_HOME, ANDROID_HOME };

function run(cmd, args, opts = {}) {
  console.log(`\n>> ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit", shell: false, ...opts });
  if (res.error) {
    console.error("FAILED:", res.error.message);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`FAILED (exit ${res.status}): ${cmd}`);
    process.exit(res.status ?? 1);
  }
}

/* ۱) بررسی پیش‌نیاز‌ها */
if (!fs.existsSync(path.join(JAVA_HOME, "bin", "java.exe"))) {
  console.error("JAVA_HOME نامعتبر است:", JAVA_HOME);
  process.exit(1);
}
if (!fs.existsSync(path.join(ANDROID_HOME, "platforms"))) {
  console.error("ANDROID_HOME نامعتبر است:", ANDROID_HOME);
  process.exit(1);
}
if (!fs.existsSync(path.join(root, "android", "gradlew.bat"))) {
  console.error("پروژه‌ی android/ هنوز ساخته نشده — اول: npx cap add android");
  process.exit(1);
}
const apksignerJar = path.join(BUILD_TOOLS, "lib", "apksigner.jar");
if (!fs.existsSync(apksignerJar)) {
  console.error("apksigner.jar پیدا نشد:", apksignerJar);
  process.exit(1);
}
const java = path.join(JAVA_HOME, "bin", "java.exe");
/* tar سیستم‌عامل (bsdtar) zip می‌خواند؛ tar گیت‌بش GNU است و نمی‌خواند */
const TAR = process.platform === "win32" ? "C:/Windows/System32/tar.exe" : "tar";

/* ۲) ساخت keystore در صورت نبود */
if (!fs.existsSync(KS)) {
  run(path.join(JAVA_HOME, "bin", "keytool.exe"), [
    "-genkeypair",
    "-v",
    "-keystore", KS,
    "-alias", KS_ALIAS,
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-validity", "10950",
    "-storepass", KS_PASS,
    "-keypass", KS_PASS,
    "-dname", "CN=Arduino Remote, OU=amirlwf, O=amirlwf, C=IR",
  ]);
}

/* ۳) بیلد release
 * اجرای مستقیم .bat با shell:false در Node اخیر EINVAL می‌دهد (CVE-2024-27980)،
 * و shell:true مسیرِ دارای فاصله را می‌شکند — پس wrapper را از خود jar بالا می‌آوریم:
 * دقیقاً همان کاری که gradlew.bat می‌کند. */
run(
  path.join(JAVA_HOME, "bin", "java.exe"),
  [
    "-classpath", path.join(root, "android", "gradle", "wrapper", "gradle-wrapper.jar"),
    "org.gradle.wrapper.GradleWrapperMain",
    "assembleRelease",
  ],
  { cwd: path.join(root, "android") },
);

/* ۴) امضا */
const unsigned = path.join(root, "android", "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk");
if (!fs.existsSync(unsigned)) {
  console.error("APK خام پیدا نشد:", unsigned);
  process.exit(1);
}
fs.mkdirSync(path.join(root, "releases"), { recursive: true });
const outApk = path.join(root, "releases", `ArduinoRemote-v${pkg.version}.apk`);
run(java, [
  "-jar", apksignerJar,
  "sign",
  "--ks", KS,
  "--ks-pass", `pass:${KS_PASS}`,
  "--key-pass", `pass:${KS_PASS}`,
  "--out", outApk,
  unsigned,
]);

/* ۵) verify */
run(java, ["-jar", apksignerJar, "verify", outApk]);

/* ۶) چک محتوا: کد واقعی اپ باید داخل APK باشد (tar ویندوز zip را هم می‌خواند) */
const unzipTest = spawnSync(TAR, ["-xOf", outApk, "assets/public/index.html"], { encoding: "utf8" });
const html = unzipTest.stdout || "";
if (unzipTest.status !== 0 || !html.includes("Arduino Remote")) {
  console.error("محتوای داخل APK بررسی نشد (index.html) — بیلد را دوباره بساز");
  console.error((unzipTest.stderr || "").toString().slice(0, 400));
  process.exit(1);
}
const jsList = spawnSync(TAR, ["-tf", outApk], { encoding: "utf8" });
const hasJs = (jsList.stdout || "").split("\n").some((l) => /assets\/public\/assets\/index-.*\.js/.test(l));
if (!hasJs) {
  console.error("فایل JS اپ داخل APK نیست!");
  process.exit(1);
}

console.log(`\nAPK_READY=${outApk}`);
