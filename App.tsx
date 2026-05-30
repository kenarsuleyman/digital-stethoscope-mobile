/**
 * Digital Stethoscope — React Native port.
 * Phase 1: file-upload → DSP pipeline → TFLite inference.
 */

import './global.css';

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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

import { SEGMENT_LENGTH_S } from './src/lib/audio/constants';
import { decodeWavBase64 } from './src/lib/audio/wavDecode';
import { estimateBPM } from './src/lib/bpm';
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

export default function App() {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<Prediction | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = useCallback(async () => {
    setError(null);
    setResult(null);
    setBpm(null);
    try {
      const [picked] = await pick({ type: [types.audio] });
      if (!picked) return;
      setFileName(picked.name ?? null);
      setBusy(true);

      setStage('Dosya okunuyor...');
      const [copy] = await keepLocalCopy({
        files: [{ uri: picked.uri, fileName: picked.name ?? 'audio.wav' }],
        destination: 'cachesDirectory',
      });
      if (copy.status !== 'success') {
        throw new Error('Dosya yerel olarak kopyalanamadı.');
      }
      const path = fileUriToPath(copy.localUri);
      const b64 = await RNFS.readFile(path, 'base64');

      setStage('Ses çözümleniyor...');
      const rec = decodeWavBase64(b64);
      if (rec.durationS < SEGMENT_LENGTH_S) {
        throw new Error(
          `Kayıt çok kısa (${rec.durationS.toFixed(1)} s). En az ${SEGMENT_LENGTH_S} s gerekli.`,
        );
      }

      setStage('Model çalıştırılıyor...');
      const pred = await predictFromRecording(rec.samples, rec.sampleRate);
      setResult(pred);
      try {
        setBpm(estimateBPM(rec.samples, rec.sampleRate));
      } catch {
        // BPM is best-effort.
      }
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) {
        return; // user cancelled the picker
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage('');
    }
  }, []);

  const isAbnormal = result?.label === 'Abnormal';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView className="flex-1 bg-zinc-50">
        <ScrollView contentContainerClassName="p-4 gap-4">
          {/* Header */}
          <View className="pt-2 pb-1">
            <Text className="text-xl font-bold text-zinc-800">
              Dijital Stetoskop
            </Text>
            <Text className="text-xs text-zinc-500">
              Dosyadan analiz (Aşama 1)
            </Text>
          </View>

          {/* Upload card */}
          <View className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <Text className="mb-1 text-sm font-medium text-zinc-700">
              Ses dosyası seç
            </Text>
            <Text className="mb-4 text-xs text-zinc-500">
              WAV dosyası seçin (en az {SEGMENT_LENGTH_S} saniye).
            </Text>

            <Pressable
              onPress={onPick}
              disabled={busy}
              className={`flex-row items-center justify-center rounded-xl px-4 py-3 ${
                busy ? 'bg-teal-300' : 'bg-teal-600 active:bg-teal-700'
              }`}>
              {busy && (
                <ActivityIndicator color="#ffffff" className="mr-2" />
              )}
              <Text className="text-base font-semibold text-white">
                {busy ? (stage || 'İşleniyor...') : 'Dosya seç ve analiz et'}
              </Text>
            </Pressable>

            {fileName && (
              <Text className="mt-3 text-xs text-zinc-500" numberOfLines={1}>
                {fileName}
              </Text>
            )}
          </View>

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
                Sonuç
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
                {bpm !== null ? ` · ~${bpm} BPM` : ''}
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
