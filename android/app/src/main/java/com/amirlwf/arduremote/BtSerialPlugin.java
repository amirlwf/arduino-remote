package com.amirlwf.arduremote;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
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
 * پل بلوتوث کلاسیک (SPP) اختصاصی Arduino Remote — نوشته‌شده در جاوای نیتیو.
 *
 * الگوی اتصال از kai-morich/SimpleBluetoothTerminal (اپی که روی HC-05 واقعاً جواب می‌دهد):
 *   ۱) cancelDiscovery قبل از هر connect — discovery دشمن RFCOMM است
 *   ۲) اول createRfcommSocketToServiceRecord با SPP UUID (اتصال «امن» که روی HC-05 جفت‌نشده هم جواب می‌دهد)
 *   ۳) در خطا: fallback به createRfcommSocket کانال ۱..۳ (پاسخ رفلکس دستگاه‌های قدیمی)
 *   ۴) ترد خواندن اختصاصی؛ قطع‌شدن ناگهانی با رویداد connectionLost به اپ می‌رسد
 *
 * رویدادها: data (text) · connectionLost (message) · deviceFound · discoveryFinished
 */
@CapacitorPlugin(name = "BtSerial")
public class BtSerialPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothAdapter adapter;
    private volatile BluetoothSocket socket;
    private volatile OutputStream out;
    private volatile Thread readThread;
    private volatile Thread connectThread;
    private volatile boolean userDisconnected = false;
    private final Object writeLock = new Object();
    private BroadcastReceiver discoveryReceiver;

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

    /* ------------------------------------------------------------ اتصال (الگوی SimpleBluetoothTerminal) */

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
            String lastError = "connect-failed";
            try {
                a.cancelDiscovery();
                // انتظار خروج رادیو از inquiry (الهام از SimpleBluetoothTerminal)
                for (int i = 0; i < 6 && a.isDiscovering(); i++) {
                    try { Thread.sleep(100); } catch (InterruptedException ignored) { }
                }
                Thread.sleep(300);

                BluetoothDevice device = a.getRemoteDevice(address);
                BluetoothSocket s;
                // ۱) SPP UUID (امن — روی HC-05 جفت‌نشده هم جواب می‌دهد)
                try {
                    s = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    activeSocket(s);
                    s.connect();
                    succeed(call, s);
                    return;
                } catch (IOException e) {
                    lastError = "spp: " + e;
                    closeQuietly();
                } catch (SecurityException e) {
                    call.reject("Bluetooth permission required to connect");
                    return;
                }
                // ۲) fallback رفلکس — کانال‌های ۱ تا ۳ (اتصال بدون رمزنگاری، حالت اپ‌های استاندارد)
                for (int ch = 1; ch <= 3; ch++) {
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
                        lastError = "ch" + ch + ": " + e;
                        closeQuietly();
                    }
                }
                call.reject("Unable to connect to device — " + lastError);
            } catch (IllegalArgumentException e) {
                call.reject("Invalid Bluetooth MAC address: " + address);
            } catch (Exception e) {
                if (userDisconnected) call.reject("connect-cancelled");
                else call.reject("Unable to connect to device — " + e);
            }
        }, "bt-connect");
        connectThread = t;
        t.start();
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
