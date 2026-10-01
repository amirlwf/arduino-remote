import { useState, useSyncExternalStore } from "react";
import { store } from "../lib/appState.ts";
import type { Control, Profile } from "../lib/types.ts";
import { ControlCard } from "./ControlCard.tsx";
import { ControlModal, type ModalState } from "./ControlModal.tsx";

export function activeProfileOf(profiles: Profile[], activeId: string): Profile {
  return profiles.find((p) => p.id === activeId) ?? profiles[0]!;
}

export function ControlsView() {
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  const profile = activeProfileOf(state.profiles, state.activeProfileId);
  const [editMode, setEditMode] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);

  const startEdit = (ctrl: Control) => setModal({ mode: "edit", ctrl });

  return (
    <>
      <div className="sect-head">
        <div>
          <h2>کنترل‌ها</h2>
          <span className="sub" data-testid="profile-sub">
            {profile.icon} {profile.name} — {profile.controls.length} کنترل
          </span>
        </div>
        <div className="rowbtns">
          <button
            type="button"
            className={"btn small" + (editMode ? " primary" : "")}
            data-testid="edit-toggle"
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? "پایان ویرایش" : "✏️ ویرایش"}
          </button>
        </div>
      </div>

      {state.profiles.length > 1 && (
        <div className="rowbtns" style={{ marginBottom: 14, overflowX: "auto", flexWrap: "nowrap" }}>
          {state.profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid="profile-chip"
              data-pid={p.id}
              className={"btn small" + (p.id === state.activeProfileId ? " primary" : "")}
              onClick={() => store.setActiveProfile(p.id)}
            >
              {p.icon} {p.name}
            </button>
          ))}
        </div>
      )}

      {profile.controls.length === 0 ? (
        <div className="empty">
          <span className="big">🎛️</span>
          هنوز کنترلی نداری.
          <br />
          با دکمه‌ی <b>+</b> پایین صفحه اولین کنترل را بساز —
          <br />
          کلید، لغزنده یا هر دستور دلخواه.
        </div>
      ) : (
        <div className="grid" data-testid="control-grid">
          {profile.controls.map((ctrl) => (
            <ControlCard key={ctrl.id} ctrl={ctrl} editMode={editMode} onEdit={() => startEdit(ctrl)} />
          ))}
        </div>
      )}

      <button
        type="button"
        className="fab"
        aria-label="افزودن کنترل"
        data-testid="fab-add"
        onClick={() => setModal({ mode: "add" })}
      >
        +
      </button>

      <ControlModal state={modal} onClose={() => setModal(null)} />
    </>
  );
}
