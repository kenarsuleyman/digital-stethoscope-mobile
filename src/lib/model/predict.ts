import { LABELS, THRESHOLD, type Label } from '../audio/constants';
import { recordingToTensors } from '../audio/pipeline';
import { loadModel } from './load';

export type Prediction = {
  probability: number; // sigmoid in [0, 1]
  label: Label; // 'Normal' or 'Abnormal'
  perSegment: number[]; // per-window probabilities
};

export async function predictFromRecording(
  raw: Float32Array,
  sampleRate: number,
): Promise<Prediction> {
  const model = await loadModel();
  const tensors = recordingToTensors(raw, sampleRate);
  if (tensors.length === 0) {
    throw new Error('Kayıt çok kısa: en az 5 saniyelik bir pencere gerekli.');
  }

  const perSegment: number[] = [];
  for (const t of tensors) {
    // fast-tflite (nitro) takes/returns ArrayBuffer[]. Our model:
    // in [1,224,224,3] f32, out [1,1] sigmoid.
    const outputs = model.runSync([t.data.buffer as ArrayBuffer]);
    const out = new Float32Array(outputs[0]);
    perSegment.push(out[0]);
  }

  const probability =
    perSegment.reduce((a, b) => a + b, 0) / perSegment.length;
  const label: Label = probability >= THRESHOLD ? LABELS[1] : LABELS[0];
  return { probability, label, perSegment };
}
