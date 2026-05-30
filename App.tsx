/**
 * Digital Stethoscope — React Native port.
 * Phase 1: file-upload → DSP pipeline → TFLite inference.
 * Phase 2: live audio capture (USB stethoscope mic) → record → analyze.
 */

import './global.css';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';

import { StethoscopeMonitor } from './src/lib/audio/capture';
import { RECORDING_LENGTH_S, SEGMENT_LENGTH_S } from './src/lib/audio/constants';
import type { Recording } from './src/lib/audio/types';
import { decodeWavBase64 } from './src/lib/audio/wavDecode';
import { analyzeWindow } from './src/lib/bpm';
import { predictFromRecording, type Prediction } from './src/lib/model/predict';

function fileUriToPath(uri: string): string {
  let p = uri;
  if (p.startsWith('file://')) p = p.slice('file://'.length);
  try {
    p = decodeURIComponent(p);
  } catch {
    // leave as-is
  }
  return p;
}

async function requestMic(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Mikrofon izni',
      message: 'Stetoskop sesini dinlemek için mikrofon erişimi gerekli.',
      buttonPositive: 'Tamam',
      buttonNegative: 'İptal',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export default function App() {
  // Live monitor state
  const [monitoring, setMonitoring] = useState(false);
  const [level, setLevel] = useState(0); // 0..1 meter
  const [bpm, setBpm] = useState<number | null>(null);
  const [hasBeat, setHasBeat] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);

  // Shared analyze state
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const monitorRef = useRef<StethoscopeMonitor | null>(null);
  const lastLevelAt = useRef(0);

  const analyzeRecording = useCallback(async (rec: Recording, name: string) => {
    setFileName(name);
    setResult(null);
    setError(null);
    setBusy(true);
    try {
      if (rec.durationS < SEGMENT_LENGTH_S) {
        throw new Error(
          `Kayıt çok kısa (${rec.durationS.toFixed(1)} s). En az ${SEGMENT_LENGTH_S} s gerekli.`,
        );
      }
      setStage('Model çalıştırılıyor...');
      const pred = await predictFromRecording(rec.samples, rec.sampleRate);
      setResult(pred);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage('');
    }
  }, []);

  // --- Live monitor lifecycle ---------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let monitor: StethoscopeMonitor | null = null;

    (async () => {
      const ok = await requestMic();
      if (!ok) {
        setError('Mikrofon izni verilmedi.');
        return;
      }
      monitor = new StethoscopeMonitor({
        sampleRate: 16000,
        onChunk: (chunk) => {
          // Throttled RMS level meter (~15 fps).
          const now = Date.now();
          if (now - lastLevelAt.current < 66) return;
          lastLevelAt.current = now;
          let s = 0;
          for (let i = 0; i < chunk.length; i++) s += chunk[i] * chunk[i];
          const rms = Math.sqrt(s / Math.max(1, chunk.length));
          setLevel(Math.min(1, rms * 12));
        },
        onAnalysis: (a) => {
          setBpm(a.bpm);
          setHasBeat(a.hasBeat);
        },
        onRecordingProgress: (sec) => setRecordElapsed(sec),
        onRecordingComplete: (rec) => {
          setRecording(false);
          void analyzeRecording(rec, 'Canlı kayıt');
        },
        onError: (e) => setError(e.message),
      });
      monitor.setAnalyzer(analyzeWindow);
      monitorRef.current = monitor;
      try {
        await monitor.start();
        if (!cancelled) setMonitoring(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      setMonitoring(false);
      monitorRef.current = null;
      void monitor?.stop();
    };
  }, [analyzeRecording]);

  const onToggleRecord = useCallback(() => {
    const monitor = monitorRef.current;
    if (!monitor || !monitoring) return;
    if (recording) {
      monitor.cancelRecording();
      setRecording(false);
      setRecordElapsed(0);
      return;
    }
    setResult(null);
    setError(null);
    setRecordElapsed(0);
    setRecording(true);
    monitor.startRecording(RECORDING_LENGTH_S);
  }, [recording, monitoring]);

  // --- File upload (Phase 1) ----------------------------------------------
  const onPick = useCallback(async () => {
    setError(null);
    try {
      const [picked] = await pick({ type: [types.audio] });
      if (!picked) return;
      setBusy(true);
      setStage('Dosya okunuyor...');
      const [copy] = await keepLocalCopy({
        files: [{ uri: picked.uri, fileName: picked.name ?? 'audio.wav' }],
        destination: 'cachesDirectory',
      });
      if (copy.status !== 'success') {
        throw new Error('Dosya yerel olarak kopyalanamadı.');
      }
      const b64 = await RNFS.readFile(fileUriToPath(copy.localUri), 'base64');
      setStage('Ses çözümleniyor...');
      const rec = decodeWavBase64(b64);
      await analyzeRecording(rec, picked.name ?? 'Dosya');
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setStage('');
    }
  }, [analyzeRecording]);

  const isAbnormal = result?.label === 'Abnormal';
  const recordProgress = Math.min(recordElapsed / RECORDING_LENGTH_S, 1);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView className="flex-1 bg-zinc-50">
        <ScrollView contentContainerClassName="p-4 gap-4">
          {/* Header */}
          <View className="pt-2 pb-1 flex-row items-center justify-between">
            <View>
              <Text className="text-xl font-bold text-zinc-800">
                Dijital Stetoskop
              </Text>
              <Text className="text-xs text-zinc-500">Canlı dinleme + analiz</Text>
            </View>
            <View
              className={`rounded-full px-3 py-1 ${
                monitoring ? 'bg-emerald-100' : 'bg-zinc-200'
              }`}>
              <Text
                className={`text-xs font-medium ${
                  monitoring ? 'text-emerald-700' : 'text-zinc-500'
                }`}>
                {monitoring ? 'Bağlı' : 'Bağlı değil'}
              </Text>
            </View>
          </View>

          {/* Live monitor card */}
          <View className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-medium text-zinc-600">
                {bpm !== null ? `${bpm} BPM` : '— BPM'}
              </Text>
              <Text className="text-xs text-zinc-400">
                {recording
                  ? `Kaydediliyor ${recordElapsed.toFixed(1)} / ${RECORDING_LENGTH_S}s`
                  : hasBeat
                    ? 'Kalp atışı algılandı'
                    : monitoring
                      ? 'Sinyal bekleniyor...'
                      : ''}
              </Text>
            </View>

            {/* Level meter */}
            <View className="mt-3 h-3 w-full overflow-hidden rounded-full bg-zinc-100">
              <View
                className={`h-full rounded-full ${
                  hasBeat ? 'bg-teal-600' : 'bg-teal-400'
                }`}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </View>

            {/* Record progress */}
            {recording && (
              <View className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <View
                  className="h-full rounded-full bg-rose-500"
                  style={{ width: `${Math.round(recordProgress * 100)}%` }}
                />
              </View>
            )}

            <Pressable
              onPress={onToggleRecord}
              disabled={!monitoring || busy}
              className={`mt-4 items-center justify-center rounded-xl px-4 py-3 ${
                !monitoring || busy
                  ? 'bg-zinc-200'
                  : recording
                    ? 'bg-rose-600 active:bg-rose-700'
                    : 'bg-teal-600 active:bg-teal-700'
              }`}>
              <Text
                className={`text-base font-semibold ${
                  !monitoring || busy ? 'text-zinc-400' : 'text-white'
                }`}>
                {recording
                  ? 'Kaydı durdur'
                  : `Kaydet (${RECORDING_LENGTH_S}s) ve analiz et`}
              </Text>
            </Pressable>
          </View>

          {/* File upload card (Phase 1) */}
          <View className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <Text className="mb-3 text-xs text-zinc-500">
              Veya bir WAV dosyası seçin (en az {SEGMENT_LENGTH_S} sn).
            </Text>
            <Pressable
              onPress={onPick}
              disabled={busy}
              className={`flex-row items-center justify-center rounded-xl px-4 py-2.5 ${
                busy ? 'bg-zinc-200' : 'bg-zinc-700 active:bg-zinc-800'
              }`}>
              {busy && stage.includes('Dosya') && (
                <ActivityIndicator color="#ffffff" className="mr-2" />
              )}
              <Text
                className={`text-sm font-medium ${
                  busy ? 'text-zinc-400' : 'text-white'
                }`}>
                Dosya seç
              </Text>
            </Pressable>
          </View>

          {/* Busy / stage */}
          {busy && (
            <View className="flex-row items-center justify-center gap-2 py-1">
              <ActivityIndicator color="#0f766e" />
              <Text className="text-sm text-zinc-600">
                {stage || 'İşleniyor...'}
              </Text>
            </View>
          )}

          {/* Error */}
          {error && (
            <View className="rounded-xl bg-amber-50 px-4 py-3">
              <Text className="text-xs text-amber-800">{error}</Text>
            </View>
          )}

          {/* Result */}
          {result && (
            <View
              className={`rounded-2xl border p-5 shadow-sm ${
                isAbnormal
                  ? 'border-rose-200 bg-rose-50'
                  : 'border-emerald-200 bg-emerald-50'
              }`}>
              <Text className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Sonuç {fileName ? `· ${fileName}` : ''}
              </Text>
              <Text
                className={`mt-1 text-2xl font-bold ${
                  isAbnormal ? 'text-rose-700' : 'text-emerald-700'
                }`}>
                {isAbnormal ? 'Anormal' : 'Normal'}
              </Text>
              <Text className="mt-1 text-sm text-zinc-600">
                Olasılık: {(result.probability * 100).toFixed(1)}%
              </Text>
              <Text className="mt-1 text-xs text-zinc-500">
                {result.perSegment.length} pencere analiz edildi
              </Text>
            </View>
          )}

          <Text className="mt-2 px-2 text-center text-[11px] text-zinc-400">
            Gösterilen sonuçlar araştırma örneğidir. Tıbbi teşhis değildir.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
