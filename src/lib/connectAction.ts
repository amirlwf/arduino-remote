/** اکشن مشترک «وصل/قطع» — هم در نوار بالا هم در تنظیمات استفاده می‌شود */
import { getManager } from "./connection.ts";
import { logAppend } from "./log.ts";
import { toast } from "./toast.ts";

export async function toggleConnection(): Promise<void> {
  const mgr = getManager();
  if (mgr.status === "connected" || mgr.status === "connecting") {
    await mgr.disconnect();
    logAppend("sys", "اتصال قطع شد");
    return;
  }
  try {
    await mgr.connect();
    logAppend("sys", `متصل شد: ${mgr.label}`);
    toast("اتصال برقرار شد", "ok");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logAppend("err", msg);
    toast(msg, "err");
  }
}
