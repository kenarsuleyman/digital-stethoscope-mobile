// On-device parity + latency + device-info test. Drives the app's REAL model
// pipeline (predict.ts / pipeline.ts / load.ts) on a set of WAV files and
// compares the results against golden.json (computed in Python with the same
// .tflite). Writes <ExternalDir>/rn_results.json and logs a short summary.
//
// WAVs + golden.json are pushed to <ExternalDir>/test_wavs/ via adb before the
// run (see the script that invokes this).

import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';

import { SEGMENT_SAMPLES, TARGET_SR, THRESHOLD } from '../lib/audio/constants';
import { melToImageTensor, processSegment, type Segment } from '../lib/audio/pipeline';
import { resamplePoly } from '../lib/audio/resample';
import { decodeWavBase64 } from '../lib/audio/wavDecode';
import { loadModel } from '../lib/model/load';
import { predictFromRecording } from '../lib/model/predict';

// High-res timer when available (RN provides global.performance.now), else ms.
const perf = (globalThis as { performance?: { now?: () => number } }).performance;
const now: () => number =
  perf && typeof perf.now === 'function' ? () => perf.now!() : () => Date.now();

type GoldenItem = {
  rn_filename: string;
  truth_class: string;
  n_segments: number;
  python_per_segment: number[];
  python_mean_prob: number;
  python_class: string;
};
type Golden = { threshold: number; n_files: number; items: GoldenItem[] };

