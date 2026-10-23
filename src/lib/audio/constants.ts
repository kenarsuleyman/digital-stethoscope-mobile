// Numerical constants for the audio pipeline. Mirror of the Python training
// configs/config.yaml — change these only if the model is retrained.

export const TARGET_SR = 4000;
export const SEGMENT_LENGTH_S = 5;
export const SEGMENT_SAMPLES = TARGET_SR * SEGMENT_LENGTH_S; // 20_000
export const RECORDING_LENGTH_S = 10;
// Bench test recordings (playback of the MATLAB tone / heart-sound sequences, 134 s and 315 s).
export const TEST_RECORDING_S = 360;

export const BANDPASS_LOW = 25;
export const BANDPASS_HIGH = 900;
export const BUTTER_ORDER = 4;

// RMS energy gating (thesis 3.1.3): drop segments whose RMS falls outside
// [LOW x median, HIGH x median] of the recording's segment RMS values —
// rejecting near-silent and clipped/over-noisy segments.
export const RMS_GATE_LOW = 0.1;
export const RMS_GATE_HIGH = 10;

export const N_FFT = 512;
export const HOP_LENGTH = 256;
export const N_MELS = 64;
export const FMIN = 25;
export const FMAX = 900;

export const IMAGE_SIZE = 224;
export const THRESHOLD = 0.5;

// 0 = Normal, 1 = Abnormal
export const LABELS = ['Normal', 'Abnormal'] as const;
export type Label = (typeof LABELS)[number];

// BPM band (heart S1/S2 energy) — separate from the classifier path.
export const BPM_BAND_LOW = 25;
export const BPM_BAND_HIGH = 150;
export const BPM_MIN = 40;
export const BPM_MAX = 200;
