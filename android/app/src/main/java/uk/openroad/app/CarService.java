package uk.openroad.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.Screen;
import androidx.car.app.ScreenManager;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

/** OpenRoad on Android Auto. */
public final class CarService extends CarAppService {
    // OpenRoad isn't from the Play Store, so it accepts any Android Auto host (Android Auto must allow unknown sources).
    @NonNull @Override public HostValidator createHostValidator() { return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR; }

    @NonNull @Override public Session onCreateSession() {
        return new Session() {
            CarMap map;
            @NonNull @Override public Screen onCreateScreen(@NonNull Intent intent) {
                map = new CarMap(getCarContext());
                getLifecycle().addObserver(new DefaultLifecycleObserver() {
                    @Override public void onDestroy(@NonNull LifecycleOwner o) { if (map != null) map.destroy(); }
                });
                final Intent first = intent;
                new Handler(Looper.getMainLooper()).post(() -> open(first));
                return new CarHome(getCarContext(), map);
            }
            @Override public void onNewIntent(@NonNull Intent intent) { open(intent); }

            /** "Navigate to X" from the Assistant or another app: geo:lat,lng?q=name, or geo:0,0?q=text to search. */
            private void open(Intent intent) {
                try {
                    Uri u = intent == null ? null : intent.getData();
                    if (u == null || !"geo".equals(u.getScheme()) || map == null) return;
                    String q = u.getQueryParameter("q"), ssp = u.getSchemeSpecificPart();
                    double lat = 0, lng = 0;
                    String[] ll = (ssp == null ? "" : ssp.split("\\?")[0]).split(",");
                    if (ll.length >= 2) { lat = Double.parseDouble(ll[0].trim()); lng = Double.parseDouble(ll[1].trim()); }
                    ScreenManager sm = getCarContext().getCarService(ScreenManager.class);
                    if (lat != 0 || lng != 0) sm.push(new CarNav(getCarContext(), map, q == null || q.isEmpty() ? "Destination" : q, lat, lng));
                    else if (q != null && !q.isEmpty()) sm.push(new CarSearch(getCarContext(), map, q));
                } catch (Exception ignored) { }
            }
            @Override public void onCarConfigurationChanged(@NonNull android.content.res.Configuration c) {
                if (map != null) map.js("carTheme('" + (getCarContext().isDarkMode() ? "night" : "day") + "')");
            }
        };
    }
}
