/** انواع داده‌ی اپ — منبع حقیقت برای کل پروژه */

export type ControlType = "toggle" | "momentary" | "slider" | "text";
export type Suffix = "" | "\n" | "\r\n";

interface BaseControl {
  id: string;
  name: string;
  icon: string;
  /** رنگ نوار بالای کارت */
  color: string;
  /** کاراکتر انتهای هر دستور — بعضی اسکچ‌ها \n لازم دارند */
  suffix: Suffix;
}

/** کلید روشن/خاموش: با هر بار زدن، یکی از دو دستور ارسال می‌شود */
export interface ToggleControl extends BaseControl {
  type: "toggle";
  onPayload: string;
  offPayload: string;
  /** وضعیت فعلی (برای رسم UI و ماندگاری بین اجراها) */
  on: boolean;
}

/** کلید لحظه‌ای: دستور هنگام فشردن، دستور دوم هنگام رها کردن */
export interface MomentaryControl extends BaseControl {
  type: "momentary";
  pressPayload: string;
  /** خالی = چیزی در رها کردن ارسال نشود */
  releasePayload: string;
}

/** لغزنده: مقدار نمایشی با فاصله‌سازی خطی به بازه‌ی خروجی تبدیل می‌شود */
export interface SliderControl extends BaseControl {
  type: "slider";
  /** الگوی دستور؛ {v} با مقدار تبدیل‌شده جایگزین می‌شود — مثلاً V{v} */
  template: string;
  min: number;
  max: number;
  outMin: number;
  outMax: number;
  value: number;
  /** فقط هنگام رها کردن دستور فرستاده شود (جلوگیری از سیل دستور) */
  sendOnRelease: boolean;
}

/** جعبه‌ی متن دلخواه + دکمه‌ی ارسال */
export interface TextControl extends BaseControl {
  type: "text";
  placeholder: string;
  text: string;
}

export type Control = ToggleControl | MomentaryControl | SliderControl | TextControl;

/** یک دستگاه/پروژه — مجموعه‌ای از کنترل‌ها */
export interface Profile {
  id: string;
  name: string;
  icon: string;
  controls: Control[];
}

export type TransportKind = "demo" | "bluetooth" | "webserial" | "websocket";

export interface TransportConfig {
  kind: TransportKind;
  /** آدرس وب‌سوکت پل — مثلاً ws://192.168.1.5:81 */
  wsUrl: string;
  /** آدرس/شناسه‌ی دستگاه بلوتوث — خالی = آخرین مورد واردشده */
  btAddress: string;
}

export interface AppState {
  version: 1;
  profiles: Profile[];
  activeProfileId: string;
  transport: TransportConfig;
}

export const TRANSPORT_LABELS: Record<TransportKind, string> = {
  demo: "شبیه‌ساز",
  bluetooth: "بلوتوث کلاسیک (HC-05)",
  webserial: "سریال USB",
  websocket: "وب‌سوکت",
};

export const CONTROL_TYPE_LABELS: Record<ControlType, string> = {
  toggle: "کلید روشن/خاموش",
  momentary: "کلید لحظه‌ای (نگه‌داشتنی)",
  slider: "لغزنده",
  text: "متن دلخواه",
};

export const CONTROL_TYPE_ICONS: Record<ControlType, string> = {
  toggle: "💡",
  momentary: "🔔",
  slider: "⚡",
  text: "🎛️",
};
