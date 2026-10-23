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
import { FileUploadPanel } from './src/components/FileUploadPanel';
import { FilterComparison } from './src/components/FilterComparison';
import { Header } from './src/components/Header';
import { RecordButton } from './src/components/RecordButton';
import { ParityTestButton } from './src/components/ParityTestButton';
import { ResultPanel } from './src/components/ResultPanel';
import { TestRecordPanel } from './src/components/TestRecordPanel';
import { WaveformChart } from './src/components/WaveformChart';
import { StethoscopeMonitor } from './src/lib/audio/capture';
import {
  RECORDING_LENGTH_S,
  SEGMENT_LENGTH_S,
  TEST_RECORDING_S,
} from './src/lib/audio/constants';
import { saveTestRecording } from './src/lib/audio/testRecording';
import {
  findStethoscope,
  subscribeDeviceChanges,
  type DeviceMatch,
} from './src/lib/audio/devices';
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
  const [device, setDevice] = useState<DeviceMatch | null>(null);
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

  // Bench test recording (long raw capture saved as WAV + JSON, see TestRecordPanel).
  const [testActive, setTestActive] = useState(false);
  const [testSaving, setTestSaving] = useState(false);
  const [testElapsedS, setTestElapsedS] = useState(0);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const testModeRef = useRef(false);
  const testStartedAt = useRef(new Date());

  const monitorRef = useRef<StethoscopeMonitor | null>(null);
  const lastLiveAt = useRef(0);
  const lastRecAt = useRef(0);

  // Look for a connected USB stethoscope. Keep the same `device` reference when
  // the connection status hasn't changed so the monitor effect doesn't restart.
  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const match = await findStethoscope();
      setScanError(null);
      setDevice((prev) =>
        (prev?.label ?? null) === (match?.label ?? null) ? prev : match,
      );
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  // Scan on mount and re-scan whenever an audio device is plugged/unplugged.
  useEffect(() => {
    void scan();
    const unsub = subscribeDeviceChanges(() => {
      void scan();
    });
    return unsub;
  }, [scan]);

  // Run the capture monitor only while a USB stethoscope is connected.
  useEffect(() => {
    if (!device) {
      const prev = monitorRef.current;
      monitorRef.current = null;
      void prev?.stop();
      setMonitoring(false);
      setRecording(false);
      setLiveSamples(null);
      setAnalysis({ bpm: null, hasBeat: false, rms: 0 });
      return;
    }

    let cancelled = false;
    let monitor: StethoscopeMonitor | null = null;
    (async () => {
      const ok = await requestMic();
      if (!ok) {
        setScanError('Mikrofon izni verilmedi. Ayarlardan izin verin.');
        return;
      }
      monitor = new StethoscopeMonitor({
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
        onRecordingProgress: (s) =>
          testModeRef.current ? setTestElapsedS(s) : setRecordElapsedS(s),
        onRecordingChunk: (acc) => {
          if (testModeRef.current) return; // minutes of audio: keep showing the live view instead
          const now = Date.now();
          if (now - lastRecAt.current < 66) return;
          lastRecAt.current = now;
          setRecordSamples(acc);
        },
        onRecordingComplete: (rec) => {
          if (testModeRef.current) {
            testModeRef.current = false;
            setTestActive(false);
            setTestSaving(true);
            saveTestRecording(rec, monitorRef.current?.captureInfo ?? null, testStartedAt.current)
              .then((p) =>
                setTestMsg(
                  `Kaydedildi (${rec.durationS.toFixed(1)} s, ${
                    monitorRef.current?.captureInfo?.source ?? '?'
                  }): ${p}`,
                ),
              )
              .catch((e) => setTestMsg(`Kaydedilemedi: ${e instanceof Error ? e.message : String(e)}`))
              .finally(() => setTestSaving(false));
            return;
          }
          setRecording(false);
          setCompleted(rec);
        },
        onError: (e) => setScanError(e.message),
      });
      monitor.setAnalyzer(analyzeWindow);
      monitorRef.current = monitor;
      try {
        await monitor.start();
        if (!cancelled) setMonitoring(true);
      } catch (e) {
        setScanError(e instanceof Error ? e.message : String(e));
        setMonitoring(false);
      }
    })();

    return () => {
      cancelled = true;
      setMonitoring(false);
      const m = monitorRef.current;
      monitorRef.current = null;
      void m?.stop();
    };
  }, [device]);

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

  const onStartTest = useCallback(() => {
    const monitor = monitorRef.current;
    if (!monitor || !monitoring || recording || testModeRef.current) return;
    testModeRef.current = true;
    testStartedAt.current = new Date();
    setTestMsg(null);
    setTestElapsedS(0);
    setTestActive(true);
    monitor.startRecording(TEST_RECORDING_S);
  }, [monitoring, recording]);

  const onStopTest = useCallback(() => {
    monitorRef.current?.finishRecordingNow(); // -> onRecordingComplete saves the file
  }, []);

  // Unplugging the stethoscope stops the monitor and drops a running test recording.
  useEffect(() => {
    if (!monitoring && testModeRef.current) {
      testModeRef.current = false;
      setTestActive(false);
      setTestMsg('Bağlantı kesildi, test kaydı iptal edildi.');
    }
  }, [monitoring]);

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
        <Header connected={monitoring} scanning={scanning} onRetry={scan} />
        <ScrollView contentContainerClassName="mx-auto w-full max-w-md p-4 pb-8 gap-4">
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
              disabled={!monitoring || testActive}
              onToggle={onToggleRecord}
            />
          </View>

          <TestRecordPanel
            active={testActive}
            saving={testSaving}
            elapsedS={testElapsedS}
            disabled={!monitoring || recording}
            message={testMsg}
            onStart={onStartTest}
            onStop={onStopTest}
          />

          <ParityTestButton />

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
