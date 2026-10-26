package uk.openroad.app;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.DateTimeWithZone;
import androidx.car.app.model.Distance;
import androidx.car.app.model.Template;
import androidx.car.app.navigation.NavigationManager;
import androidx.car.app.navigation.NavigationManagerCallback;
import androidx.car.app.navigation.model.Destination;
import androidx.car.app.navigation.model.Maneuver;
import androidx.car.app.navigation.model.MessageInfo;
import androidx.car.app.navigation.model.NavigationTemplate;
import androidx.car.app.navigation.model.RoutingInfo;
import androidx.car.app.navigation.model.Step;
import androidx.car.app.navigation.model.TravelEstimate;
import androidx.car.app.navigation.model.Trip;
import androidx.core.graphics.drawable.IconCompat;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import org.json.JSONObject;

import java.util.TimeZone;

/** Riding on the car screen: Android Auto's turn card and arrival time, over OpenRoad's map. */
final class CarNav extends Screen implements CarMap.Listener {
    private final CarMap map;
    private final String kind;
    private JSONObject state;
    private boolean active = true, muted;
    private final NavigationManager nav;

    CarNav(@NonNull CarContext c, CarMap map, String kind, String id, int day, int step) {
        super(c);
        this.map = map; this.kind = kind;
        nav = c.getCarService(NavigationManager.class);
        nav.setNavigationManagerCallback(new NavigationManagerCallback() {
            @Override public void onStopNavigation() { stop(false); }
            @Override public void onAutoDriveEnabled() { }
        });
        nav.navigationStarted();
        map.listener = this;
        map.js("carStart(" + JSONObject.quote(kind) + "," + JSONObject.quote(id) + "," + day + "," + step + ")");
        getLifecycle().addObserver(new DefaultLifecycleObserver() {
            @Override public void onDestroy(@NonNull LifecycleOwner o) { if (active) stop(false); }
        });
    }

    @Override public void onUpdate(JSONObject s) {
        String st = s.optString("state");
        if ("stopped".equals(st)) {
            String saved = s.optString("saved");
            if (!saved.isEmpty()) CarToast.makeText(getCarContext(), "Ride saved: " + saved, CarToast.LENGTH_LONG).show();
            return;
        }
        if ("error".equals(st)) { CarToast.makeText(getCarContext(), s.optString("text"), CarToast.LENGTH_LONG).show(); stop(true); return; }
        if ("rerouting".equals(st) && state != null) { try { state.put("state", "rerouting"); } catch (Exception ignored) { } }
        else state = s;
        if (!"ready".equals(st)) { updateTrip(); invalidate(); }
    }

    private void stop(boolean pop) {
        if (!active) return;
        active = false;
        map.js("carStop()");
        if (map.listener == this) map.listener = null;
        try { nav.navigationEnded(); } catch (Exception ignored) { }
        if (pop) getScreenManager().pop();
    }

    // ---------- the template ----------
    @NonNull @Override public Template onGetTemplate() {
        ActionStrip strip = new ActionStrip.Builder()
                .addAction(new Action.Builder().setTitle(muted ? "Unmute" : "Mute").setOnClickListener(() -> { muted = !muted; map.js("carMute(" + muted + ")"); invalidate(); }).build())
                .addAction(new Action.Builder().setTitle("End").setOnClickListener(() -> stop(true)).build())
                .build();
        NavigationTemplate.Builder t = new NavigationTemplate.Builder().setActionStrip(strip);
        String st = state == null ? "loading" : state.optString("state");
        boolean miles = state == null || !"km".equals(state.optString("units"));
        if ("free".equals(kind) || "free".equals(st)) {
            t.setNavigationInfo(new MessageInfo.Builder("Recording your ride")
                    .setText(state == null ? "Waiting for GPS" : CarHome.dist(state.optDouble("dist"), miles) + " in " + CarHome.time(state.optDouble("elapsed"))).build());
        } else if ("arrived".equals(st)) {
            t.setNavigationInfo(new MessageInfo.Builder("You've arrived").setText(state.optString("dest") + ". Tap End to save the ride.")
                    .setImage(icon(4, 0, false)).build());
        } else if ("nav".equals(st) || "rerouting".equals(st)) {
            if ("rerouting".equals(st)) t.setNavigationInfo(new RoutingInfo.Builder().setLoading(true).build());
            else {
                RoutingInfo.Builder ri = new RoutingInfo.Builder().setCurrentStep(step(state), distance(state.optDouble("toTurn"), miles));
                JSONObject next = state.optJSONObject("next");
                if (next != null) ri.setNextStep(step(next));
                t.setNavigationInfo(ri.build());
            }
            t.setDestinationTravelEstimate(estimate(state.optDouble("remain"), state.optLong("etaMs"), miles));
        } else {
            t.setNavigationInfo(new RoutingInfo.Builder().setLoading(true).build());
        }
        return t.build();
    }

    private void updateTrip() {
        if (state == null || !"nav".equals(state.optString("state"))) return;
        try {
            boolean miles = !"km".equals(state.optString("units"));
            TravelEstimate toTurn = estimate(state.optDouble("toTurn"), System.currentTimeMillis(), miles);
            TravelEstimate toEnd = estimate(state.optDouble("remain"), state.optLong("etaMs"), miles);
            Trip trip = new Trip.Builder().addStep(step(state), toTurn)
                    .addDestination(new Destination.Builder().setName(state.optString("dest", "Destination")).build(), toEnd)
                    .setCurrentRoad(state.optString("street")).build();
            nav.updateTrip(trip);
        } catch (Exception ignored) { }
    }

