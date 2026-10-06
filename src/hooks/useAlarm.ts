import { useCallback, useEffect, useRef } from "react";

/**
 * Web Audio alarm driven by drowsiness *state transitions*, not raw EAR.
 * WARNING plays a one-shot chime (never looped — looping trains people to ignore it).
 * ALARM is a looping 880 Hz square stutter that stops the moment state leaves ALARM.
 *
 * AudioContext is created/resumed from the Start button (a user gesture) so
 * autoplay policy does not mute the first warning.
 */
export function useAlarm() {
  const ctxRef = useRef<AudioContext | null>(null);
  const alarmNodesRef = useRef<{
    osc: OscillatorNode;
    lfo: OscillatorNode;
    gain: GainNode;
  } | null>(null);

  const getContext = useCallback((): AudioContext | null => {
    return ctxRef.current;
  }, []);

  const unlock = useCallback(async () => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    if (!ctxRef.current) {
      ctxRef.current = new AudioCtx();
    }
    if (ctxRef.current.state === "suspended") {
      await ctxRef.current.resume();
    }
  }, []);

  const stopAlarm = useCallback(() => {
    const nodes = alarmNodesRef.current;
    if (!nodes) return;
    try {
      nodes.osc.stop();
      nodes.lfo.stop();
    } catch {
      // already stopped
    }
    nodes.osc.disconnect();
    nodes.lfo.disconnect();
    nodes.gain.disconnect();
    alarmNodesRef.current = null;
  }, []);

  const chime = useCallback(() => {
    const ctx = getContext();
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
  }, [getContext]);

  const startAlarm = useCallback(() => {
    const ctx = getContext();
    if (!ctx) return;
    if (alarmNodesRef.current) return;

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 880;

    const gain = ctx.createGain();
    gain.gain.value = 0.09;

    // Square LFO pulses gain on/off (~6 Hz stutter).
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 6;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.09;
    lfo.connect(lfoDepth);
    lfoDepth.connect(gain.gain);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    lfo.start();
    alarmNodesRef.current = { osc, lfo, gain };
  }, [getContext]);

  useEffect(() => {
    return () => {
      stopAlarm();
      const ctx = ctxRef.current;
      if (ctx) {
        void ctx.close();
        ctxRef.current = null;
      }
    };
  }, [stopAlarm]);

  return { unlock, chime, startAlarm, stopAlarm };
}
