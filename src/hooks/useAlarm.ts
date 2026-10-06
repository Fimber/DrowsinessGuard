import { useCallback, useEffect, useRef } from "react";

const ALARM_SRC = "/sounds/OGAWAKEUP.mp4";
/** Boost above file volume so ALARM cuts through cabin noise. */
const ALARM_GAIN = 4;

function createAudioContext(): AudioContext | null {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  return AudioCtx ? new AudioCtx() : null;
}

/**
 * WARNING: one-shot synthesized chime (never looped).
 * ALARM: looping OGAWAKEUP clip at high gain. Stops the moment state leaves ALARM.
 *
 * AudioContext + a muted prime-play run on Start so autoplay policy allows the alarm.
 */
export function useAlarm() {
  const ctxRef = useRef<AudioContext | null>(null);
  const alarmElRef = useRef<HTMLVideoElement | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const hookedRef = useRef(false);

  const ensureAlarmEl = useCallback((): HTMLVideoElement => {
    if (alarmElRef.current) return alarmElRef.current;
    const el = document.createElement("video");
    el.src = ALARM_SRC;
    el.loop = true;
    el.preload = "auto";
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.volume = 1;
    alarmElRef.current = el;
    return el;
  }, []);

  const hookBoost = useCallback((ctx: AudioContext, el: HTMLVideoElement) => {
    if (hookedRef.current) return;
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = ALARM_GAIN;
    source.connect(gain);
    gain.connect(ctx.destination);
    gainRef.current = gain;
    hookedRef.current = true;
  }, []);

  const unlock = useCallback(async () => {
    if (!ctxRef.current) {
      ctxRef.current = createAudioContext();
    }
    const ctx = ctxRef.current;
    if (ctx?.state === "suspended") {
      await ctx.resume();
    }

    const el = ensureAlarmEl();
    if (ctx) hookBoost(ctx, el);

    el.muted = true;
    try {
      await el.play();
      el.pause();
      el.currentTime = 0;
    } catch {
      // Gesture may still be enough for a later unmuted play().
    }
    el.muted = false;
    el.volume = 1;
  }, [ensureAlarmEl, hookBoost]);

  const stopAlarm = useCallback(() => {
    const el = alarmElRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  }, []);

  const chime = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    const ping = (freq: number, when: number, duration: number, peak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(peak, when + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + duration + 0.02);
    };

    const now = ctx.currentTime;
    ping(523.25, now, 0.22, 0.12);
    ping(659.25, now + 0.14, 0.28, 0.1);
  }, []);

  const startAlarm = useCallback(() => {
    const el = ensureAlarmEl();
    const ctx = ctxRef.current;
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume();
      hookBoost(ctx, el);
      if (gainRef.current) gainRef.current.gain.value = ALARM_GAIN;
    }
    el.muted = false;
    el.volume = 1;
    el.loop = true;
    if (el.currentTime > 0) el.currentTime = 0;
    void el.play().catch(() => {
      // If autoplay is still blocked, Start already tried to unlock.
    });
  }, [ensureAlarmEl, hookBoost]);

  useEffect(() => {
    return () => {
      stopAlarm();
      alarmElRef.current = null;
      gainRef.current = null;
      hookedRef.current = false;
      const ctx = ctxRef.current;
      if (ctx) {
        void ctx.close();
        ctxRef.current = null;
      }
    };
  }, [stopAlarm]);

  return { unlock, chime, startAlarm, stopAlarm };
}
