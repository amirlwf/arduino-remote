import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { mapSlider, type ControlEvent } from "../lib/commands.ts";
import { store } from "../lib/appState.ts";
import { runControl } from "../lib/runner.ts";
import { toast } from "../lib/toast.ts";
import type {
  Control,
  MomentaryControl,
  SliderControl,
  TextControl,
  ToggleControl,
} from "../lib/types.ts";

interface CardProps {
  ctrl: Control;
  editMode: boolean;
  onEdit: () => void;
}

/** ارسال + گزارش خطا؛ در UI هیچ استثنایی پرتاب نمی‌شود */
async function fire(ctrl: Control, ev: ControlEvent): Promise<void> {
  const r = await runControl(ctrl, ev);
  if (!r.ok && r.error) toast(r.error, "err");
}

export function ControlCard({ ctrl, editMode, onEdit }: CardProps) {
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!confirmDel) return;
    const t = setTimeout(() => setConfirmDel(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDel]);

  return (
    <div className="ccard" style={{ "--accent": ctrl.color } as CSSProperties} data-ctrl-id={ctrl.id}>
      <div className="c-ico-name">
        <span className="c-icon">{ctrl.icon}</span>
        <span className="c-name">{ctrl.name}</span>
      </div>
      <Widget ctrl={ctrl} />
      {editMode && (
        <div className="tools">
          <button type="button" className="btn icon small" aria-label="بالا" onClick={() => store.moveControl(ctrl.id, -1)}>
            ↑
          </button>
          <button type="button" className="btn icon small" aria-label="پایین" onClick={() => store.moveControl(ctrl.id, 1)}>
            ↓
          </button>
          <button type="button" className="btn icon small" aria-label="ویرایش" onClick={onEdit}>
            ✎
          </button>
          <button
            type="button"
            className={"btn icon small" + (confirmDel ? " danger" : "")}
            aria-label="حذف"
            onClick={() => {
              if (!confirmDel) {
                setConfirmDel(true);
                return;
              }
              store.removeControl(ctrl.id);
              toast("کنترل حذف شد", "ok");
            }}
          >
            {confirmDel ? "حذف؟" : "🗑"}
          </button>
        </div>
      )}
    </div>
  );
}

function Widget({ ctrl }: { ctrl: Control }) {
  switch (ctrl.type) {
    case "toggle":
      return <ToggleBtn ctrl={ctrl} />;
    case "momentary":
      return <MomentaryBtn ctrl={ctrl} />;
    case "slider":
      return <SliderW ctrl={ctrl} />;
    case "text":
      return <TextW ctrl={ctrl} />;
  }
}

/* ---------------------------------------------------------- toggle */

function ToggleBtn({ ctrl }: { ctrl: ToggleControl }) {
  const next = !ctrl.on;
  const onClick = () => {
    // خوش‌بینانه اعمال می‌کنیم؛ اگر ارسال شکست خورد وضعیت برمی‌گردد
    store.replaceControl(ctrl.id, { ...ctrl, on: next });
    void runControl(ctrl, { kind: "toggle", on: next }).then((r) => {
      if (!r.ok) {
        store.replaceControl(ctrl.id, { ...ctrl, on: ctrl.on });
        if (r.error) toast(r.error, "err");
      }
    });
  };

  return (
    <button
      type="button"
      className={"tgl" + (ctrl.on ? " on" : "")}
      aria-pressed={ctrl.on}
      aria-label={`${ctrl.name}: ${ctrl.on ? "روشن" : "خاموش"}`}
      data-testid="toggle-btn"
      onClick={onClick}
    >
      {/* آیکن SVG تا به هیچ فونتی وابسته نباشد (گلیف ⏻ روی ویندوز تو فر می‌شود) */}
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" focusable="false">
        <path d="M12 3.5v7.5" />
        <path d="M6.9 6.9a7.5 7.5 0 1 0 10.2 0" />
      </svg>
    </button>
  );
}

/* ---------------------------------------------------------- momentary */

function MomentaryBtn({ ctrl }: { ctrl: MomentaryControl }) {
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);

  const press = (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (heldRef.current) return;
    heldRef.current = true;
    setHeld(true);
    if (typeof navigator.vibrate === "function") navigator.vibrate(15);
    void fire(ctrl, { kind: "press" });
  };

  const release = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    setHeld(false);
    void fire(ctrl, { kind: "release" });
  };

  return (
    <button
      type="button"
      className={"mom" + (held ? " held" : "")}
      data-testid="momentary-btn"
      onPointerDown={press}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {ctrl.icon} نگه دار
    </button>
  );
}

/* ---------------------------------------------------------- slider */

function sliderStep(ctrl: SliderControl): number {
  return Number.isInteger(ctrl.min) && Number.isInteger(ctrl.max) ? 1 : Math.abs(ctrl.max - ctrl.min) / 100;
}

function SliderW({ ctrl }: { ctrl: SliderControl }) {
  const [local, setLocal] = useState(ctrl.value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.currentTarget.value);
    setLocal(v);
    if (ctrl.sendOnRelease) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void fire(ctrl, { kind: "slider", value: v }), 80);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.currentTarget.value);
    setLocal(v);
    store.replaceControl(ctrl.id, { ...ctrl, value: v });
    if (ctrl.sendOnRelease) void fire(ctrl, { kind: "slider", value: v });
  };

  return (
    <div className="sld">
      <div className="val" data-testid="slider-val">
        {mapSlider(ctrl, local)}
      </div>
      <input
        type="range"
        min={ctrl.min}
        max={ctrl.max}
        step={sliderStep(ctrl)}
        value={local}
        aria-label={ctrl.name}
        onInput={onInput}
        onChange={onChange}
      />
    </div>
  );
}

/* ---------------------------------------------------------- text */

function TextW({ ctrl }: { ctrl: TextControl }) {
  const [text, setText] = useState(ctrl.text);

  const send = () => {
    const t = text;
    if (t.trim() === "") return;
    void fire(ctrl, { kind: "send", text: t }).then(() => {
      store.replaceControl(ctrl.id, { ...ctrl, text: t });
    });
  };

  return (
    <div className="txtc">
      <input
        type="text"
        value={text}
        placeholder={ctrl.placeholder}
        aria-label={ctrl.name}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
        }}
      />
      <button type="button" className="btn primary small" aria-label="ارسال" onClick={send}>
        📤
      </button>
    </div>
  );
}
