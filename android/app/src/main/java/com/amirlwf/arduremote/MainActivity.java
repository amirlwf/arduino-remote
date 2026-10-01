package com.amirlwf.arduremote;

import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * مجوزهای بلوتوث را هنگام اولین اجرا می‌گیرد:
 * اندروید ۱۲+ → BLUETOOTH_CONNECT / BLUETOOTH_SCAN
 * اندروید قدیمی‌تر → موقعیت مکانی (الزام discovery در آن نسخه‌ها)
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (Build.VERSION.SDK_INT >= 31) {
      requestPermissions(
          new String[] {
            "android.permission.BLUETOOTH_CONNECT",
            "android.permission.BLUETOOTH_SCAN"
          },
          7);
    } else {
      requestPermissions(
          new String[] {
            "android.permission.ACCESS_FINE_LOCATION",
            "android.permission.ACCESS_COARSE_LOCATION"
          },
          7);
    }
  }
}
