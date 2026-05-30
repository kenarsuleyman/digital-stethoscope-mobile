// Single-shot magnitude spectrum (FFT) for the frequency-domain plot.
// Hann-windowed, zero-padded to the next power of two. Returns magnitudes up
// to `maxHz`, normalized to [0, 1] for display.

import { fftRadix2 } from './melspectrogram';

export type Spectrum = {
  freqs: Float32Array; // Hz per bin
  mags: Float32Array; // normalized magnitude in [0, 1]
};

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function magnitudeSpectrum(
  x: Float32Array,
  sampleRate: number,
  maxHz: number,
): Spectrum {
  if (x.length === 0) return { freqs: new Float32Array(0), mags: new Float32Array(0) };
  const n = nextPow2(x.length);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const M = x.length - 1;
  for (let i = 0; i < x.length; i++) {
    // Hann window to suppress spectral leakage.
    const w = M > 0 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / M) : 1;
    re[i] = x[i] * w;
  }
  fftRadix2(re, im);

  const binHz = sampleRate / n;
  const maxBin = Math.min(n >> 1, Math.ceil(maxHz / binHz));
  const freqs = new Float32Array(maxBin);
  const mags = new Float32Array(maxBin);
  let peak = 0;
  for (let k = 0; k < maxBin; k++) {
    const mag = Math.hypot(re[k], im[k]);
    freqs[k] = k * binHz;
    mags[k] = mag;
    if (mag > peak) peak = mag;
  }
  if (peak > 0) for (let k = 0; k < maxBin; k++) mags[k] /= peak;
  return { freqs, mags };
}
