package uk.openroad.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.KeyEvent;

import org.json.JSONObject;

import java.util.ArrayList;

/**
 * Hands-free: listens for a spoken command (on-screen mic, or the intercom/headset button if switched on)
 * and passes the words to the web app; and turn alerts as notifications, which a paired watch shows and buzzes for.
 */
final class Voice {
    interface Out { void js(String code); }
    private static Voice inst;
    static synchronized Voice get(Context c) { if (inst == null) inst = new Voice(c.getApplicationContext()); return inst; }

    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private MediaSession session;
    volatile Out out;
    private boolean listening = false;

    private Voice(Context c) { ctx = c; }

    void listen() {
        main.post(() -> {
            if (!SpeechRecognizer.isRecognitionAvailable(ctx)) { send("window.onVoiceError&&onVoiceError('Speech recognition isn\\'t available on this phone')"); return; }
            if (listening) { stopListening(); return; }
            Speech.get(ctx).stop();
            try {
                if (rec == null) {
                    rec = SpeechRecognizer.createSpeechRecognizer(ctx);
                    rec.setRecognitionListener(new RecognitionListener() {
                        @Override public void onReadyForSpeech(Bundle b) { send("window.onVoiceState&&onVoiceState('listening')"); }
                        @Override public void onBeginningOfSpeech() { }
                        @Override public void onRmsChanged(float v) { }
                        @Override public void onBufferReceived(byte[] b) { }
                        @Override public void onEndOfSpeech() { send("window.onVoiceState&&onVoiceState('thinking')"); }
                        @Override public void onError(int e) {
                            listening = false;
                            String why = e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "I didn't catch that" : e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "OpenRoad needs the microphone permission" : e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ? "No signal for speech recognition" : "Voice command didn't work (" + e + ")";
                            send("window.onVoiceError&&onVoiceError(" + JSONObject.quote(why) + ")");
                        }
                        @Override public void onResults(Bundle b) {
                            listening = false;
                            ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            send("window.onVoice&&onVoice(" + JSONObject.quote(r == null || r.isEmpty() ? "" : r.get(0)) + ")");
                        }
                        @Override public void onPartialResults(Bundle b) { }
                        @Override public void onEvent(int t, Bundle b) { }
                    });
                }
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB").putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                listening = true;
                rec.startListening(i);
            } catch (Exception e) { listening = false; send("window.onVoiceError&&onVoiceError(" + JSONObject.quote("Voice command didn't start: " + e.getMessage()) + ")"); }
        });
    }
    void stopListening() { main.post(() -> { listening = false; try { if (rec != null) rec.cancel(); } catch (Exception ignored) { } send("window.onVoiceState&&onVoiceState('idle')"); }); }
    private void send(String code) { Out o = out; if (o != null) o.js(code); }

    // ---------- the intercom or headset button ----------
    /** While on, a press of the play/pause button (most intercoms have one) starts a voice command. */
    void button(boolean on) {
        main.post(() -> {
            if (on) {
                if (session == null) {
                    session = new MediaSession(ctx, "OpenRoad voice");
                    session.setCallback(new MediaSession.Callback() {
                        @Override public boolean onMediaButtonEvent(Intent in) {
                            KeyEvent k = in.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                            if (k != null && k.getAction() == KeyEvent.ACTION_DOWN && k.getRepeatCount() == 0) {
                                int c = k.getKeyCode();
                                if (c == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || c == KeyEvent.KEYCODE_HEADSETHOOK || c == KeyEvent.KEYCODE_MEDIA_PLAY || c == KeyEvent.KEYCODE_MEDIA_PAUSE) { listen(); return true; }
                            }
                            return super.onMediaButtonEvent(in);
                        }
                    });
                }
                session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE)
                        .setState(PlaybackState.STATE_PLAYING, 0, 1f).build());
                session.setActive(true);
            } else if (session != null) { session.setActive(false); session.release(); session = null; }
        });
    }

    // ---------- turn alerts for a watch ----------
    private static final int TURN_NOTE = 51;
    void turn(String text) {
        try {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("turns") == null) {
                NotificationChannel ch = new NotificationChannel("turns", "Turn alerts (for a watch)", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("A short alert at each turn, so a paired watch buzzes and shows it");
                ch.enableVibration(true); ch.setVibrationPattern(new long[]{0, 250, 150, 250}); ch.setSound(null, null);
                nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            PendingIntent pi = PendingIntent.getActivity(ctx, 5, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, "turns") : new Notification.Builder(ctx);
            b.setSmallIcon(android.R.drawable.ic_menu_directions).setContentTitle(text).setContentIntent(pi).setAutoCancel(true)
                    .setCategory(Notification.CATEGORY_NAVIGATION).setOnlyAlertOnce(false);
            if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(20000);
            nm.notify(TURN_NOTE, b.build());
        } catch (Exception ignored) { }
    }
}
