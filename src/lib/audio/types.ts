// Shared audio types. In the web app these lived in capture.ts (Web Audio);
// extracted here so the DSP/model layers don't depend on the capture layer.

export type Recording = {
  samples: Float32Array;
  sampleRate: number;
  durationS: number;
};

export type Analysis = {
  bpm: number | null;
  hasBeat: boolean;
  rms: number;
};
