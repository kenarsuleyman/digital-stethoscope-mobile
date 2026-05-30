// Orchestrator: raw Float32Array (any sample rate) -> flat 1x224x224x3 Float32
// tensor data suitable for the heart-sound classifier.
//
// The web app used @tensorflow/tfjs for the tile-to-3-channels + bilinear
// resize. On React Native we feed react-native-fast-tflite a plain Float32Array,
// so those two ops are reimplemented here in pure JS — numerically matching
// tf.image.resizeBilinear (half-pixel-centers = false, align_corners = false,
// which is tfjs's default) so model results stay identical to web.

import {
  BANDPASS_HIGH,
  BANDPASS_LOW,
  BUTTER_ORDER,
  IMAGE_SIZE,
  RMS_GATE_HIGH,
  RMS_GATE_LOW,
  SEGMENT_SAMPLES,
  TARGET_SR,
} from './constants';
import { bandpass } from './filter';
import { logMelSpectrogram, type MelSpec } from './melspectrogram';
import { resamplePoly } from './resample';

export type Segment = {
  samples: Float32Array; // 20_000 samples @ 4 kHz
  rms: number;
};

// Flat NHWC tensor data: [1, 224, 224, 3] row-major, ready for fast-tflite.
export type ImageTensor = {
  data: Float32Array; // length IMAGE_SIZE * IMAGE_SIZE * 3
  shape: [number, number, number, number];
};

function rmsOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export type SegmentResult = {
  kept: Segment[];
  dropped: number; // count of segments rejected by RMS gating
};

// Resample to 4 kHz, slice into 5 s segments, and apply the thesis RMS energy
// gate (3.1.3): reject segments outside [LOW x median, HIGH x median].
export function segmentRecording(
  raw: Float32Array,
  sampleRate: number,
): SegmentResult {
  const downsampled = resamplePoly(raw, sampleRate, TARGET_SR);
  const all: Segment[] = [];
  for (let off = 0; off + SEGMENT_SAMPLES <= downsampled.length; off += SEGMENT_SAMPLES) {
    const samples = downsampled.slice(off, off + SEGMENT_SAMPLES);
    all.push({ samples, rms: rmsOf(samples) });
  }
  if (all.length === 0) return { kept: [], dropped: 0 };

  const med = median(all.map((s) => s.rms));
  // With a healthy median, gate; if median is ~0 (all silence) keep everything
  // and let downstream silence handling deal with it.
  if (med <= 0) return { kept: all, dropped: 0 };
  const lo = RMS_GATE_LOW * med;
  const hi = RMS_GATE_HIGH * med;
  const kept = all.filter((s) => s.rms >= lo && s.rms <= hi);
  return { kept, dropped: all.length - kept.length };
}

export function preprocessRecording(
  raw: Float32Array,
  sampleRate: number,
): Segment[] {
  return segmentRecording(raw, sampleRate).kept;
}

export function processSegment(seg: Segment): MelSpec {
  // 1. Bandpass 25-900 Hz, zero-phase Butterworth order 4.
  const filtered = bandpass(seg.samples, BANDPASS_LOW, BANDPASS_HIGH, TARGET_SR, BUTTER_ORDER);
  // 2. Amplitude normalize to [-1, +1].
  let maxAbs = 0;
  for (let i = 0; i < filtered.length; i++) {
    const a = Math.abs(filtered[i]);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs > 0) {
    for (let i = 0; i < filtered.length; i++) filtered[i] /= maxAbs;
  }
  // 3. Log-mel + per-segment min-max normalize to [0, 1].
  return logMelSpectrogram(filtered, TARGET_SR);
}

// Bilinear resize of a single-channel (h x w) grid to (size x size), matching
// tf.image.resizeBilinear with align_corners=false / half_pixel_centers=false
// (tfjs default): src = dst * (inSize / outSize).
function resizeBilinearTo3ch(
  src: Float32Array,
  h: number,
  w: number,
  size: number,
): Float32Array {
  const out = new Float32Array(size * size * 3);
  const scaleY = h / size;
  const scaleX = w / size;
  for (let y = 0; y < size; y++) {
    let sy = y * scaleY;
    if (sy < 0) sy = 0;
    const y0 = Math.min(Math.floor(sy), h - 1);
    const y1 = Math.min(y0 + 1, h - 1);
    const wy = sy - y0;
    for (let x = 0; x < size; x++) {
      let sx = x * scaleX;
      if (sx < 0) sx = 0;
      const x0 = Math.min(Math.floor(sx), w - 1);
      const x1 = Math.min(x0 + 1, w - 1);
      const wx = sx - x0;

      const v00 = src[y0 * w + x0];
      const v01 = src[y0 * w + x1];
      const v10 = src[y1 * w + x0];
      const v11 = src[y1 * w + x1];
      const top = v00 + (v01 - v00) * wx;
      const bot = v10 + (v11 - v10) * wx;
      const v = top + (bot - top) * wy;

      // Replicate across 3 channels (RGB), NHWC layout.
      const base = (y * size + x) * 3;
      out[base] = v;
      out[base + 1] = v;
      out[base + 2] = v;
    }
  }
  return out;
}

export function melToImageTensor(mel: MelSpec): ImageTensor {
  // mel.data shape (n_mels, n_frames). Resize bilinear to 224x224 and tile to
  // 3 channels — producing a flat [1, 224, 224, 3] NHWC Float32 buffer.
  const data = resizeBilinearTo3ch(mel.data, mel.nMels, mel.nFrames, IMAGE_SIZE);
  return { data, shape: [1, IMAGE_SIZE, IMAGE_SIZE, 3] };
}

export function recordingToTensors(
  raw: Float32Array,
  sampleRate: number,
): ImageTensor[] {
  const segments = preprocessRecording(raw, sampleRate);
  return segments.map((s) => melToImageTensor(processSegment(s)));
}
