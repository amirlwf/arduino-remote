import { useEffect, useState, type ReactNode } from "react";
import { toggleConnection } from "./lib/connectAction.ts";
import { getManager } from "./lib/connection.ts";
import { logAppend } from "./lib/log.ts";
import type { ConnectionStatus } from "./lib/transports/transport.ts";
import { ConsoleView } from "./ui/ConsoleView.tsx";
import { ControlsView } from "./ui/ControlsView.tsx";
import { SettingsView } from "./ui/SettingsView.tsx";
import { Toasts } from "./ui/Toasts.tsx";

type Tab = "controls" | "console" | "settings";

/** آیکن تب به‌صورت SVG — رندر قطعی روی همه‌ی دستگاه‌ها، بدون وابستگی به فونت ایموجی */
function TabSvg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const TABS: Array<{ id: Tab; icon: ReactNode; label: string }> = [
  {
    id: "controls",
    label: "کنترل‌ها",
    icon: (
      <TabSvg>
        <path d="M4 7.5h5.5" />
        <circle cx="12.5" cy="7.5" r="2.4" />
        <path d="M15.5 7.5H20" />
        <path d="M4 16.5h3" />
        <circle cx="10" cy="16.5" r="2.4" />
        <path d="M13 16.5h7" />
      </TabSvg>
    ),
  },
  {
    id: "console",
    label: "کنسول",
    icon: (
      <TabSvg>
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <path d="M7.5 10l3 2.5-3 2.5" />
        <path d="M13 15.5h4" />
      </TabSvg>
    ),
  },
  {
    id: "settings",
    label: "تنظیمات",
    icon: (
      <TabSvg>
        <circle cx="12" cy="12" r="3.1" />
        <path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9" />
      </TabSvg>
    ),
  },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("controls");
  const [conn, setConn] = useState<{ status: ConnectionStatus; detail: string }>({
    status: "disconnected",
    detail: "",
  });

  useEffect(() => {
    const mgr = getManager();
    const offStatus = mgr.on("status", (status, detail) => setConn({ status, detail }));
    const offData = mgr.on("data", (text) => logAppend("rx", text));
    return () => {
      offStatus();
      offData();
    };
  }, []);

  const pillText =
    conn.status === "connected"
      ? "متصل"
      : conn.status === "connecting"
        ? "در حال اتصال…"
        : conn.status === "error"
          ? "خطا"
          : "قطع";

  return (
    <>
      <header className="appbar">
        <div className="brand">
          <span className="logo">◉</span>
          <span className="brand-name">Arduino&nbsp;Remote</span>
        </div>
        <button
          id="conn-pill"
          type="button"
          className={`pill ${conn.status}`}
          data-status={conn.status}
          title={conn.detail}
          aria-label={`وضعیت اتصال: ${pillText}`}
          onClick={() => void toggleConnection()}
        >
          <span className="dot" />
          <span id="conn-text">{pillText}</span>
        </button>
      </header>

      <main className="view">
        {tab === "controls" && <ControlsView />}
        {tab === "console" && <ConsoleView />}
        {tab === "settings" && <SettingsView />}
      </main>

      <nav className="tabbar" role="tablist" aria-label="ناوبری اصلی">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-tab={t.id}
            className={"tab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-ico">{t.icon}</span>
            <span className="tab-lbl">{t.label}</span>
          </button>
        ))}
      </nav>

      <Toasts />
    </>
  );
}
