// Música y efectos del tráiler, sintetizados en vivo con Web Audio. La pista es
// una composición original para este tráiler (sin samples ni melodías de
// terceros), así que se puede subir a redes sin reclamos de copyright.
//
// Chiptune a 124 BPM en La menor: Am · F · C · G, y en las escenas de triunfo la
// relativa mayor (C · G · Am · F) con una fanfarria. Cada escena elige una
// sección; los cambios caen al inicio del compás siguiente.

export type Section = "intro" | "build" | "full" | "triumph" | "outro";
export type Hit = "impact" | "glitch" | "boot" | "shimmer" | "blip";

const BPM = 124;
const STEP = 60 / BPM / 4; // semicorchea
const LOOKAHEAD = 0.12;

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
// Acordes como notas MIDI (raíz en la octava del bajo).
const MINOR = [
  [45, 48, 52], // Am
  [41, 45, 48], // F
  [48, 52, 55], // C
  [43, 47, 50], // G
];
const MAJOR = [
  [48, 52, 55], // C
  [43, 47, 50], // G
  [45, 48, 52], // Am
  [41, 45, 48], // F
];
// Fanfarria de 2 compases (semicorcheas; 0 = silencio), sobre la mayor.
const FANFARE = [
  76, 0, 76, 0, 79, 0, 0, 0, 84, 0, 0, 0, 83, 0, 79, 0, 81, 0, 79, 0, 76, 0, 0,
  0, 79, 0, 0, 0, 0, 0, 0, 0,
];
// Gancho de la sección "full": corto y repetible.
const HOOK = [
  69, 0, 72, 0, 76, 0, 74, 72, 0, 0, 69, 0, 67, 0, 69, 0, 65, 0, 69, 0, 72, 0,
  71, 69, 0, 0, 67, 0, 64, 0, 67, 0,
];

export class Score {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private section: Section = "intro";
  private next: Section = "intro";
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private muted = false;

  /** Se llama desde un clic (los navegadores no dejan sonar sin un gesto). */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.nextTime = ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx)
      this.master.gain.setTargetAtTime(
        muted ? 0 : 0.8,
        this.ctx.currentTime,
        0.05,
      );
  }

  isMuted() {
    return this.muted;
  }

  /** Cambia de sección al empezar el próximo compás (o ya, si recién arranca). */
  setSection(section: Section, now = false) {
    this.next = section;
    if (now) {
      this.section = section;
      this.step = 0;
    }
    if (this.ctx && section === "outro") {
      this.music.gain.setTargetAtTime(0.0001, this.ctx.currentTime + 2.5, 1.2);
    } else if (this.ctx) {
      this.music.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.3);
    }
  }

  /** Efecto puntual: cortes entre escenas y palabras que aparecen. */
  hit(kind: Hit) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    if (kind === "impact") {
      this.kick(t, 1.1, 0.45);
      this.noiseBurst(t, 0.5, 0.35, 900, "lowpass");
    } else if (kind === "glitch") {
      for (let i = 0; i < 5; i++)
        this.tone(t + i * 0.035, midi(84 - i * 5), 0.03, "square", 0.12);
      this.noiseBurst(t, 0.12, 0.18, 4000, "highpass");
    } else if (kind === "boot") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(60, t);
      osc.frequency.exponentialRampToValueAtTime(1200, t + 0.5);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.6);
    } else if (kind === "shimmer") {
      [72, 76, 79, 84, 88].forEach((n, i) =>
        this.tone(t + i * 0.06, midi(n), 0.5, "triangle", 0.12),
      );
    } else {
      this.tone(t, midi(88), 0.05, "square", 0.08);
    }
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      if (this.step % 16 === 0 && this.next !== this.section) {
        this.section = this.next;
        this.step = 0;
      }
      this.play(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % 64;
    }
  }

  private play(step: number, t: number) {
    const section = this.section;
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const chords = section === "triumph" ? MAJOR : MINOR;
    const chord = chords[bar]!;
    const out = this.music;

    // Pad: el acorde sostenido al inicio de cada compás.
    if (s === 0)
      chord.forEach((n) =>
        this.tone(t, midi(n + 12), STEP * 15, "triangle", 0.035, out),
      );
    if (section === "outro") return;

    // Arpegio en semicorcheas.
    if (section !== "build" || s % 2 === 0) {
      const note = chord[s % 3]! + 24 + (s >= 8 ? 12 : 0);
      this.tone(
        t,
        midi(note),
        STEP * 0.9,
        "square",
        section === "intro" ? 0.025 : 0.03,
        out,
      );
    }
    if (section === "intro") return;

    // Bajo en corcheas.
    if (s % 2 === 0)
      this.tone(t, midi(chord[0]! - 12), STEP * 1.6, "square", 0.07, out);
    // Hats.
    if (s % 2 === 0)
      this.noiseBurst(
        t,
        0.03,
        s % 4 === 2 ? 0.06 : 0.03,
        7000,
        "highpass",
        out,
      );
    if (section === "build") {
      // Redoble que sube en el último compás de la vuelta.
      if (bar === 3 && s >= 8)
        this.noiseBurst(t, 0.05, 0.03 + (s - 8) * 0.012, 2000, "bandpass", out);
      return;
    }

    // Bombo y caja.
    if (s % 4 === 0) this.kick(t, 0.9, 0.18, out);
    if (s === 4 || s === 12)
      this.noiseBurst(t, 0.12, 0.16, 1800, "bandpass", out);

    // Melodía: gancho o fanfarria.
    const line = section === "triumph" ? FANFARE : HOOK;
    const n = line[step % 32];
    if (n) this.tone(t, midi(n), STEP * 1.8, "square", 0.05, out);
  }

  private tone(
    t: number,
    freq: number,
    length: number,
    type: OscillatorType,
    volume: number,
    out: AudioNode = this.master,
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  private kick(
    t: number,
    volume: number,
    length: number,
    out: AudioNode = this.master,
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + length);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  private noiseBurst(
    t: number,
    length: number,
    volume: number,
    freq: number,
    type: BiquadFilterType,
    out: AudioNode = this.master,
  ) {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    source.connect(filter).connect(gain).connect(out);
    source.start(t, Math.random() * 0.5);
    source.stop(t + length + 0.02);
  }
}

/** Una sola instancia: el director y las escenas comparten la música. */
export const score = new Score();
