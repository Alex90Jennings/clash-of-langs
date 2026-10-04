type Cue = "key" | "start" | "tick" | "run" | "complete" | "glitch" | "select";

let ctx: AudioContext | null = null;
let enabled = false;

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (on && !ctx && typeof window !== "undefined") {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) ctx = new Ctor();
  }
  if (on) void ctx?.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, at = 0, slideTo?: number) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, gain: number) {
  if (!ctx) return;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  src.start();
}

export function play(cue: Cue) {
  if (!enabled || !ctx) return;
  switch (cue) {
    case "key":
      tone(1800 + Math.random() * 400, 0.025, "square", 0.015);
      break;
    case "select":
      tone(660, 0.06, "square", 0.03);
      tone(990, 0.08, "square", 0.025, 0.05);
      break;
    case "tick":
      tone(440, 0.12, "sine", 0.06);
      break;
    case "start":
      tone(110, 0.6, "sawtooth", 0.05, 0, 880);
      break;
    case "run":
      tone(1200, 0.03, "triangle", 0.025);
      break;
    case "complete":
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, "square", 0.03, i * 0.09));
      break;
    case "glitch":
      noise(0.18, 0.05);
      break;
  }
}
