package uk.openroad.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Group ride events. An event lives on the same encrypted link as the group ride it becomes: the organiser keeps the
 * details there ("e") and each rider keeps their answer ("v"). A quick look connects for a few seconds, posts
 * anything to post, collects what's kept, and disconnects without joining the ride.
 */
public final class EventLink {
    private EventLink() { }
    interface Out { void js(String code); }

    static void peek(Context c, String code, String kind, String json, Out out) {
        new Thread(() -> {
            JSONObject res = new JSONObject();
            try {
                String me = Util.kvGet(c, "groupRider");
                if (me == null || me.length() < 8) { me = GroupLink.newRiderId(); Util.kvSet(c, "groupRider", me); }
                final JSONArray answers = new JSONArray(); final JSONObject[] ev = {null};
                GroupLink link = new GroupLink(code, me, GroupLink.SERVERS, new GroupLink.Listener() {
                    @Override public void onMessage(String k, String j) {
                        try {
                            JSONObject o = new JSONObject(j);
                            if ("e".equals(k) && (ev[0] == null || o.optLong("t") > ev[0].optLong("t"))) ev[0] = o;
                            if ("v".equals(k)) synchronized (answers) { for (int i = 0; i < answers.length(); i++) if (answers.getJSONObject(i).optString("id").equals(o.optString("id"))) { if (answers.getJSONObject(i).optLong("t") >= o.optLong("t")) return; answers.remove(i); break; } answers.put(o); }
                        } catch (Exception ignored) { }
                    }
                    @Override public void onStatus(String s, String st) { }
                });
                for (int i = 0; i < 100 && !link.anyOnline(); i++) Thread.sleep(100);
                if (!link.anyOnline()) { link.closeQuiet(); res.put("ok", false).put("why", "No connection"); out.js("window.onEventPeek&&onEventPeek(" + JSONObject.quote(code) + "," + JSONObject.quote(res.toString()) + ")"); return; }
                if (kind != null && json != null && !json.isEmpty()) {
                    JSONObject o = new JSONObject(json).put("id", me).put("t", System.currentTimeMillis());
                    link.sendKept(kind, o.toString());
                    if ("v".equals(kind)) synchronized (answers) { answers.put(o); }
                    if ("e".equals(kind)) ev[0] = o;
                }
                Thread.sleep(4500); // kept messages arrive straight after connecting
                link.closeQuiet();
                res.put("ok", true).put("me", me);
                if (ev[0] != null) res.put("event", ev[0]);
                synchronized (answers) { res.put("answers", answers); }
            } catch (Exception e) { try { res.put("ok", false).put("why", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
            out.js("window.onEventPeek&&onEventPeek(" + JSONObject.quote(code) + "," + JSONObject.quote(res.toString()) + ")");
        }, "event-peek").start();
    }

    // ---------- reminders ----------
    static void remind(Context c, String id, long at, String title, String text) {
        if (at < System.currentTimeMillis()) return;
        Intent i = new Intent(c, Remind.class).setAction("uk.openroad.app.EVENT_" + id + "_" + at).putExtra("title", title).putExtra("text", text);
        PendingIntent p = PendingIntent.getBroadcast(c, (id + at).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p); } catch (Exception ignored) { }
    }
    public static class Remind extends BroadcastReceiver {
        @Override public void onReceive(Context c, Intent in) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("events") == null) {
                NotificationChannel ch = new NotificationChannel("events", "Group ride events", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Reminders for group rides you're going on"); nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("openEvents", true);
            PendingIntent pi = PendingIntent.getActivity(c, 6, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, "events") : new Notification.Builder(c);
            String t = in.getStringExtra("title"), x = in.getStringExtra("text");
            b.setSmallIcon(android.R.drawable.ic_menu_my_calendar).setContentTitle(t).setContentText(x).setStyle(new Notification.BigTextStyle().bigText(x)).setContentIntent(pi).setAutoCancel(true);
            nm.notify(Math.abs((t + x).hashCode() % 10000) + 100, b.build());
        }
    }
}
