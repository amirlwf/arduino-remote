import { useEffect, useRef, useState } from "react";
import { sliderTemplateError } from "../lib/commands.ts";
import { store } from "../lib/appState.ts";
import { COLORS, SUFFIXES, newId } from "../lib/storage.ts";
import { toast } from "../lib/toast.ts";
import {
  CONTROL_TYPE_ICONS,
  CONTROL_TYPE_LABELS,
  type Control,
  type ControlType,
  type Suffix,
} from "../lib/types.ts";

export type ModalState = { mode: "add" } | { mode: "edit"; ctrl: Control } | null;

interface FormState {
  type: ControlType;
  name: string;
  icon: string;
  color: string;
  suffix: Suffix;
  onPayload: string;
  offPayload: string;
  on: boolean;
  pressPayload: string;
  releasePayload: string;
  template: string;
  min: string;
  max: string;
  outMin: string;
  outMax: string;
  sendOnRelease: boolean;
  placeholder: string;
}

const DEFAULT_ICON: Record<ControlType, string> = {
  toggle: "💡",
  momentary: "🔔",
  slider: "⚡",
  text: "🎛️",
};

const TYPE_ORDER: ControlType[] = ["toggle", "momentary", "slider", "text"];

function emptyForm(type: ControlType): FormState {
  return {
    type,
    name: "",
    icon: DEFAULT_ICON[type],
    color: COLORS[0],
    suffix: "",
    onPayload: "1",
    offPayload: "0",
    on: false,
    pressPayload: "H",
    releasePayload: "",
    template: "V{v}",
    min: "0",
    max: "100",
    outMin: "0",
    outMax: "255",
    sendOnRelease: false,
    placeholder: "مثلاً: P",
  };
}

function formOf(ctrl: Control): FormState {
  const f = emptyForm(ctrl.type);
  f.name = ctrl.name;
  f.icon = ctrl.icon;
  f.color = ctrl.color;
  f.suffix = ctrl.suffix;
  if (ctrl.type === "toggle") {
    f.onPayload = ctrl.onPayload;
    f.offPayload = ctrl.offPayload;
    f.on = ctrl.on;
  } else if (ctrl.type === "momentary") {
    f.pressPayload = ctrl.pressPayload;
    f.releasePayload = ctrl.releasePayload;
  } else if (ctrl.type === "slider") {
    f.template = ctrl.template;
    f.min = String(ctrl.min);
    f.max = String(ctrl.max);
    f.outMin = String(ctrl.outMin);
    f.outMax = String(ctrl.outMax);
    f.sendOnRelease = ctrl.sendOnRelease;
  } else {
    f.placeholder = ctrl.placeholder;
  }
  return f;
}

const parseNum = (s: string): number => (s.trim() === "" ? NaN : Number(s.trim()));

type BuildResult = { ok: true; ctrl: Control } | { ok: false; error: string };

function buildControl(f: FormState, id: string, prev?: Control): BuildResult {
  const name = f.name.trim();
  if (name === "") return { ok: false, error: "نام کنترل را بنویس" };

  const base = {
    id,
    name,
    icon: f.icon.trim() || DEFAULT_ICON[f.type],
    color: f.color,
    suffix: f.suffix,
  };

  switch (f.type) {
    case "toggle": {
      if (f.onPayload.trim() === "" && f.offPayload.trim() === "") {
        return { ok: false, error: "دستور «روشن» یا «خاموش» نباید خالی باشد" };
      }
      return {
        ok: true,
        ctrl: { ...base, type: "toggle", onPayload: f.onPayload, offPayload: f.offPayload, on: f.on },
      };
    }
    case "momentary": {
      if (f.pressPayload.trim() === "") return { ok: false, error: "دستور هنگام فشردن خالی است" };
      return {
        ok: true,
        ctrl: {
          ...base,
          type: "momentary",
          pressPayload: f.pressPayload,
          releasePayload: f.releasePayload,
        },
      };
    }
    case "slider": {
      const te = sliderTemplateError(f.template.trim());
      if (te) return { ok: false, error: te };
      const min = parseNum(f.min);
      const max = parseNum(f.max);
      const outMin = parseNum(f.outMin);
      const outMax = parseNum(f.outMax);
      if (![min, max, outMin, outMax].every(Number.isFinite)) {
        return { ok: false, error: "همه‌ی بازه‌ها باید عدد باشند" };
      }
      if (min === max) return { ok: false, error: "حداقل و حداکثر نباید یکسان باشند" };
      let value = min;
      if (prev && prev.type === "slider" && prev.value >= Math.min(min, max) && prev.value <= Math.max(min, max)) {
        value = prev.value;
      }
      return {
        ok: true,
        ctrl: {
          ...base,
          type: "slider",
          template: f.template.trim(),
          min,
          max,
          outMin,
          outMax,
          value,
          sendOnRelease: f.sendOnRelease,
        },
      };
    }
    case "text": {
      const prevText = prev && prev.type === "text" ? prev.text : "";
      return {
        ok: true,
        ctrl: {
          ...base,
          type: "text",
          placeholder: f.placeholder.trim() || "متن را بنویس",
          text: prevText,
        },
      };
    }
  }
}

