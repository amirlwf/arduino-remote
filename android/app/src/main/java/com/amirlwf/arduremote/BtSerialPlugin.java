package com.amirlwf.arduremote;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;

/**
 * پل بلوتوث اختصاصی Arduino Remote — نوشته‌شده در جاوای نیتیو.
 *
 * دو مسیر اتصال (بر اساس نوع دستگاه — تشخیص خودکار):
 *   • کلاسیک (SPP): الگوی SimpleBluetoothTerminal — SPP UUID سپس fallback کانال ۱..۳
 *   • BLE (GATT): برای ماژول‌هایی که به‌اشتباه «HC-05» نام دارند ولی LE هستند
 *     (AT-09 / MLT-BT05 / JDY-08 و…) — پروفایل‌های Nordic UART، HM-10 (FFE1)
 *     و تشخیص عمومی هر characteristic سریالی؛ retry برای خطای معروف 133
 *
 * رویدادها: data (text) · connectionLost (message) · deviceFound · discoveryFinished
 */
@CapacitorPlugin(name = "BtSerial")
public class BtSerialPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    // پروفایل‌های سریال BLE به ترتیب اولویت
    private static final UUID NORDIC_UART = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID HM10_SERVICE = UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb");
    private static final UUID FFF0_SERVICE = UUID.fromString("0000fff0-0000-1000-8000-00805f9b34fb");
    private static final UUID CLIENT_CONFIG = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private BluetoothAdapter adapter;
    private volatile BluetoothSocket socket;
    private volatile OutputStream out;
    private volatile Thread readThread;
    private volatile Thread connectThread;
    private volatile boolean userDisconnected = false;
    private final Object writeLock = new Object();
    private BroadcastReceiver discoveryReceiver;

    // مسیر BLE
    private volatile BluetoothGatt gatt;
    private volatile BluetoothGattCharacteristic writeChar;
    private volatile BluetoothGattCharacteristic notifyChar;
    private volatile PluginCall pendingGattCall;
    private int gattRetries = 0;

    private synchronized BluetoothAdapter adapter() {
        if (adapter == null) adapter = BluetoothAdapter.getDefaultAdapter();
        return adapter;
    }

    /* ------------------------------------------------------------ فهرست و جستجو */

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void list(PluginCall call) {
        try {
            JSArray devices = new JSArray();
            Set<BluetoothDevice> bonded = adapter().getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice d : bonded) devices.put(deviceJson(d));
            }
            JSObject res = new JSObject();
            res.put("devices", devices);
            call.resolve(res);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission required to list paired devices");
        } catch (Exception e) {
            call.reject("list-error: " + e.getMessage());
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startDiscovery(PluginCall call) {
        try {
            if (discoveryReceiver == null) {
                discoveryReceiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        String action = intent.getAction();
                        if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                            BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                            if (d != null) notifyListeners("deviceFound", deviceJson(d));
                        } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                            notifyListeners("discoveryFinished", new JSObject());
                        }
                    }
                };
                IntentFilter f = new IntentFilter();
                f.addAction(BluetoothDevice.ACTION_FOUND);
                f.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
                getActivity().registerReceiver(discoveryReceiver, f);
            }
            if (!adapter().startDiscovery()) {
                call.reject("startDiscovery failed — Bluetooth is disabled");
                return;
            }
            call.resolve();
        } catch (SecurityException e) {
            call.reject("Bluetooth permission required to discover devices");
        } catch (Exception e) {
            call.reject("discover-error: " + e.getMessage());
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        try {
            adapter().cancelDiscovery();
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    /* ------------------------------------------------------------ جفت‌سازی */

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void pair(PluginCall call) {
        String address = call.getString("address", "");
        try {
            BluetoothDevice device = adapter().getRemoteDevice(address);
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                call.resolve();
                return;
            }
            final boolean[] done = {false};
            BroadcastReceiver r = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (d == null || !address.equalsIgnoreCase(d.getAddress())) return;
                    int st = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
                    int prev = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.BOND_NONE);
                    if (st == BluetoothDevice.BOND_BONDED) {
                        finishPair(this, call, null, done);
                    } else if (st == BluetoothDevice.BOND_NONE && prev == BluetoothDevice.BOND_BONDING) {
                        finishPair(this, call, "pairing-cancelled", done);
                    }
                }
            };
            IntentFilter f = new IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
            getActivity().registerReceiver(r, f);
            final BroadcastReceiver receiver = r;
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                finishPair(receiver, call, "pair-timeout", done);
            }, 60000);
            java.lang.reflect.Method m = device.getClass().getMethod("createBond");
            if (!Boolean.TRUE.equals(m.invoke(device))) {
                finishPair(r, call, "createBond-rejected", done);
            }
        } catch (SecurityException e) {
            call.reject("Bluetooth permission required to pair");
        } catch (Exception e) {
            call.reject("pair-error: " + e.getMessage());
        }
    }

    private void finishPair(BroadcastReceiver r, PluginCall call, String error, boolean[] done) {
        try {
            getActivity().unregisterReceiver(r);
        } catch (Exception ignored) {
        }
        if (call == null || done[0]) return;
        done[0] = true;
        if (error == null) call.resolve();
        else call.reject(error);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void unpair(PluginCall call) {
        String address = call.getString("address", "");
        try {
            BluetoothDevice device = adapter().getRemoteDevice(address);
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                java.lang.reflect.Method rm = device.getClass().getMethod("removeBond");
                rm.invoke(device);
            }
            call.resolve();
        } catch (SecurityException e) {
            call.reject("Bluetooth permission required to unpair");
        } catch (Exception e) {
            call.reject("unpair-error: " + e.getMessage());
        }
    }

    /* ------------------------------------------------------------ اتصال */

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connect(PluginCall call) {
        final String address = call.getString("address", "");
        if (address.isEmpty()) {
            call.reject("Bluetooth address is empty");
            return;
        }
        userDisconnected = false;
        final BluetoothAdapter a = adapter();
        // disconnect باید حتی وسط connect در دسترس باشد → connect در ترد خودش
        Thread t = new Thread(() -> {
            final StringBuilder errs = new StringBuilder();
            try {
                a.cancelDiscovery();
                // انتظار خروج رادیو از inquiry (الهام از SimpleBluetoothTerminal)
                for (int i = 0; i < 6 && a.isDiscovering(); i++) {
                    try { Thread.sleep(100); } catch (InterruptedException ignored) { }
                }
                Thread.sleep(300);
            } catch (InterruptedException ignored) {
            }

            final BluetoothDevice device;
            try {
                device = a.getRemoteDevice(address);
            } catch (IllegalArgumentException e) {
                call.reject("Invalid Bluetooth MAC address: " + address);
                return;
            }

            // نوع دستگاه: ۱=کلاسیک، ۲=فقط BLE، ۳=دو حالته (کامل) — ماژول‌های «HC-05»‌نامِ
            // بازار معمولاً نوع ۲ هستند و اصلاً سرویس SPP ندارند → مستقیم مسیر GATT
            int type;
            try {
                type = device.getType();
            } catch (SecurityException e) {
                call.reject("Bluetooth permission required to connect");
                return;
            }
            final boolean classicAllowed = (type != BluetoothDevice.DEVICE_TYPE_LE);
            final boolean gattAllowed = (type != BluetoothDevice.DEVICE_TYPE_CLASSIC);

            if (classicAllowed) {
                BluetoothSocket s;
                // ۱) SPP UUID (امن — روی HC-05 جفت‌نشده هم جواب می‌دهد)
                try {
                    s = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    activeSocket(s);
                    s.connect();
                    succeed(call, s);
                    return;
                } catch (IOException e) {
                    errs.append("spp: ").append(e.getMessage());
                    closeQuietly();
                } catch (SecurityException e) {
                    call.reject("Bluetooth permission required to connect");
                    return;
                }
                // ۲) fallback رفلکس — کانال‌های ۱ تا ۳ (اتصال بدون رمزنگاری، حالت اپ‌های استاندارد)
                boolean connected = false;
                for (int ch = 1; ch <= 3 && !connected; ch++) {
                    if (userDisconnected) {
                        call.reject("connect-cancelled");
                        return;
                    }
                    try {
                        s = (BluetoothSocket) device.getClass()
                                .getMethod("createRfcommSocket", new Class[]{int.class})
                                .invoke(device, ch);
                        activeSocket(s);
                        s.connect();
                        succeed(call, s);
                        return;
                    } catch (IOException e) {
                        if (errs.length() > 0) errs.append(" | ");
                        errs.append("ch").append(ch).append(": ").append(e.getMessage());
                        closeQuietly();
                    } catch (Exception e) {
                        call.reject("Unable to connect to device — " + e);
                        return;
                    }
                }
                if (!gattAllowed) {
                    call.reject("Unable to connect to device — " + errs);
                    return;
                }
                // دو حالته: کلاسیک نشد → GATT
            }

            if (gattAllowed) {
                gattRetries = 0;
                startGattConnect(device, call);
            }
        }, "bt-connect");
        connectThread = t;
        t.start();
    }

    /* ------------------------------------------------------------ مسیر BLE (GATT) */

    @SuppressLint("MissingPermission")
    private void startGattConnect(BluetoothDevice device, PluginCall call) {
        pendingGattCall = call;
        BluetoothGattCallback cb = new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    if (userDisconnected) { g.disconnect(); return; }
                    g.discoverServices();
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    if (userDisconnected) { g.close(); return; }
                    if (pendingGattCall != null) {
                        // هنوز در حال اتصال — خطای معروف 133/257 → retry
                        if ((status == 133 || status == 257) && gattRetries < 2) {
                            gattRetries++;
                            g.close();
                            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                                () -> startGattConnect(device, pendingGattCall), 400);
                            return;
                        }
                        PluginCall c = pendingGattCall;
                        pendingGattCall = null;
                        g.close();
                        c.reject("Unable to connect to device — ble: status " + status);
                    } else {
                        // قطع وسط نشست — مثل مسیر کلاسیک به اپ خبر بده
                        g.close();
                        gatt = null; writeChar = null; notifyChar = null;
                        JSObject ev = new JSObject();
                        ev.put("message", "Device connection was lost (BLE)");
                        notifyListeners("connectionLost", ev);
                    }
                }
            }

            @Override
            public void onServicesDiscovered(BluetoothGatt g, int status) {
                if (userDisconnected || pendingGattCall == null) return;
                if (status != BluetoothGatt.GATT_SUCCESS || !pickSerialChars(g)) {
                    PluginCall c = pendingGattCall;
                    pendingGattCall = null;
                    g.disconnect();
                    g.close();
                    c.reject("Unable to connect to device — ble: serial characteristic not found");
                    return;
                }
                g.setCharacteristicNotification(notifyChar, true);
                BluetoothGattDescriptor d = notifyChar.getDescriptor(CLIENT_CONFIG);
                if (d == null) {
                    PluginCall c = pendingGattCall;
                    pendingGattCall = null;
                    g.disconnect();
                    g.close();
                    c.reject("Unable to connect to device — ble: CCCD descriptor missing");
                    return;
                }
                d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                if (!g.writeDescriptor(d)) {
                    PluginCall c = pendingGattCall;
                    pendingGattCall = null;
                    g.disconnect();
                    g.close();
                    c.reject("Unable to connect to device — ble: subscribe failed");
                }
                // موفقیت ادامه دارد در onDescriptorWrite
            }

            @Override
            public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
                if (userDisconnected || pendingGattCall == null) return;
                PluginCall c = pendingGattCall;
                pendingGattCall = null;
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    c.resolve();
                } else {
                    g.disconnect();
                    g.close();
                    c.reject("Unable to connect to device — ble: subscribe status " + status);
                }
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
                byte[] v = c.getValue();
                if (v != null && v.length > 0) {
                    JSObject ev = new JSObject();
                    ev.put("text", new String(v, StandardCharsets.UTF_8));
                    notifyListeners("data", ev);
                }
            }
        };
        gatt = device.connectGatt(getContext(), false, cb, BluetoothDevice.TRANSPORT_LE);
    }

    /** پیدا کردن جفت characteristic سریال (notify + write) در سرویس‌های شناخته‌شده و بعد عمومی */
    private boolean pickSerialChars(BluetoothGatt g) {
        BluetoothGattService svc = g.getService(NORDIC_UART);
        if (svc == null) svc = g.getService(HM10_SERVICE);
        if (svc == null) svc = g.getService(FFF0_SERVICE);
        if (svc == null) {
            // عمومی: هر سرویسی که هم notify و هم write دارد
            for (BluetoothGattService s : g.getServices()) {
                if (firstCharWith(s, BluetoothGattCharacteristic.PROPERTY_NOTIFY) != null
                        && firstWritableChar(s) != null) {
                    svc = s;
                    break;
                }
            }
        }
        if (svc == null) return false;
        notifyChar = firstCharWith(svc, BluetoothGattCharacteristic.PROPERTY_NOTIFY);
        writeChar = firstWritableChar(svc);
        return notifyChar != null && writeChar != null;
    }

    private BluetoothGattCharacteristic firstCharWith(BluetoothGattService svc, int property) {
        for (BluetoothGattCharacteristic c : svc.getCharacteristics()) {
            if ((c.getProperties() & property) != 0) return c;
        }
        return null;
    }

    private BluetoothGattCharacteristic firstWritableChar(BluetoothGattService svc) {
        for (BluetoothGattCharacteristic c : svc.getCharacteristics()) {
            int p = c.getProperties();
            if ((p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
                    || (p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
                return c;
            }
        }
        return null;
    }

    @SuppressLint("MissingPermission")
    private void succeed(PluginCall call, BluetoothSocket s) throws IOException {
        if (userDisconnected) {
            closeQuietly();
            call.reject("connect-cancelled");
            return;
        }
        socket = s;
        out = s.getOutputStream();
        startReadThread(s);
        call.resolve();
    }

    private void activeSocket(BluetoothSocket s) {
        socket = s; // تا disconnect وسطِ connect هم سوکت جاری را ببندد
    }

    private void startReadThread(BluetoothSocket s) {
        readThread = new Thread(() -> {
            byte[] buf = new byte[4096];
            try (InputStream in = s.getInputStream()) {
                while (!Thread.currentThread().isInterrupted()) {
                    int n = in.read(buf);
                    if (n < 0) break;
                    if (n > 0) {
                        String text = new String(buf, 0, n, StandardCharsets.UTF_8);
                        JSObject ev = new JSObject();
                        ev.put("text", text);
                        notifyListeners("data", ev);
                    }
                }
            } catch (IOException ignored) {
            }
            if (!userDisconnected) {
                JSObject ev = new JSObject();
                ev.put("message", "Device connection was lost");
                notifyListeners("connectionLost", ev);
            }
            cleanupAfterLoss(s);
        }, "bt-read");
        readThread.start();
    }

    private synchronized void cleanupAfterLoss(BluetoothSocket s) {
        if (socket == s) {
            socket = null;
            out = null;
        }
    }

    /* ------------------------------------------------------------ نوشتن / قطع */

    @PluginMethod
    public void write(PluginCall call) {
        String data = call.getString("data", "");
        // مسیر BLE
        BluetoothGattCharacteristic c = writeChar;
        BluetoothGatt g = gatt;
        if (c != null && g != null) {
            int p = c.getProperties();
            c.setWriteType(
                (p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
                    ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            c.setValue(data.getBytes(StandardCharsets.UTF_8));
            if (!g.writeCharacteristic(c)) {
                call.reject("write failed — ble");
            } else {
                call.resolve();
            }
            return;
        }
        // مسیر کلاسیک
        OutputStream o = out;
        BluetoothSocket s = socket;
        if (o == null || s == null) {
            call.reject("Not connected.");
            return;
        }
        try {
            synchronized (writeLock) {
                o.write(data.getBytes(StandardCharsets.UTF_8));
                o.flush();
            }
            call.resolve();
        } catch (IOException e) {
            call.reject("write failed — " + e.getMessage());
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        userDisconnected = true;
        // مسیر BLE
        BluetoothGatt g = gatt;
        gatt = null;
        writeChar = null;
        notifyChar = null;
        pendingGattCall = null;
        if (g != null) {
            try { g.disconnect(); } catch (Exception ignored) { }
            try { g.close(); } catch (Exception ignored) { }
        }
        // مسیر کلاسیک
        closeQuietly();
        call.resolve();
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS));
            call.resolve();
        } catch (Exception e) {
            call.reject("settings-error: " + e.getMessage());
        }
    }

    /* ------------------------------------------------------------ کمکی‌ها */

    private void closeQuietly() {
        try {
            BluetoothSocket s = socket;
            socket = null;
            out = null;
            if (s != null) s.close();
        } catch (IOException ignored) {
        }
    }

    private JSObject deviceJson(BluetoothDevice d) {
        JSObject o = new JSObject();
        o.put("address", d.getAddress());
        o.put("id", d.getAddress());
        String name;
        try {
            name = d.getName();
        } catch (SecurityException e) {
            name = null;
        }
        o.put("name", name != null ? name : "");
        return o;
    }

    @Override
    protected void handleOnDestroy() {
        userDisconnected = true;
        // مسیر BLE
        BluetoothGatt g = gatt;
        gatt = null;
        writeChar = null;
        notifyChar = null;
        pendingGattCall = null;
        if (g != null) {
            try { g.disconnect(); } catch (Exception ignored) { }
            try { g.close(); } catch (Exception ignored) { }
        }
        // مسیر کلاسیک
        closeQuietly();
        Thread ct = connectThread;
        if (ct != null) ct.interrupt();
        Thread rt = readThread;
        if (rt != null) rt.interrupt();
        if (discoveryReceiver != null) {
            try {
                getActivity().unregisterReceiver(discoveryReceiver);
            } catch (Exception ignored) {
            }
            discoveryReceiver = null;
        }
    }
}
