import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import RNFS from 'react-native-fs';
import {
  BANDPASS_HIGH,
  BANDPASS_LOW,
  BUTTER_ORDER,
  SEGMENT_SAMPLES,
  TARGET_SR,
} from '../lib/audio/constants';
import { bandpass } from '../lib/audio/filter';
import { resamplePoly } from '../lib/audio/resample';
import { magnitudeSpectrum } from '../lib/audio/spectrum';
import type { Recording } from '../lib/audio/types';
import {
  bytesToBase64,
  encodeWavBytes,
  timestampedWavName,
} from '../lib/audio/wavEncode';
import { SignalPlot } from './SignalPlot';
import { SpectrumPlot } from './SpectrumPlot';

const SPECTRUM_MAX_HZ = 500;

type Props = { recording: Recording | null };

export function FilterComparison({ recording }: Props) {
  const [expanded, setExpanded] = useState(false);

  const data = useMemo(() => {
    if (!recording || recording.samples.length === 0) return null;
    const ds =
      recording.sampleRate === TARGET_SR
        ? recording.samples
        : resamplePoly(recording.samples, recording.sampleRate, TARGET_SR);
    const n = Math.min(SEGMENT_SAMPLES, ds.length);
    const before = ds.slice(0, n);
    const after = bandpass(before, BANDPASS_LOW, BANDPASS_HIGH, TARGET_SR, BUTTER_ORDER);
    const spectrumBefore = magnitudeSpectrum(before, TARGET_SR, SPECTRUM_MAX_HZ);
    const spectrumAfter = magnitudeSpectrum(after, TARGET_SR, SPECTRUM_MAX_HZ);
    return { before, after, spectrumBefore, spectrumAfter };
  }, [recording]);

  if (!data || !recording) return null;

  const saveWav = async () => {
    try {
      const bytes = encodeWavBytes(recording.samples, recording.sampleRate);
      const name = timestampedWavName();
      const dir = RNFS.ExternalDirectoryPath ?? RNFS.DocumentDirectoryPath;
      const path = `${dir}/${name}`;
      await RNFS.writeFile(path, bytesToBase64(bytes), 'base64');
      Alert.alert('WAV kaydedildi', path);
    } catch (e) {
      Alert.alert('Kaydedilemedi', e instanceof Error ? e.message : String(e));
    }
  };

  const plots = (h?: number) => (
    <>
      <SignalPlot samples={data.before} label="Filtre öncesi (ham)" color="#94a3b8" height={h} />
      <View className="h-3" />
      <SignalPlot
        samples={data.after}
        label="Filtre sonrası (25–900 Hz)"
        color="#0f766e"
        height={h}
      />
      <View className="h-3" />
      <SpectrumPlot
        spectrum={data.spectrumBefore}
        label="Spektrum — filtre öncesi (FFT, kardiyak bant 20–150 Hz)"
        height={h}
      />
      <View className="h-3" />
      <SpectrumPlot
        spectrum={data.spectrumAfter}
        label="Spektrum — filtre sonrası (FFT, kardiyak bant 20–150 Hz)"
        height={h}
      />
    </>
  );

  return (
    <View className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <View className="mb-1 flex-row items-start justify-between gap-2">
        <Text className="flex-1 text-sm font-medium text-zinc-700">
          Bant geçiren filtre (25–900 Hz)
        </Text>
        <View className="flex-row gap-2">
          <Pressable
            onPress={saveWav}
            className="rounded-md border border-zinc-200 px-2 py-1 active:bg-teal-50">
            <Text className="text-xs font-medium text-teal-700">⤓ WAV indir</Text>
          </Pressable>
          <Pressable
            onPress={() => setExpanded(true)}
            className="rounded-md border border-zinc-200 px-2 py-1 active:bg-teal-50">
            <Text className="text-xs font-medium text-teal-700">⤢ Büyüt</Text>
          </Pressable>
        </View>
      </View>
      <Text className="mb-3 text-xs text-zinc-400">
        İlk 5 sn segment, 4 kHz'e indirilmiş hâliyle.
      </Text>
      {plots()}

      <Modal visible={expanded} animationType="slide" onRequestClose={() => setExpanded(false)} transparent>
        <View className="flex-1 bg-black/70 p-4">
          <View className="m-auto max-h-full w-full rounded-2xl bg-white p-5">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-medium text-zinc-800">
                Bant geçiren filtre (25–900 Hz)
              </Text>
              <Pressable
                onPress={() => setExpanded(false)}
                className="rounded-md border border-zinc-200 px-3 py-1 active:bg-zinc-100">
                <Text className="text-sm font-medium text-zinc-600">✕ Kapat</Text>
              </Pressable>
            </View>
            <ScrollView>{plots(180)}</ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