export function ControlModal({ state, onClose }: { state: ModalState; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<FormState>(() => (state?.mode === "edit" ? formOf(state.ctrl) : emptyForm("toggle")));
  const [err, setErr] = useState("");

  useEffect(() => {
    setForm(state?.mode === "edit" ? formOf(state.ctrl) : emptyForm("toggle"));
    setErr("");
  }, [state]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (state && !d.open) d.showModal();
    else if (!state && d.open) d.close();
  }, [state]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const save = () => {
    if (!state) return;
    const res = buildControl(form, state.mode === "edit" ? state.ctrl.id : newId(), state.mode === "edit" ? state.ctrl : undefined);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    if (state.mode === "add") {
      store.addControl(res.ctrl);
      toast("کنترل اضافه شد", "ok");
    } else {
      store.replaceControl(state.ctrl.id, res.ctrl);
      toast("ذخیره شد", "ok");
    }
    onClose();
  };

  const editing = state?.mode === "edit";

  return (
    <dialog
      ref={ref}
      className="modal"
      data-testid="control-modal"
      onClose={() => {
        if (state) onClose();
      }}
    >
      <div className="m-head">
        <h3>{editing ? "ویرایش کنترل" : "کنترل جدید"}</h3>
        <button type="button" className="m-close" aria-label="بستن" onClick={() => onClose()}>
          ✕
        </button>
      </div>

      <div className="m-body">
        {!editing && (
          <div className="field">
            <label>نوع کنترل</label>
            <div className="type-grid" data-testid="type-grid">
              {TYPE_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-type={t}
                  className={form.type === t ? "sel" : ""}
                  onClick={() =>
                    set({
                      type: t,
                      icon: form.icon === DEFAULT_ICON[form.type] ? DEFAULT_ICON[t] : form.icon,
                    })
                  }
                >
                  <span className="ti">{CONTROL_TYPE_ICONS[t]}</span>
                  {CONTROL_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field row">
          <div>
            <label>نام</label>
            <input
              type="text"
              value={form.name}
              placeholder="مثلاً: چراغ اتاق"
              data-testid="ctrl-name"
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div style={{ maxWidth: 96 }}>
            <label>آیکن</label>
            <input
              type="text"
              value={form.icon}
              maxLength={4}
              aria-label="آیکن"
              onChange={(e) => set({ icon: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label>رنگ</label>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={"swatch" + (form.color === c ? " sel" : "")}
                style={{ background: c }}
                aria-label={`رنگ ${c}`}
                onClick={() => set({ color: c })}
              />
            ))}
          </div>
        </div>

        {form.type === "toggle" && (
          <>
            <div className="field row">
              <div>
                <label>دستور روشن (on)</label>
                <input
                  type="text"
                  value={form.onPayload}
                  dir="ltr"
                  data-testid="on-payload"
                  onChange={(e) => set({ onPayload: e.target.value })}
                />
              </div>
              <div>
                <label>دستور خاموش (off)</label>
                <input
                  type="text"
                  value={form.offPayload}
                  dir="ltr"
                  data-testid="off-payload"
                  onChange={(e) => set({ offPayload: e.target.value })}
                />
              </div>
            </div>
            <label className="check-line">
              <input type="checkbox" checked={form.on} onChange={(e) => set({ on: e.target.checked })} />
              وضعیت اولیه: روشن
            </label>
          </>
        )}

        {form.type === "momentary" && (
          <div className="field row">
            <div>
              <label>هنگام فشردن</label>
              <input
                type="text"
                value={form.pressPayload}
                dir="ltr"
                data-testid="press-payload"
                onChange={(e) => set({ pressPayload: e.target.value })}
              />
            </div>
            <div>
              <label>هنگام رها کردن (اختیاری)</label>
              <input
                type="text"
                value={form.releasePayload}
                dir="ltr"
                data-testid="release-payload"
                onChange={(e) => set({ releasePayload: e.target.value })}
              />
            </div>
          </div>
        )}

        {form.type === "slider" && (
          <>
            <div className="field">
              <label>الگوی دستور — {`{v}`} با مقدار جایگزین می‌شود</label>
              <input
                type="text"
                value={form.template}
                dir="ltr"
                data-testid="template"
                onChange={(e) => set({ template: e.target.value })}
              />
              <div className="hint">مثال: خروجی ۰-۲۵۵ با نمایش ۰-۱۰۰ ← الگوی V{`{v}`} و بازه‌ی خروجی ۰ تا ۲۵۵</div>
            </div>
            <div className="field row">
              <div>
                <label>حداقل نمایش</label>
                <input type="number" value={form.min} dir="ltr" data-testid="s-min" onChange={(e) => set({ min: e.target.value })} />
              </div>
              <div>
                <label>حداکثر نمایش</label>
                <input type="number" value={form.max} dir="ltr" data-testid="s-max" onChange={(e) => set({ max: e.target.value })} />
              </div>
            </div>
            <div className="field row">
              <div>
                <label>حداقل خروجی</label>
                <input type="number" value={form.outMin} dir="ltr" data-testid="s-outmin" onChange={(e) => set({ outMin: e.target.value })} />
              </div>
              <div>
                <label>حداکثر خروجی</label>
                <input type="number" value={form.outMax} dir="ltr" data-testid="s-outmax" onChange={(e) => set({ outMax: e.target.value })} />
              </div>
            </div>
            <label className="check-line">
              <input
                type="checkbox"
                checked={form.sendOnRelease}
                onChange={(e) => set({ sendOnRelease: e.target.checked })}
              />
              فقط هنگام رها کردن ارسال شود (جلوگیری از سیل دستور)
            </label>
          </>
        )}

        {form.type === "text" && (
          <div className="field">
            <label>متن راهنمای جعبه</label>
            <input
              type="text"
              value={form.placeholder}
              onChange={(e) => set({ placeholder: e.target.value })}
            />
          </div>
        )}

        <div className="field">
          <label>کاراکتر انتهای دستور</label>
          <div className="seg">
            {SUFFIXES.map((s, i) => (
              <button
                key={i}
                type="button"
                className={form.suffix === s ? "sel" : ""}
                data-testid={`suffix-${i}`}
                onClick={() => set({ suffix: s })}
              >
                {s === "" ? "بدون" : s === "\n" ? "\\n" : "\\r\\n"}
              </button>
            ))}
          </div>
          <div className="hint">اسکچ‌هایی که با Serial.parseInt کار می‌کنند معمولاً «بدون» می‌خواهند.</div>
        </div>

        <div className="err-line" data-testid="modal-err">
          {err}
        </div>
      </div>

      <div className="m-foot">
        <button type="button" className="btn ghost" onClick={() => onClose()}>
          انصراف
        </button>
        <button type="button" className="btn primary" data-testid="modal-save" onClick={save}>
          ذخیره
        </button>
      </div>
    </dialog>
  );
}
