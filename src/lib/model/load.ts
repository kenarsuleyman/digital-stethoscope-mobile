// Native TFLite runtime via react-native-fast-tflite (JSI). Replaces the web
// app's CDN <script> + WASM tfjs-tflite approach — the same .tflite file runs
// directly on the device's TFLite interpreter.
//
// The model ships as a native Android asset
// (android/app/src/main/assets/heart_sound_classifier_fp16.tflite). fast-tflite
// loads from a real filesystem path or http URL, but NOT from inside the APK's
// asset container, so on first use we copy the asset out to the app's files dir
// and load it from there. This works identically in debug and release (no
// dependency on the Metro dev server, unlike a require()-based asset which fails
// in release with a MalformedURLException).

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import {
  loadTensorflowModel,
  type TensorflowModel,
} from 'react-native-fast-tflite';

const MODEL_FILE = 'heart_sound_classifier_fp16.tflite';

async function ensureModelPath(): Promise<string> {
  if (Platform.OS === 'android') {
    const dest = `${RNFS.DocumentDirectoryPath}/${MODEL_FILE}`;
    if (!(await RNFS.exists(dest))) {
      await RNFS.copyFileAssets(MODEL_FILE, dest);
    }
    return dest;
  }
  // iOS: model copied into the main bundle (added when iOS support lands).
  return `${RNFS.MainBundlePath}/${MODEL_FILE}`;
}

let modelPromise: Promise<TensorflowModel> | null = null;

export async function loadModel(): Promise<TensorflowModel> {
  if (!modelPromise) {
    modelPromise = ensureModelPath()
      .then((path) => loadTensorflowModel({ url: 'file://' + path }, []))
      .catch((e) => {
        modelPromise = null;
        throw e instanceof Error
          ? e
          : new Error('Model yüklenemedi: ' + String(e));
      });
  }
  return modelPromise;
}
