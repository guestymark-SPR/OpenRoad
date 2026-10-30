package uk.openroad.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * The home-screen widget: today's riding weather (the same answer as the Today card in the app), with buttons to
 * ride today's loop or start recording. The app sends its answer whenever it works one out; between times the
 * widget asks Open-Meteo itself about once an hour, for the last place the app used.
 */
public class TodayWidget extends AppWidgetProvider {
    private static final long HOUR = 3600000L;

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        draw(c, m, ids);
        final PendingResult pr = goAsync();
        final Context app = c.getApplicationContext();
        new Thread(() -> {
            try { if (refresh(app)) redraw(app); } catch (Exception ignored) { }
            finally { pr.finish(); }
        }, "widget").start();
    }

    static void redraw(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            int[] ids = m.getAppWidgetIds(new ComponentName(c, TodayWidget.class));
            if (ids != null && ids.length > 0) draw(c, m, ids);
        } catch (Exception ignored) { }
    }

    private static JSONObject saved(Context c) {
        try { String s = Util.kvGet(c, "widget"); return s == null ? new JSONObject() : new JSONObject(s); } catch (Exception e) { return new JSONObject(); }
    }

    private static PendingIntent open(Context c, String what, int code) {
        Intent i = new Intent(c, MainActivity.class).setAction("uk.openroad.app.WIDGET_" + what)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (!what.isEmpty()) i.putExtra("widget", what);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void draw(Context c, AppWidgetManager m, int[] ids) {
        JSONObject j = saved(c);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_today);
        String head = j.optString("head", ""), sub = j.optString("sub", ""), tone = j.optString("tone", "");
        if (head.isEmpty()) { head = "Open OpenRoad"; sub = "Open the app once to see today's riding weather here."; }
        v.setTextViewText(R.id.wHead, head);
        v.setTextViewText(R.id.wSub, sub);
        v.setTextColor(R.id.wDot, "good".equals(tone) ? Color.rgb(46, 204, 113) : "wait".equals(tone) ? Color.rgb(245, 197, 24) : "bad".equals(tone) ? Color.rgb(255, 99, 88) : Color.rgb(140, 150, 158));
        long at = j.optLong("at", 0);
        boolean today = at > 0 && sameDay(at, System.currentTimeMillis());
        String loop = today ? j.optString("loop", "") : "";
        v.setTextViewText(R.id.wLoop, loop.isEmpty() ? (at > 0 ? "Updated " + new SimpleDateFormat("HH:mm", Locale.UK).format(new Date(at)) : "") : loop);
        v.setOnClickPendingIntent(R.id.wRoot, open(c, "", 300));
        v.setOnClickPendingIntent(R.id.wRide, open(c, "loop", 301));
        v.setOnClickPendingIntent(R.id.wRec, open(c, "record", 302));
        m.updateAppWidget(ids, v);
    }

    private static boolean sameDay(long a, long b) {
        Calendar x = Calendar.getInstance(), y = Calendar.getInstance(); x.setTimeInMillis(a); y.setTimeInMillis(b);
        return x.get(Calendar.YEAR) == y.get(Calendar.YEAR) && x.get(Calendar.DAY_OF_YEAR) == y.get(Calendar.DAY_OF_YEAR);
    }

    /** Ask Open-Meteo for the place the app last used and work out the riding window, as today.js does. */
    private static boolean refresh(Context c) throws Exception {
        JSONObject j = saved(c);
        if (!j.has("lat") || System.currentTimeMillis() - j.optLong("at", 0) < 50 * 60000L) return false;
        double lat = j.getDouble("lat"), lng = j.getDouble("lng");
        String url = String.format(Locale.US, "https://api.open-meteo.com/v1/forecast?latitude=%.3f&longitude=%.3f"
            + "&hourly=temperature_2m,precipitation_probability,precipitation,wind_gusts_10m,weather_code&daily=sunrise,sunset"
            + "&wind_speed_unit=mph&timeformat=unixtime&timezone=auto&forecast_days=3", lat, lng);
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(12000); h.setReadTimeout(20000); h.setRequestProperty("User-Agent", Util.UA);
        String body;
        try (InputStream in = h.getInputStream()) { body = Util.readAll(in); } finally { h.disconnect(); }
        JSONObject f = new JSONObject(body), hr = f.getJSONObject("hourly"), dy = f.getJSONObject("daily");
        JSONArray t = hr.getJSONArray("time"), temp = hr.getJSONArray("temperature_2m"), p = hr.getJSONArray("precipitation_probability"),
            mm = hr.getJSONArray("precipitation"), gust = hr.getJSONArray("wind_gusts_10m"), code = hr.getJSONArray("weather_code"),
            rise = dy.getJSONArray("sunrise"), set = dy.getJSONArray("sunset");
        long now = System.currentTimeMillis(), h0 = now / HOUR * HOUR;
        int n = t.length();
        long[] ts = new long[n]; boolean[] ok = new boolean[n]; double[] tc = new double[n];
        int first = -1, cnt = 0;
        for (int i = 0; i < n; i++) {
            long ti = t.getLong(i) * 1000L - HOUR; ts[i] = ti; // rain figures are for the hour before each time tc[i] = temp.optDouble(i, 10);
            if (ti < h0 || ti >= h0 + 40 * HOUR) continue;
            if (first < 0) first = i; cnt = i - first + 1;
            boolean dark = true;
            for (int d = 0; d < rise.length(); d++) { long r = rise.getLong(d) * 1000L, s = set.getLong(d) * 1000L; if (ti + 30 * 60000L >= r && ti + 30 * 60000L <= s) { dark = false; break; } }
            ok[i] = !dark && code.optInt(i, 0) < 95 && p.optDouble(i, 0) < 40 && mm.optDouble(i, 0) < 0.3 && gust.optDouble(i, 0) < 40 && tc[i] >= 4;
        }
        if (first < 0) return false;
        // runs of good hours: the first of two hours or more, else the first single one
        int a = -1, b = -1, a1 = -1, b1 = -1;
        for (int i = first; i < first + cnt; i++) {
            if (!ok[i]) continue;
            int k = i; while (k + 1 < first + cnt && ok[k + 1]) k++;
            if (a1 < 0) { a1 = i; b1 = k + 1; }
            if (k + 1 - i >= 2) { a = i; b = k + 1; break; }
            i = k;
        }
        if (a < 0) { a = a1; b = b1; }
        SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.UK);
        String head, sub, tone;
        if (a < 0) { head = "Not a riding day"; sub = "The next day and a half look poor."; tone = "bad"; }
        else {
            long from = Math.max(now, ts[a]), to = ts[b - 1] + HOUR;
            for (int d = 0; d < set.length(); d++) { long s = set.getLong(d) * 1000L; if (to > s && ts[b - 1] < s) to = s; }
            double lo = 99, hi = -99; for (int i = a; i < b; i++) { lo = Math.min(lo, tc[i]); hi = Math.max(hi, tc[i]); }
            String temps = Math.round(lo) == Math.round(hi) ? Math.round(lo) + "°" : Math.round(lo) + "–" + Math.round(hi) + "°";
            boolean startsNow = from <= now + 15 * 60000L, same = sameDay(from, now);
            double len = (to - from) / (double) HOUR;
            if (startsNow && len >= 3.5) { head = "Great day for a ride"; tone = "good"; sub = "Dry until " + hm.format(new Date(to)) + ". " + temps + "."; }
            else if (startsNow) { head = "Ride now"; tone = "good"; sub = "Dry until " + hm.format(new Date(to)) + ". " + temps + "."; }
            else if (same) { head = "Ride from " + hm.format(new Date(from)); tone = "wait"; sub = "Dry from then until " + hm.format(new Date(to)) + ". " + temps + "."; }
            else { head = "Tomorrow looks better"; tone = "wait"; sub = "Dry from " + hm.format(new Date(from)) + " until " + hm.format(new Date(to)) + ". " + temps + "."; }
        }
        j.put("head", head); j.put("sub", sub); j.put("tone", tone); j.put("at", now);
        if (!sameDay(j.optLong("loopAt", 0), now)) j.put("loop", "");
        Util.kvSet(c, "widget", j.toString());
        return true;
    }
}
