// Heart-rate estimation + simple "is there a heart sound at all" gate.
// Used both for the live BPM readout and the no-heartbeat overlay.

import {
  BPM_BAND_HIGH,
  BPM_BAND_LOW,
  BPM_MAX,
  BPM_MIN,
  TARGET_SR,
} from './audio/constants';
import { bandpass } from './audio/filter';
import { resamplePoly } from './audio/resample';
import type { Analysis } from './audio/types';

// Below this RMS the signal is essentially silence — no point estimating BPM.
const SILENCE_RMS = 0.002;

// The autocorrelation peak relative to lag=0 energy must clear this for us to
// trust the BPM number. Empirical; tune if false positives/negatives appear.
const PEAK_CONFIDENCE = 0.18;

function envelope(x: Float32Array, windowSamples: number): Float32Array {
  const abs = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) abs[i] = Math.abs(x[i]);
  const out = new Float32Array(x.length);
  const half = Math.floor(windowSamples / 2);
  let acc = 0;
  for (let i = 0; i < Math.min(windowSamples, x.length); i++) acc += abs[i];
  for (let i = 0; i < x.length; i++) {
    if (i > half && i + half < x.length) {
      acc += abs[i + half] - abs[i - half - 1];
    }
    out[i] = acc / windowSamples;
  }
  return out;
}

function rmsOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

export function analyzeWindow(raw: Float32Array, sampleRate: number): Analysis {
  if (raw.length < sampleRate * 2) {
    return { bpm: null, hasBeat: false, rms: 0 };
  }
  const rms = rmsOf(raw);
  if (rms < SILENCE_RMS) {
    return { bpm: null, hasBeat: false, rms };
  }

  const ds = sampleRate === TARGET_SR ? raw : resamplePoly(raw, sampleRate, TARGET_SR);
  const filt = bandpass(ds, BPM_BAND_LOW, BPM_BAND_HIGH, TARGET_SR, 4);
  const env = envelope(filt, Math.round(TARGET_SR * 0.05));

  // Decimate the (already-smoothed) envelope before autocorrelation. A heartbeat
  // is < 4 Hz, so the 4 kHz envelope is ~1000x oversampled for this step —
  // correlating it directly is ~78M multiply-adds per call and blocks the JS
  // thread. Average-pool to ~125 Hz: same BPM result, ~1000x cheaper.
  const DECIM = 32;
  const decSR = TARGET_SR / DECIM; // 125 Hz
  const decLen = Math.floor(env.length / DECIM);
  if (decLen < 8) return { bpm: null, hasBeat: false, rms };
  const denv = new Float32Array(decLen);
  for (let i = 0; i < decLen; i++) {
    let s = 0;
    const base = i * DECIM;
    for (let j = 0; j < DECIM; j++) s += env[base + j];
    denv[i] = s / DECIM;
  }

  // Remove mean.
  let mean = 0;
  for (let i = 0; i < decLen; i++) mean += denv[i];
  mean /= decLen;
  for (let i = 0; i < decLen; i++) denv[i] -= mean;

  // Reference: zero-lag autocorrelation (signal energy).
  let zero = 0;
  for (let i = 0; i < decLen; i++) zero += denv[i] * denv[i];
  if (zero <= 0) return { bpm: null, hasBeat: false, rms };

  const lagMin = Math.max(1, Math.floor((60 / BPM_MAX) * decSR));
  const lagMax = Math.min(decLen - 1, Math.floor((60 / BPM_MIN) * decSR));

  let bestLag = -1;
  let bestVal = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let acc = 0;
    const len = decLen - lag;
    for (let i = 0; i < len; i++) acc += denv[i] * denv[i + lag];
    if (acc > bestVal) {
      bestVal = acc;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return { bpm: null, hasBeat: false, rms };

  const confidence = bestVal / zero;
  const hasBeat = confidence >= PEAK_CONFIDENCE;
  const bpm = Math.round((60 * decSR) / bestLag);
  return { bpm: hasBeat ? bpm : null, hasBeat, rms };
}

// Kept for the post-recording one-shot readout — same algorithm, just returns
// the number.
export function estimateBPM(raw: Float32Array, sampleRate: number): number | null {
  return analyzeWindow(raw, sampleRate).bpm;
}
