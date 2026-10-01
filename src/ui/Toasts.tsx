import { useEffect, useState } from "react";
import { toastBus, type ToastKind } from "../lib/toast.ts";

interface Item {
  id: number;
  msg: string;
  kind: ToastKind;
}

let seq = 0;

export function Toasts() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(
    () =>
      toastBus.on("add", (msg, kind) => {
        const id = ++seq;
        setItems((v) => [...v, { id, msg, kind }]);
        setTimeout(() => setItems((v) => v.filter((x) => x.id !== id)), 2600);
      }),
    []
  );

  return (
    <div className="toasts" aria-live="polite">
      {items.map((it) => (
        <div key={it.id} className={`toast ${it.kind}`}>
          {it.msg}
        </div>
      ))}
    </div>
  );
}
