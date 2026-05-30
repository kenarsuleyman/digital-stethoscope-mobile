// librosa-compatible log-mel spectrogram, ported to TypeScript.
// Default conventions match librosa.feature.melspectrogram(power=2) +
// librosa.power_to_db(ref=max, amin=1e-10, top_db=80) followed by min-max
// normalization to [0, 1].

import { FMAX, FMIN, HOP_LENGTH, N_FFT, N_MELS } from './constants';

// --- Slaney mel scale (librosa default, htk=False) -------------------------

const F_SP = 200.0 / 3;
const MIN_LOG_HZ = 1000.0;
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP; // 15
const LOG_STEP = Math.log(6.4) / 27.0;

function hzToMel(f: number): number {
  if (f < MIN_LOG_HZ) return f / F_SP;
  return MIN_LOG_MEL + Math.log(f / MIN_LOG_HZ) / LOG_STEP;
}

function melToHz(m: number): number {
  if (m < MIN_LOG_MEL) return m * F_SP;
  return MIN_LOG_HZ * Math.exp((m - MIN_LOG_MEL) * LOG_STEP);
}

// --- Mel filterbank (Slaney normalized) ------------------------------------

export function melFilterbank(
  sr: number,
  nFft: number,
  nMels: number,
  fmin: number,
  fmax: number,
): Float32Array {
  // Shape: (nMels, nFft/2 + 1), flattened row-major.
  const nBins = nFft / 2 + 1;
  const fftFreqs = new Float32Array(nBins);
  for (let i = 0; i < nBins; i++) fftFreqs[i] = (i * sr) / nFft;

  const melLo = hzToMel(fmin);
  const melHi = hzToMel(fmax);
  const melPoints = new Float32Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    melPoints[i] = melLo + ((melHi - melLo) * i) / (nMels + 1);
  }
  const hzPoints = new Float32Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) hzPoints[i] = melToHz(melPoints[i]);

  const fdiff = new Float32Array(nMels + 1);
  for (let i = 0; i < nMels + 1; i++) fdiff[i] = hzPoints[i + 1] - hzPoints[i];

  const weights = new Float32Array(nMels * nBins);
  for (let m = 0; m < nMels; m++) {
    const enorm = 2.0 / (hzPoints[m + 2] - hzPoints[m]);
    for (let k = 0; k < nBins; k++) {
      const lower = (fftFreqs[k] - hzPoints[m]) / fdiff[m];
      const upper = (hzPoints[m + 2] - fftFreqs[k]) / fdiff[m + 1];
      const w = Math.max(0, Math.min(lower, upper));
      weights[m * nBins + k] = w * enorm;
    }
  }
  return weights;
}

// --- Hann window -----------------------------------------------------------

function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

// --- FFT (iterative radix-2 Cooley-Tukey, in-place) ------------------------

export function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reverse permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterflies
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const newRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newRe;
      }
    }
  }
}

// --- STFT (librosa-compatible: center=True, reflect pad, hann window) ------

function reflectPad(x: Float32Array, padLen: number): Float32Array {
  const out = new Float32Array(x.length + 2 * padLen);
  for (let i = 0; i < padLen; i++) out[i] = x[padLen - i] ?? 0;
  out.set(x, padLen);
  for (let i = 0; i < padLen; i++) {
    out[padLen + x.length + i] = x[x.length - 2 - i] ?? 0;
  }
  return out;
}

function stftPower(
  x: Float32Array,
  nFft: number,
  hop: number,
): { power: Float32Array; nFrames: number } {
  const padLen = Math.floor(nFft / 2);
  const padded = reflectPad(x, padLen);
  const nFrames = 1 + Math.floor((padded.length - nFft) / hop);
  const window = hannWindow(nFft);
  const nBins = nFft / 2 + 1;
  const power = new Float32Array(nFrames * nBins);

  const re = new Float32Array(nFft);
  const im = new Float32Array(nFft);

  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    for (let i = 0; i < nFft; i++) {
      re[i] = padded[off + i] * window[i];
      im[i] = 0;
    }
    fftRadix2(re, im);
    for (let k = 0; k < nBins; k++) {
      const r = re[k];
      const ii = im[k];
      power[f * nBins + k] = r * r + ii * ii;
    }
  }
  return { power, nFrames };
}

// --- Mel matmul + power_to_db + min-max norm -------------------------------

export type MelSpec = {
  data: Float32Array; // shape (N_MELS, nFrames), row-major
  nMels: number;
  nFrames: number;
};

let cachedFB: { key: string; fb: Float32Array } | null = null;

function getFilterbank(
  sr: number,
  nFft: number,
  nMels: number,
  fmin: number,
  fmax: number,
): Float32Array {
  const key = `${sr}|${nFft}|${nMels}|${fmin}|${fmax}`;
  if (!cachedFB || cachedFB.key !== key) {
    cachedFB = { key, fb: melFilterbank(sr, nFft, nMels, fmin, fmax) };
  }
  return cachedFB.fb;
}

export function logMelSpectrogram(
  x: Float32Array,
  sr: number,
  opts: {
    nFft?: number;
    hop?: number;
    nMels?: number;
    fmin?: number;
    fmax?: number;
    topDb?: number;
    amin?: number;
  } = {},
): MelSpec {
  const nFft = opts.nFft ?? N_FFT;
  const hop = opts.hop ?? HOP_LENGTH;
  const nMels = opts.nMels ?? N_MELS;
  const fmin = opts.fmin ?? FMIN;
  const fmax = opts.fmax ?? FMAX;
  const topDb = opts.topDb ?? 80;
  const amin = opts.amin ?? 1e-10;

  const { power, nFrames } = stftPower(x, nFft, hop);
  const nBins = nFft / 2 + 1;
  const fb = getFilterbank(sr, nFft, nMels, fmin, fmax);

  // Mel = fb @ power.T  ->  shape (nMels, nFrames), row-major.
  const mel = new Float32Array(nMels * nFrames);
  for (let m = 0; m < nMels; m++) {
    for (let f = 0; f < nFrames; f++) {
      let acc = 0;
      const fbRow = m * nBins;
      const pRow = f * nBins;
      for (let k = 0; k < nBins; k++) acc += fb[fbRow + k] * power[pRow + k];
      mel[m * nFrames + f] = acc;
    }
  }

  // power_to_db with ref=max: S_db = 10*log10(max(amin,S)/max(amin,refmax))
  let refMax = 0;
  for (let i = 0; i < mel.length; i++) if (mel[i] > refMax) refMax = mel[i];
  const refLog = 10 * Math.log10(Math.max(amin, refMax));
  for (let i = 0; i < mel.length; i++) {
    mel[i] = 10 * Math.log10(Math.max(amin, mel[i])) - refLog;
  }
  // top_db floor.
  let curMax = -Infinity;
  for (let i = 0; i < mel.length; i++) if (mel[i] > curMax) curMax = mel[i];
  const floor = curMax - topDb;
  for (let i = 0; i < mel.length; i++) {
    if (mel[i] < floor) mel[i] = floor;
  }

  // Min-max normalize to [0, 1].
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < mel.length; i++) {
    if (mel[i] < mn) mn = mel[i];
    if (mel[i] > mx) mx = mel[i];
  }
  const range = mx - mn;
  if (range > 0) {
    for (let i = 0; i < mel.length; i++) mel[i] = (mel[i] - mn) / range;
  } else {
    for (let i = 0; i < mel.length; i++) mel[i] = 0;
  }

  return { data: mel, nMels, nFrames };
}
