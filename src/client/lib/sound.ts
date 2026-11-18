export type Cue = "done" | "needsInput";

interface Note {
  frequency: number;
  /** Seconds after the cue starts. */
  start: number;
  duration: number;
  wave: OscillatorType;
}

/**
 * Two short synthesised cues, so there are no audio files to load. "Done" rises (E5 then B5);
 * "needs input" is a lower double knock, so the two are easy to tell apart without looking.
 */
const CUES: Record<Cue, Note[]> = {
  done: [
    { frequency: 659.25, start: 0, duration: 0.22, wave: "sine" },
    { frequency: 987.77, start: 0.12, duration: 0.32, wave: "sine" },
  ],
  needsInput: [
    { frequency: 440, start: 0, duration: 0.12, wave: "triangle" },
    { frequency: 440, start: 0.18, duration: 0.12, wave: "triangle" },
  ],
};

const PEAK_GAIN = 0.3;

class SoundEngine {
  private context: AudioContext | null = null;

  /** Browsers only allow audio after a click or key press; call this from one. */
  unlock(): void {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
  }

  get ready(): boolean {
    return this.context?.state === "running";
  }

  play(cue: Cue, volume: number): void {
    const context = this.context;
    if (!context || context.state !== "running" || volume <= 0) return;
    const now = context.currentTime;
    for (const note of CUES[cue]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = note.wave;
      oscillator.frequency.value = note.frequency;
      const start = now + note.start;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN * volume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + note.duration + 0.02);
    }
  }
}

export const sound = new SoundEngine();
