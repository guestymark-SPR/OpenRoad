package uk.openroad.app;

import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.Screen;
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
                return new CarHome(getCarContext(), map);
            }
            @Override public void onCarConfigurationChanged(@NonNull android.content.res.Configuration c) {
                if (map != null) map.js("carTheme('" + (getCarContext().isDarkMode() ? "night" : "day") + "')");
            }
        };
    }
}
