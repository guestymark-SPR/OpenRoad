package uk.openroad.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import java.io.File;

/** Downloads a new OpenRoad APK and opens the installer. */
final class Updater {
    interface State { void on(String s); }
    private static BroadcastReceiver rx;

    @SuppressWarnings("deprecation")
    static void start(Activity a, String url, State cb) {
        try {
            if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
                a.startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
                cb.on("permission"); return;
            }
            final DownloadManager dm = (DownloadManager) a.getSystemService(Context.DOWNLOAD_SERVICE);
            File f = new File(a.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "OpenRoad-update.apk");
            if (f.exists()) f.delete();
            final long id = dm.enqueue(new DownloadManager.Request(Uri.parse(url)).setTitle("OpenRoad update").setDestinationUri(Uri.fromFile(f))
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE));
            cb.on("downloading");
            if (rx != null) try { a.unregisterReceiver(rx); } catch (Exception ignored) { }
            rx = new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent in) {
                    if (in.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                    Uri u = dm.getUriForDownloadedFile(id);
                    if (u == null) { cb.on("error"); return; }
                    try {
                        a.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(u, "application/vnd.android.package-archive")
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK));
                        cb.on("installing");
                    } catch (Exception e) { cb.on("error"); }
                }
            };
            IntentFilter flt = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) a.registerReceiver(rx, flt, Context.RECEIVER_EXPORTED); else a.registerReceiver(rx, flt);
        } catch (Exception e) { cb.on("error"); }
    }
}