    private Step step(JSONObject s) {
        String road = s.optString("street");
        Step.Builder b = new Step.Builder(s.optString("text")).setManeuver(maneuver(s.optInt("type"), s.optInt("exit"), state != null && state.optBoolean("left")));
        if (!road.isEmpty()) b.setRoad(road);
        return b.build();
    }

    private static TravelEstimate estimate(double metres, long etaMs, boolean miles) {
        long now = System.currentTimeMillis(); if (etaMs < now) etaMs = now;
        return new TravelEstimate.Builder(distance(metres, miles), DateTimeWithZone.create(etaMs, TimeZone.getDefault()))
                .setRemainingTimeSeconds(Math.max(0, (etaMs - now) / 1000)).build();
    }

    static Distance distance(double m, boolean miles) {
        if (Double.isNaN(m) || m < 0) m = 0;
        if (miles) {
            if (m < 0.1 * 1609.344) return Distance.create(Math.max(10, Math.round(m / 0.9144 / 10) * 10), Distance.UNIT_YARDS);
            double mi = m / 1609.344;
            return mi < 10 ? Distance.create(Math.round(mi * 10) / 10.0, Distance.UNIT_MILES_P1) : Distance.create(Math.round(mi), Distance.UNIT_MILES);
        }
        if (m < 1000) return Distance.create(Math.round(m / 10) * 10, Distance.UNIT_METERS);
        double km = m / 1000;
        return km < 10 ? Distance.create(Math.round(km * 10) / 10.0, Distance.UNIT_KILOMETERS_P1) : Distance.create(Math.round(km), Distance.UNIT_KILOMETERS);
    }

    // ---------- Valhalla manoeuvre types to Android Auto's ----------
    private Maneuver maneuver(int t, int exit, boolean leftHandTraffic) {
        int type; int res;
        switch (t) {
            case 1: case 2: case 3: type = Maneuver.TYPE_DEPART; res = R.drawable.m_straight; break;
            case 4: type = Maneuver.TYPE_DESTINATION; res = R.drawable.m_flag; break;
            case 5: type = Maneuver.TYPE_DESTINATION_RIGHT; res = R.drawable.m_flag; break;
            case 6: type = Maneuver.TYPE_DESTINATION_LEFT; res = R.drawable.m_flag; break;
            case 7: type = Maneuver.TYPE_NAME_CHANGE; res = R.drawable.m_straight; break;
            case 9: type = Maneuver.TYPE_TURN_SLIGHT_RIGHT; res = R.drawable.m_slight_right; break;
            case 10: type = Maneuver.TYPE_TURN_NORMAL_RIGHT; res = R.drawable.m_right; break;
            case 11: type = Maneuver.TYPE_TURN_SHARP_RIGHT; res = R.drawable.m_sharp_right; break;
            case 12: type = Maneuver.TYPE_U_TURN_RIGHT; res = R.drawable.m_uturn; break;
            case 13: type = Maneuver.TYPE_U_TURN_LEFT; res = R.drawable.m_uturn; break;
            case 14: type = Maneuver.TYPE_TURN_SHARP_LEFT; res = R.drawable.m_sharp_left; break;
            case 15: type = Maneuver.TYPE_TURN_NORMAL_LEFT; res = R.drawable.m_left; break;
            case 16: type = Maneuver.TYPE_TURN_SLIGHT_LEFT; res = R.drawable.m_slight_left; break;
            case 18: type = Maneuver.TYPE_ON_RAMP_SLIGHT_RIGHT; res = R.drawable.m_slight_right; break;
            case 19: type = Maneuver.TYPE_ON_RAMP_SLIGHT_LEFT; res = R.drawable.m_slight_left; break;
            case 20: type = Maneuver.TYPE_OFF_RAMP_SLIGHT_RIGHT; res = R.drawable.m_slight_right; break;
            case 21: type = Maneuver.TYPE_OFF_RAMP_SLIGHT_LEFT; res = R.drawable.m_slight_left; break;
            case 23: type = Maneuver.TYPE_KEEP_RIGHT; res = R.drawable.m_slight_right; break;
            case 24: type = Maneuver.TYPE_KEEP_LEFT; res = R.drawable.m_slight_left; break;
            case 25: type = Maneuver.TYPE_MERGE_SIDE_UNSPECIFIED; res = R.drawable.m_merge; break;
            case 37: type = Maneuver.TYPE_MERGE_RIGHT; res = R.drawable.m_merge; break;
            case 38: type = Maneuver.TYPE_MERGE_LEFT; res = R.drawable.m_merge; break;
            case 26:
                // roundabouts go clockwise where traffic keeps left (UK, Ireland)
                if (exit > 0) type = leftHandTraffic ? Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW : Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CCW;
                else type = leftHandTraffic ? Maneuver.TYPE_ROUNDABOUT_ENTER_CW : Maneuver.TYPE_ROUNDABOUT_ENTER_CCW;
                res = R.drawable.m_round; break;
            case 27: type = leftHandTraffic ? Maneuver.TYPE_ROUNDABOUT_EXIT_CW : Maneuver.TYPE_ROUNDABOUT_EXIT_CCW; res = R.drawable.m_round; break;
            case 28: case 29: type = Maneuver.TYPE_FERRY_BOAT; res = R.drawable.m_ferry; break;
            default: type = Maneuver.TYPE_STRAIGHT; res = R.drawable.m_straight;
        }
        Maneuver.Builder b = new Maneuver.Builder(type).setIcon(new CarIcon.Builder(IconCompat.createWithResource(getCarContext(), res)).build());
        if (type == Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW || type == Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CCW) b.setRoundaboutExitNumber(exit);
        return b.build();
    }
    private CarIcon icon(int t, int exit, boolean left) {
        return new CarIcon.Builder(IconCompat.createWithResource(getCarContext(), R.drawable.m_flag)).build();
    }
}
