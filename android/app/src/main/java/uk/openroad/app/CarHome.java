package uk.openroad.app;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.constraints.ConstraintManager;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.SectionedItemList;
import androidx.car.app.model.Template;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/** The first car screen: trip days and saved routes planned on the phone, and recording a ride. */
final class CarHome extends Screen {
    private final CarMap map;

    CarHome(@NonNull CarContext c, CarMap map) { super(c); this.map = map; }

    private int limit() {
        try { return getCarContext().getCarService(ConstraintManager.class).getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST); }
        catch (Exception e) { return 6; }
    }

    @NonNull @Override public Template onGetTemplate() {
        int max = Math.max(2, limit()), used = 0;
        boolean miles = !"km".equals(cfgUnits());
        ListTemplate.Builder t = new ListTemplate.Builder().setTitle("OpenRoad").setHeaderAction(Action.APP_ICON);

        // the next trip days first
        ItemList.Builder trips = new ItemList.Builder();
        try {
            JSONArray list = new JSONArray(orEmpty(Util.kvGet(getCarContext(), "or_trips")));
            for (int i = 0; i < list.length() && used < max - 1; i++) {
                JSONObject trip = list.getJSONObject(i);
                JSONArray days = trip.getJSONArray("days");
                for (int d = 0; d < days.length() && used < max - 1; d++) {
                    JSONArray steps = days.getJSONObject(d).getJSONArray("steps");
                    for (int s = 0; s < steps.length() && used < max - 1; s++) {
                        JSONObject st = steps.getJSONObject(s);
                        if (!"ride".equals(st.optString("kind")) || st.isNull("route") || !st.has("route")) continue;
                        JSONObject r = st.getJSONObject("route"); JSONArray w = st.getJSONArray("wps");
                        final String id = trip.getString("id"); final int dd = d, ss = s;
                        trips.addItem(new Row.Builder().setTitle(trip.optString("name") + ", day " + (d + 1))
                                .addText(w.getJSONObject(0).optString("name") + " to " + w.getJSONObject(w.length() - 1).optString("name") + ", " + dist(r.optDouble("dist"), miles))
                                .setOnClickListener(() -> go("trip", id, dd, ss)).build());
                        used++;
                    }
                }
            }
        } catch (Exception ignored) { }

        ItemList.Builder routes = new ItemList.Builder();
        routes.addItem(new Row.Builder().setTitle("Record a ride").addText("No route, just your track and stats").setOnClickListener(() -> go("free", "", 0, 0)).build());
        used++;
        try {
            JSONArray list = new JSONArray(orEmpty(Util.kvGet(getCarContext(), "or_routes")));
            for (int i = 0; i < list.length() && used < max; i++) {
                JSONObject r = list.getJSONObject(i);
                final String id = r.getString("id");
                routes.addItem(new Row.Builder().setTitle(r.optString("name", "Route")).addText(dist(r.optDouble("dist"), miles) + ", " + time(r.optDouble("time")))
                        .setOnClickListener(() -> go("route", id, 0, 0)).build());
                used++;
            }
        } catch (Exception ignored) { }

        ItemList ti = trips.build();
        if (!ti.getItems().isEmpty()) t.addSectionedList(SectionedItemList.create(ti, "Trips"));
        t.addSectionedList(SectionedItemList.create(routes.build(), "Saved routes"));
        return t.build();
    }

    private void go(String kind, String id, int day, int step) { getScreenManager().push(new CarNav(getCarContext(), map, kind, id, day, step)); }

    private String cfgUnits() { try { return new JSONObject(orEmptyObj(Util.kvGet(getCarContext(), "or_cfg"))).optString("units", "mi"); } catch (Exception e) { return "mi"; } }
    private static String orEmpty(String s) { return s == null || s.isEmpty() || "null".equals(s) ? "[]" : s; }
    private static String orEmptyObj(String s) { return s == null || s.isEmpty() || "null".equals(s) ? "{}" : s; }
    static String dist(double m, boolean miles) {
        if (Double.isNaN(m)) return "";
        return miles ? String.format(Locale.UK, m < 16093 ? "%.1f mi" : "%.0f mi", m / 1609.344) : String.format(Locale.UK, m < 10000 ? "%.1f km" : "%.0f km", m / 1000);
    }
    static String time(double s) {
        if (Double.isNaN(s)) return "";
        long h = (long) (s / 3600), m = Math.round((s % 3600) / 60);
        return h > 0 ? h + " h " + m + " min" : m + " min";
    }
}
