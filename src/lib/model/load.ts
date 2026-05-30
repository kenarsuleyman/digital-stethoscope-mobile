// Native TFLite runtime via react-native-fast-tflite (JSI). Replaces the web
// app's CDN <script> + WASM tfjs-tflite approach — the same .tflite file runs
// directly on the device's TFLite interpreter.
//
// The model is bundled as a Metro asset (see metro.config.js assetExts) and
// resolved through require().

import {
  loadTensorflowModel,
  type TensorflowModel,
} from 'react-native-fast-tflite';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MODEL_ASSET = require('../../assets/model/heart_sound_classifier_fp16.tflite');

let modelPromise: Promise<TensorflowModel> | null = null;

export async function loadModel(): Promise<TensorflowModel> {
  if (!modelPromise) {
    // Empty delegates array = default CPU interpreter.
    modelPromise = loadTensorflowModel(MODEL_ASSET, []).catch((e) => {
      // Reset so a later retry can attempt loading again.
      modelPromise = null;
      throw e instanceof Error
        ? e
        : new Error('Model yüklenemedi: ' + String(e));
    });
  }
  return modelPromise;
}
