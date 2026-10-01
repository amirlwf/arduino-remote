import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles.css";
import { getManager } from "./lib/connection.ts";
import { getLogs } from "./lib/log.ts";
import { getStore } from "./lib/store.ts";

const el = document.getElementById("root");
if (!el) throw new Error("#root یافت نشد");

// جمع‌آوری خطاهای رانتایم برای تست مرورگری (هیچ خطایی نباید اینجا بنشیند)
const appErrors: string[] = [];
(window as unknown as Record<string, unknown>).__appErrors = appErrors;
window.addEventListener("error", (e) => appErrors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => appErrors.push(String(e.reason)));

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// هوک عیب‌یابی برای تست مرورگری و کنسول توسعه‌دهنده
(window as unknown as Record<string, unknown>).__ARDUINO_REMOTE__ = {
  store: getStore(),
  manager: getManager(),
  getLogs,
};

// PWA فقط روی http/https — داخل وب‌ویوی کپاسیتور ثبت نمی‌شود
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}
