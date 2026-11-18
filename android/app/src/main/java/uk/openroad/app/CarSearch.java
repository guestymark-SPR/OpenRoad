package uk.openroad.app;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.constraints.ConstraintManager;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.Row;
import androidx.car.app.model.SearchTemplate;
import androidx.car.app.model.Template;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

/** "Where to?" on the car screen: type a place, pick a result, and turn-by-turn starts. */
final class CarSearch extends Screen implements SearchTemplate.SearchCallback {
    private final CarMap map;
    private ItemList results;
    private boolean loading;
    private String text = "", note;

    CarSearch(@NonNull CarContext c, CarMap map, String initial) {
        super(c);
        this.map = map;
        if (initial != null && !initial.trim().isEmpty() && !"0,0".equals(initial.trim())) { text = initial.trim(); find(text); }
    }

    @NonNull @Override public Template onGetTemplate() {
        SearchTemplate.Builder b = new SearchTemplate.Builder(this)
                .setHeaderAction(Action.BACK)
                .setSearchHint("Where to?")
                .setShowKeyboardByDefault(text.isEmpty())
                .setLoading(loading);
        if (!text.isEmpty()) b.setInitialSearchText(text);
        if (!loading && results != null) b.setItemList(results);
        return b.build();
    }

    @Override public void onSearchTextChanged(@NonNull String s) { }

    @Override public void onSearchSubmitted(@NonNull String s) {
        text = s.trim();
        if (!text.isEmpty()) find(text);
    }

    private void find(final String q) {
        loading = true; note = null; invalidate();
        new Thread(() -> {
            ItemList list;
            try { list = rows(fetch(q)); }
            catch (Exception e) { list = message("Could not search", "Check the phone's internet connection and try again"); }
            final ItemList done = list;
            ContextCompat.getMainExecutor(getCarContext()).execute(() -> { results = done; loading = false; invalidate(); });
        }, "car-search").start();
    }

    private static String fetch(String q) throws Exception {
        URL u = new URL("https://photon.komoot.io/api/?limit=8&lang=en&q=" + URLEncoder.encode(q, "UTF-8"));
        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        c.setConnectTimeout(8000); c.setReadTimeout(10000);
        c.setRequestProperty("User-Agent", "OpenRoad");
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
            StringBuilder sb = new StringBuilder(); String line;
            while ((line = r.readLine()) != null) sb.append(line);
            return sb.toString();
        } finally { c.disconnect(); }
    }

    private ItemList message(String title, String sub) {
        return new ItemList.Builder().addItem(new Row.Builder().setTitle(title).addText(sub).build()).build();
    }

    private ItemList rows(String json) throws Exception {
        int max = 6;
        try { max = getCarContext().getCarService(ConstraintManager.class).getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST); } catch (Exception ignored) { }
        JSONArray f = new JSONObject(json).optJSONArray("features");
        ItemList.Builder b = new ItemList.Builder();
        int n = 0;
        for (int i = 0; f != null && i < f.length() && n < max; i++) {
            JSONObject o = f.getJSONObject(i), p = o.optJSONObject("properties");
            JSONArray xy = o.getJSONObject("geometry").getJSONArray("coordinates");
            if (p == null) p = new JSONObject();
            String name = p.optString("name", "");
            if (name.isEmpty()) name = (p.optString("housenumber") + " " + p.optString("street")).trim();
            if (name.isEmpty()) name = p.optString("city", "Place");
            StringBuilder sub = new StringBuilder();
            for (String k : new String[]{"street", "city", "county", "postcode", "country"}) {
                String v = p.optString(k, "");
                if (v.isEmpty() || v.equals(name) || sub.indexOf(v) >= 0) continue;
                if (sub.length() > 0) sub.append(", ");
                sub.append(v);
            }
            final String nm = name; final double lng = xy.getDouble(0), lat = xy.getDouble(1);
            b.addItem(new Row.Builder().setTitle(nm).addText(sub.length() == 0 ? "Tap to start navigating" : sub.toString())
                    .setOnClickListener(() -> getScreenManager().push(new CarNav(getCarContext(), map, nm, lat, lng))).build());
            n++;
        }
        return n == 0 ? message("No places found", "Try another name, town or postcode") : b.build();
    }
}
