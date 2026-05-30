// Always-on audio capture for React Native, ported from the web app's
// StethoscopeMonitor. The web version streamed Web Audio AudioWorklet frames
// into a ring buffer; here we stream raw PCM frames from
// @picovoice/react-native-voice-processor instead. "Recording" is still just a
// flag that copies the next N seconds of the same stream into a buffer.
//
// On Android a connected USB Audio Class stethoscope is routed as the active
// mic input, so the default capture path picks it up.

import {
  VoiceProcessor,
  type VoiceProcessorError,
} from '@picovoice/react-native-voice-processor';

import { RECORDING_LENGTH_S } from './constants';
import type { Analysis, Recording } from './types';

export type MonitorOpts = {
  sampleRate?: number; // capture rate (default 16000)
  frameLength?: number; // samples per frame (default 512)
  bufferS?: number; // live ring buffer length (default 15 s)
  analyzeEveryMs?: number; // BPM cadence (default 1000 ms)
  analyzeWindowS?: number; // analysis window length (default 5 s)
  onChunk?: (chunk: Float32Array, sampleRate: number) => void;
  onAnalysis?: (a: Analysis) => void;
  onRecordingProgress?: (seconds: number) => void;
  onRecordingChunk?: (accumulated: Float32Array, sampleRate: number) => void;
  onRecordingComplete?: (rec: Recording) => void;
  onError?: (e: Error) => void;
};

export type MonitorState = 'idle' | 'starting' | 'monitoring' | 'stopped';

export class StethoscopeMonitor {
  state: MonitorState = 'idle';

  private vp = VoiceProcessor.instance;
  private sampleRate = 16000;

  private ring: Float32Array = new Float32Array(0);
  private ringWrite = 0;
  private ringFilled = false;

  private recording = false;
  private recordBuffer: Float32Array = new Float32Array(0);
  private recordSamples = 0;
  private recordTargetSamples = 0;
  private recordStartedAt = 0;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private analysisTimer: ReturnType<typeof setInterval> | null = null;

  private analyzeFn:
    | ((samples: Float32Array, sampleRate: number) => Analysis)
    | null = null;

  private frameListener = (frame: number[]) => this.onFrame(frame);
  private errorListener = (e: VoiceProcessorError) =>
    this.opts.onError?.(new Error(e.message ?? String(e)));

  constructor(private opts: MonitorOpts = {}) {}

  setAnalyzer(fn: (samples: Float32Array, sampleRate: number) => Analysis) {
    this.analyzeFn = fn;
  }

  async start(): Promise<void> {
    if (this.state === 'monitoring' || this.state === 'starting') return;
    this.state = 'starting';

    this.sampleRate = this.opts.sampleRate ?? 16000;
    const bufferS = this.opts.bufferS ?? 15;
    this.ring = new Float32Array(Math.ceil(bufferS * this.sampleRate));
    this.ringWrite = 0;
    this.ringFilled = false;

    this.vp.addFrameListener(this.frameListener);
    this.vp.addErrorListener(this.errorListener);
    await this.vp.start(this.opts.frameLength ?? 512, this.sampleRate);

    const cadence = this.opts.analyzeEveryMs ?? 1000;
    this.analysisTimer = setInterval(() => this.runAnalysis(), cadence);

    this.state = 'monitoring';
  }

