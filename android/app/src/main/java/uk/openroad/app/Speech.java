package uk.openroad.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Spoken directions, as navigation audio: music is turned down while it speaks (helmet headset or car speakers). */
final class Speech {
    private static Speech inst;
    static synchronized Speech get(Context c) { if (inst == null) inst = new Speech(c.getApplicationContext()); return inst; }

    private final Context ctx;
    private final AudioManager audio;
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private volatile boolean ready;
    private final List<String> queue = new ArrayList<>();
    private AudioFocusRequest focusReq;

    private Speech(Context c) { ctx = c; audio = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE); }

    void speak(final String text) { main.post(() -> speakNow(text)); }
    // a turn or bend: a short chime then the words, in the ear it's on (pan -1 left to 1 right; needs a stereo headset)
    void speakPan(final String text, final float pan) {
        main.post(() -> {
            if (tts == null || !ready) { speakNow(text); return; }
            focus();
            tone(pan);
            Bundle b = new Bundle(); b.putFloat(TextToSpeech.Engine.KEY_PARAM_PAN, Math.max(-1f, Math.min(1f, pan)));
            tts.playSilentUtterance(260, TextToSpeech.QUEUE_ADD, "sil" + System.nanoTime());
            tts.speak(text, TextToSpeech.QUEUE_ADD, b, "or" + System.nanoTime());
        });
    }
    private void tone(float pan) {
        try {
            final int rate = 22050, n = (int) (rate * 0.2);
            short[] pcm = new short[n * 2];
            float l = pan > 0 ? 0.12f : 1f, r = pan < 0 ? 0.12f : 1f;
            for (int i = 0; i < n; i++) {
                double t = (double) i / rate, f = t < 0.09 ? 880 : 1175, env = Math.sin(Math.PI * ((t < 0.09 ? t : t - 0.1) / 0.09));
                double v = (t >= 0.09 && t < 0.1) ? 0 : Math.sin(2 * Math.PI * f * t) * Math.max(0, env) * 0.45;
                pcm[i * 2] = (short) (v * l * 32767); pcm[i * 2 + 1] = (short) (v * r * 32767);
            }
            android.media.AudioTrack at = new android.media.AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    .setAudioFormat(new android.media.AudioFormat.Builder().setSampleRate(rate).setEncoding(android.media.AudioFormat.ENCODING_PCM_16BIT).setChannelMask(android.media.AudioFormat.CHANNEL_OUT_STEREO).build())
                    .setBufferSizeInBytes(pcm.length * 2).setTransferMode(android.media.AudioTrack.MODE_STATIC).build();
            at.write(pcm, 0, pcm.length); at.play();
            main.postDelayed(() -> { try { at.release(); } catch (Exception ignored) { } }, 800);
        } catch (Exception ignored) { }
    }
    void stop() { main.post(() -> { if (tts != null) tts.stop(); release(); }); }

    private void speakNow(String text) {
        if (tts == null) {
            synchronized (queue) { queue.add(text); }
            tts = new TextToSpeech(ctx, st -> {
                if (st != TextToSpeech.SUCCESS) return;
                tts.setLanguage(Locale.UK);
                tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { if (!tts.isSpeaking()) release(); }
                    @Override public void onError(String id) { release(); }
                });
                ready = true;
                synchronized (queue) { for (String q : queue) say(q); queue.clear(); }
            });
            return;
        }
        if (!ready) { synchronized (queue) { queue.add(text); } return; }
        say(text);
    }
    private void say(String text) { focus(); tts.speak(text, TextToSpeech.QUEUE_ADD, null, "or" + System.nanoTime()); }
    private void focus() {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).build();
                audio.requestAudioFocus(focusReq);
            }
        } catch (Exception ignored) { }
    }
    // a phrase in another language (phrasebook), on its own voice so directions stay in English
    private TextToSpeech other; private String otherLang = "";
    void speakIn(final String text, final String tag, final Tiles.Js js) {
        main.post(() -> {
            Runnable go = () -> {
                int r = other.setLanguage(Locale.forLanguageTag(tag));
                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) { if (js != null) js.run("window.onPhraseVoice&&onPhraseVoice('missing')"); return; }
                other.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ph" + System.nanoTime());
            };
            if (other == null || !tag.equals(otherLang)) {
                if (other != null) other.shutdown();
                otherLang = tag;
                other = new TextToSpeech(ctx, st -> { if (st == TextToSpeech.SUCCESS) go.run(); });
            } else go.run();
        });
    }
    private void release() { try { if (Build.VERSION.SDK_INT >= 26 && focusReq != null) audio.abandonAudioFocusRequest(focusReq); } catch (Exception ignored) { } }
}
