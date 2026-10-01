/** رویدادساز سبک و تایپ‌شده — بدون هیچ وابستگی خارجی
 *  قید `Record<keyof T, ...>` عمداً به‌جای `Record<string, ...>` است تا
 *  interfaceها هم بتوانند EventMap باشند (interface امضای ایندکس ضمنی ندارد). */
export class Emitter<T extends Record<keyof T, (...args: never[]) => void>> {
  private map = new Map<keyof T, Set<(...args: never[]) => void>>();

  /** ثبت شنونده؛ برگردانده تابع حذف شنونده */
  on<K extends keyof T>(event: K, fn: T[K]): () => void {
    let set = this.map.get(event);
    if (!set) {
      set = new Set();
      this.map.set(event, set);
    }
    set.add(fn as (...args: never[]) => void);
    return () => {
      set?.delete(fn as (...args: never[]) => void);
    };
  }

  protected emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): void {
    const set = this.map.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      (fn as (...a: Parameters<T[K]>) => void)(...args);
    }
  }
}