  async stop(): Promise<void> {
    if (this.state !== 'monitoring' && this.state !== 'starting') return;
    this.state = 'stopped';
    if (this.analysisTimer !== null) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
    if (this.progressTimer !== null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    this.recording = false;
    this.recordBuffer = new Float32Array(0);

    this.vp.removeFrameListener(this.frameListener);
    this.vp.removeErrorListener(this.errorListener);
    try {
      if (await this.vp.isRecording()) await this.vp.stop();
    } catch {
      // best-effort
    }
  }

  startRecording(seconds: number = RECORDING_LENGTH_S): void {
    if (this.state !== 'monitoring' || this.recording) return;
    this.recordTargetSamples = Math.round(seconds * this.sampleRate);
    this.recordBuffer = new Float32Array(this.recordTargetSamples);
    this.recordSamples = 0;
    this.recordStartedAt = Date.now();
    this.recording = true;
    if (this.opts.onRecordingProgress) {
      this.progressTimer = setInterval(() => {
        const elapsed = (Date.now() - this.recordStartedAt) / 1000;
        this.opts.onRecordingProgress?.(Math.min(elapsed, seconds));
      }, 100);
    }
  }

  cancelRecording(): void {
    if (!this.recording) return;
    this.recording = false;
    this.recordBuffer = new Float32Array(0);
    this.recordSamples = 0;
    if (this.progressTimer !== null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  /** Returns the last `seconds` of audio from the ring buffer. */
  snapshot(seconds: number): Float32Array {
    const want = Math.min(
      Math.round(seconds * this.sampleRate),
      this.ringFilled ? this.ring.length : this.ringWrite,
    );
    const out = new Float32Array(want);
    const cap = this.ring.length;
    if (cap === 0) return out;
    let start = this.ringWrite - want;
    if (start < 0) start += cap;
    for (let i = 0; i < want; i++) out[i] = this.ring[(start + i) % cap];
    return out;
  }

  private onFrame(frame: number[]): void {
    // Int16 PCM -> Float32 [-1, 1].
    const n = frame.length;
    const chunk = new Float32Array(n);
    for (let i = 0; i < n; i++) chunk[i] = frame[i] / 32768;

    // Ring buffer write.
    const cap = this.ring.length;
    if (cap > 0) {
      let off = 0;
      while (off < n) {
        const space = cap - this.ringWrite;
        const take = Math.min(space, n - off);
        this.ring.set(chunk.subarray(off, off + take), this.ringWrite);
        this.ringWrite += take;
        if (this.ringWrite >= cap) {
          this.ringWrite = 0;
          this.ringFilled = true;
        }
        off += take;
      }
    }

    // Forward to UI (live waveform).
    this.opts.onChunk?.(chunk, this.sampleRate);

    // Recording capture.
    if (this.recording) {
      const remaining = this.recordTargetSamples - this.recordSamples;
      const take = Math.min(remaining, n);
      if (take > 0) {
        this.recordBuffer.set(chunk.subarray(0, take), this.recordSamples);
        this.recordSamples += take;
        this.opts.onRecordingChunk?.(
          this.recordBuffer.subarray(0, this.recordSamples),
          this.sampleRate,
        );
      }
      if (this.recordSamples >= this.recordTargetSamples) {
        this.finishRecording();
      }
    }
  }

  private finishRecording(): void {
    this.recording = false;
    if (this.progressTimer !== null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    const total = this.recordSamples;
    const rec: Recording = {
      samples: this.recordBuffer.slice(0, total),
      sampleRate: this.sampleRate,
      durationS: total / this.sampleRate,
    };
    this.opts.onRecordingProgress?.(rec.durationS);
    this.opts.onRecordingComplete?.(rec);
  }

  private runAnalysis(): void {
    if (!this.analyzeFn || !this.opts.onAnalysis) return;
    const windowS = this.opts.analyzeWindowS ?? 5;
    const have = this.ringFilled ? this.ring.length : this.ringWrite;
    if (have < this.sampleRate * 2) return; // need at least 2 s
    const snap = this.snapshot(Math.min(windowS, have / this.sampleRate));
    try {
      const result = this.analyzeFn(snap, this.sampleRate);
      this.opts.onAnalysis(result);
    } catch {
      // Swallow — don't kill the monitor on analysis errors.
    }
  }
}

// Whether a record-audio permission has already been granted, per the
// voice processor (it requests at start() if not).
export async function hasMicPermission(): Promise<boolean> {
  try {
    return await VoiceProcessor.instance.hasRecordAudioPermission();
  } catch {
    return false;
  }
}