function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}
function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) * (v - m))));
}
function pct(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export async function runParityTest(): Promise<{ parity: { class_agreement_pct: number; mean_prob_MAE: number } }> {
  const dir = `${RNFS.ExternalDirectoryPath}/test_wavs`;
  const outPath = `${RNFS.ExternalDirectoryPath}/rn_results.json`;
  console.log('[PARITY] reading golden from', dir);
  const golden: Golden = JSON.parse(await RNFS.readFile(`${dir}/golden.json`, 'utf8'));

  // Warm up / load the model once up front.
  const model = await loadModel();

  // ---- 1. PARITY -------------------------------------------------------
  const perFile: Array<Record<string, unknown>> = [];
  const meanProbAbsErr: number[] = [];
  const perSegAbsErr: number[] = [];
  let classAgree = 0;
  let truthAgree = 0;

  for (let i = 0; i < golden.items.length; i++) {
    const item = golden.items[i];
    try {
      const b64 = await RNFS.readFile(`${dir}/${item.rn_filename}`, 'base64');
      const rec = decodeWavBase64(b64);
      const pred = await predictFromRecording(rec.samples, rec.sampleRate);
      const rnMean = pred.probability;
      const rnPer = pred.perSegment;
      const rnClass = rnMean >= THRESHOLD ? 'abnormal' : 'normal';

      meanProbAbsErr.push(Math.abs(rnMean - item.python_mean_prob));
      const n = Math.min(rnPer.length, item.python_per_segment.length);
      for (let k = 0; k < n; k++) {
        perSegAbsErr.push(Math.abs(rnPer[k] - item.python_per_segment[k]));
      }
      if (rnClass === item.python_class) classAgree++;
      if (rnClass === item.truth_class) truthAgree++;

      perFile.push({
        file: item.rn_filename,
        rn_mean_prob: r3(rnMean),
        python_mean_prob: r3(item.python_mean_prob),
        mean_abs_err: r3(Math.abs(rnMean - item.python_mean_prob)),
        rn_per_segment: rnPer.map(r3),
        python_per_segment: item.python_per_segment.map(r3),
        rn_n_segments: rnPer.length,
        python_n_segments: item.n_segments,
        rn_class: rnClass,
        python_class: item.python_class,
        truth_class: item.truth_class,
      });
      console.log(
        `[PARITY] ${i + 1}/${golden.items.length} ${item.rn_filename} rn=${r3(rnMean)} py=${r3(item.python_mean_prob)} d=${r3(Math.abs(rnMean - item.python_mean_prob))}`,
      );
    } catch (e) {
      perFile.push({ file: item.rn_filename, error: String(e) });
      console.log(`[PARITY] ${item.rn_filename} ERROR ${String(e)}`);
    }
  }

  const parity = {
    n_files: golden.items.length,
    mean_prob_MAE: r3(mean(meanProbAbsErr)),
    mean_prob_maxAbsErr: r3(Math.max(0, ...meanProbAbsErr)),
    per_segment_MAE: r3(mean(perSegAbsErr)),
    class_agreement_pct: r3((100 * classAgree) / golden.items.length),
    truth_accuracy_pct: r3((100 * truthAgree) / golden.items.length),
    per_file: perFile,
  };

  // ---- 2. LATENCY (single 5 s segment, 100 runs) -----------------------
  const latFile = '21_heart-sounds-public_normal_Normal.wav';
  const latRec = decodeWavBase64(await RNFS.readFile(`${dir}/${latFile}`, 'base64'));
  const fiveS = latRec.samples.subarray(0, Math.min(latRec.samples.length, 5 * latRec.sampleRate));

  const runOnce = (): { pre: number; inf: number; total: number } => {
    const t0 = now();
    const ds = resamplePoly(fiveS, latRec.sampleRate, TARGET_SR);
    const seg: Segment = { samples: ds.slice(0, SEGMENT_SAMPLES), rms: 0 };
    const tensor = melToImageTensor(processSegment(seg)); // bandpass + mel + resize
    const pre = now() - t0;
    const t1 = now();
    model.runSync([tensor.data.buffer as ArrayBuffer]);
    const inf = now() - t1;
    return { pre, inf, total: pre + inf };
  };

  const cold = runOnce();
  const totals: number[] = [];
  const pres: number[] = [];
  const infs: number[] = [];
  for (let i = 0; i < 99; i++) {
    const m = runOnce();
    totals.push(m.total);
    pres.push(m.pre);
    infs.push(m.inf);
  }

  const latency = {
    segment_file: latFile,
    n_warm_runs: 99,
    cold_total_ms: r3(cold.total),
    cold_pre_ms: r3(cold.pre),
    cold_inf_ms: r3(cold.inf),
    warm_total_mean_ms: r3(mean(totals)),
    warm_total_std_ms: r3(std(totals)),
    warm_total_p50_ms: r3(pct(totals, 50)),
    warm_total_p95_ms: r3(pct(totals, 95)),
    warm_preprocess_mean_ms: r3(mean(pres)),
    warm_inference_mean_ms: r3(mean(infs)),
    warm_inference_p95_ms: r3(pct(infs, 95)),
  };

  // ---- 3. DEVICE INFO --------------------------------------------------
  const c: Record<string, unknown> = (Platform.constants as Record<string, unknown>) ?? {};
  let memory: Record<string, unknown> = {};
  try {
    const mi = await (NativeModules.AudioDevices as {
      getMemoryInfo(): Promise<{ totalMem: number; availMem: number; cpuCores: number }>;
    }).getMemoryInfo();
    memory = {
      total_ram_bytes: mi.totalMem,
      total_ram_gb: r3(mi.totalMem / 1024 / 1024 / 1024),
      avail_ram_bytes: mi.availMem,
      cpu_cores: mi.cpuCores,
    };
  } catch (e) {
    memory = { error: String(e) };
  }
  let modelSizeBytes = -1;
  try {
    const mp = `${RNFS.DocumentDirectoryPath}/heart_sound_classifier_fp16.tflite`;
    modelSizeBytes = (await RNFS.stat(mp)).size as unknown as number;
  } catch {}

  const device = {
    os: Platform.OS,
    model: c.Model ?? null,
    brand: c.Brand ?? null,
    manufacturer: c.Manufacturer ?? null,
    android_release: c.Release ?? null,
    android_api_level: Platform.Version,
    ...memory,
    tflite_backend: 'CPU — TFLite default delegate (XNNPACK for float ops)',
    tflite_delegates_requested: '[] (default CPU)',
    tflite_threads: 'TFLite default',
    model_file_size_bytes: modelSizeBytes,
  };

  const results = { generated_at: new Date().toISOString(), device, parity, latency };
  await RNFS.writeFile(outPath, JSON.stringify(results, null, 2), 'utf8');

  // ---- Console summary -------------------------------------------------
  console.log('===================== RN RESULTS =====================');
  console.log(
    `[DEVICE] ${device.manufacturer} ${device.model} | Android ${device.android_release} (API ${device.android_api_level}) | RAM ${memory.total_ram_gb ?? '?'}GB | cores ${memory.cpu_cores ?? '?'} | model ${modelSizeBytes}B | ${device.tflite_backend}`,
  );
  console.log(
    `[PARITY] meanProb MAE=${parity.mean_prob_MAE} (max ${parity.mean_prob_maxAbsErr}) | perSeg MAE=${parity.per_segment_MAE} | class-agree=${parity.class_agreement_pct}% | truth-acc=${parity.truth_accuracy_pct}%  (targets: MAE<0.05, agree>95%)`,
  );
  console.log(
    `[LATENCY] cold=${latency.cold_total_ms}ms | warm mean=${latency.warm_total_mean_ms}ms std=${latency.warm_total_std_ms} p50=${latency.warm_total_p50_ms} p95=${latency.warm_total_p95_ms} | pre=${latency.warm_preprocess_mean_ms}ms inf=${latency.warm_inference_mean_ms}ms`,
  );
  console.log('[PARITY] wrote', outPath);
  console.log('======================================================');
  return results;
}
