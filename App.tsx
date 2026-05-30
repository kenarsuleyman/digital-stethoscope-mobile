/**
 * Digital Stethoscope — React Native port of the Next.js web app.
 * Live capture (USB stethoscope mic) + record + on-device TFLite analysis,
 * with the same waveform / filter / spectrum charts as the web app.
 */

import './global.css';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AnalyzeButton } from './src/components/AnalyzeButton';
import { DeviceCard } from './src/components/DeviceCard';
import { FileUploadPanel } from './src/components/FileUploadPanel';
import { FilterComparison } from './src/components/FilterComparison';
import { Header } from './src/components/Header';
import { RecordButton } from './src/components/RecordButton';
import { ResultPanel } from './src/components/ResultPanel';
import { WaveformChart } from './src/components/WaveformChart';
import { StethoscopeMonitor } from './src/lib/audio/capture';
import { RECORDING_LENGTH_S, SEGMENT_LENGTH_S } from './src/lib/audio/constants';
import type { Analysis, Recording } from './src/lib/audio/types';
import { analyzeWindow, estimateBPM } from './src/lib/bpm';
import { predictFromRecording, type Prediction } from './src/lib/model/predict';

const SAMPLE_RATE = 16000;
const LIVE_DISPLAY_S = 3;

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
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [recordElapsedS, setRecordElapsedS] = useState(0);
  const [liveSamples, setLiveSamples] = useState<Float32Array | null>(null);
  const [recordSamples, setRecordSamples] = useState<Float32Array | null>(null);
  const [analysis, setAnalysis] = useState<Analysis>({
    bpm: null,
    hasBeat: false,
    rms: 0,
  });

  const [completed, setCompleted] = useState<Recording | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const monitorRef = useRef<StethoscopeMonitor | null>(null);
  const lastLiveAt = useRef(0);
  const lastRecAt = useRef(0);

  const startMonitor = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    const ok = await requestMic();
    if (!ok) {
      setScanError('Mikrofon izni verilmedi. Ayarlardan izin verin.');
      setScanning(false);
      return;
    }
    await monitorRef.current?.stop();

    const monitor = new StethoscopeMonitor({
      sampleRate: SAMPLE_RATE,
      onChunk: () => {
        // The monitor already keeps a ring buffer; just snapshot the last few
        // seconds for display at ~15 fps instead of rebuilding a buffer on
        // every audio frame.
        const now = Date.now();
        if (now - lastLiveAt.current < 66) return;
        lastLiveAt.current = now;
        const m = monitorRef.current;
        if (m) setLiveSamples(m.snapshot(LIVE_DISPLAY_S));
      },
      onAnalysis: (a) => setAnalysis(a),
      onRecordingProgress: (s) => setRecordElapsedS(s),
      onRecordingChunk: (acc) => {
        const now = Date.now();
        if (now - lastRecAt.current < 66) return;
        lastRecAt.current = now;
        setRecordSamples(acc);
      },
      onRecordingComplete: (rec) => {
        setRecording(false);
        setCompleted(rec);
      },
      onError: (e) => setScanError(e.message),
    });
    monitor.setAnalyzer(analyzeWindow);
    monitorRef.current = monitor;
    try {
      await monitor.start();
      setMonitoring(true);
      setDeviceLabel('Teensy / Mikrofon • 16 kHz • 16-bit');
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
      setMonitoring(false);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void startMonitor();
    return () => {
      setMonitoring(false);
      const m = monitorRef.current;
      monitorRef.current = null;
      void m?.stop();
    };
  }, [startMonitor]);

  const onToggleRecord = useCallback(() => {
    const monitor = monitorRef.current;
    if (!monitor || !monitoring) return;
    if (recording) {
      monitor.cancelRecording();
      setRecording(false);
      setRecordElapsedS(0);
      return;
    }
    setResult(null);
    setError(null);
    setCompleted(null);
    setRecordSamples(null);
    setRecordElapsedS(0);
    setRecording(true);
    monitor.startRecording(RECORDING_LENGTH_S);
  }, [recording, monitoring]);

  const onAnalyze = useCallback(async () => {
    if (!completed) return;
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const pred = await predictFromRecording(
        completed.samples,
        completed.sampleRate,
      );
      setResult(pred);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }, [completed]);

  const onUploaded = useCallback((rec: Recording) => {
    setResult(null);
    setError(null);
    setCompleted(rec);
    try {
      const b = estimateBPM(rec.samples, rec.sampleRate);
      if (b !== null) setAnalysis({ bpm: b, hasBeat: true, rms: 0 });
    } catch {
      // leave live analysis
    }
  }, []);

  const canAnalyze =
    completed !== null && completed.durationS >= SEGMENT_LENGTH_S;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0f766e" />
      <SafeAreaView className="flex-1 bg-zinc-50" edges={['top']}>
        <Header connected={monitoring} />
        <ScrollView contentContainerClassName="mx-auto w-full max-w-md p-4 pb-8 gap-4">
          <DeviceCard deviceLabel={deviceLabel} onRetry={startMonitor} busy={scanning} />

          {scanError && (
            <View className="rounded-md bg-amber-50 px-3 py-2">
              <Text className="text-xs text-amber-800">{scanError}</Text>
            </View>
          )}

          <WaveformChart
            samples={recording ? recordSamples : liveSamples}
            elapsedMs={recording ? recordElapsedS * 1000 : 0}
            bpm={analysis.bpm}
            active={monitoring}
            hasBeat={analysis.hasBeat}
            recordingProgress={
              recording ? Math.min(recordElapsedS / RECORDING_LENGTH_S, 1) : null
            }
          />

          <View className="items-center py-2">
            <RecordButton
              recording={recording}
              elapsedS={recordElapsedS}
              disabled={!monitoring}
              onToggle={onToggleRecord}
            />
          </View>

          <AnalyzeButton disabled={!canAnalyze} busy={analyzing} onPress={onAnalyze} />

          {!recording && <FilterComparison recording={completed} />}

          <FileUploadPanel onLoaded={onUploaded} onError={(msg) => setError(msg)} />

          <ResultPanel result={result} error={error} />

          <View className="mt-auto pt-6">
            <Text className="text-center text-xs text-zinc-400">
              Gösterilen sonuçlar araştırma örneğidir. Tıbbi teşhis değildir.
            </Text>
            <Text className="mt-1 text-center text-xs text-zinc-400">
              Bursa Uludağ Üniversitesi, 2026.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
