import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, type LayoutChangeEvent } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { COLORS } from '../theme';

type Props = {
  samples: Float32Array | null;
  elapsedMs: number;
  bpm: number | null;
  active: boolean;
  hasBeat: boolean;
  recordingProgress?: number | null; // 0..1 while recording
};

const H = 160;

export function WaveformChart({
  samples,
  elapsedMs,
  bpm,
  active,
  hasBeat,
  recordingProgress = null,
}: Props) {
  const isRecording = recordingProgress !== null;
  const [w, setW] = useState(0);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width),
    [],
  );

  const { gridPath, centerPath, wavePath, cursorX } = useMemo(() => {
    const grid = Skia.Path.Make();
    const center = Skia.Path.Make();
    const wave = Skia.Path.Make();
    let cx = -1;
    if (w <= 0) return { gridPath: grid, centerPath: center, wavePath: wave, cursorX: cx };

    const cellsX = 10;
    const cellsY = 4;
    for (let i = 1; i < cellsX; i++) {
      const x = (i * w) / cellsX;
      grid.moveTo(x, 0);
      grid.lineTo(x, H);
    }
    for (let i = 1; i < cellsY; i++) {
      const y = (i * H) / cellsY;
      grid.moveTo(0, y);
      grid.lineTo(w, y);
    }
    center.moveTo(0, H / 2);
    center.lineTo(w, H / 2);

    const fillW = isRecording
      ? Math.max(1, Math.round((recordingProgress ?? 0) * w))
      : w;

    if (samples && samples.length > 0) {
      const step = Math.max(1, Math.floor(samples.length / fillW));
      let maxAbs = 0;
      for (let i = 0; i < samples.length; i += step) {
        const a = Math.abs(samples[i]);
        if (a > maxAbs) maxAbs = a;
      }
      const scale = maxAbs > 0 ? H / 2 / maxAbs : 1;
      for (let x = 0; x < fillW; x++) {
        const start = x * step;
        const end = Math.min(start + step, samples.length);
        let lo = 0;
        let hi = 0;
        for (let i = start; i < end; i++) {
          const v = samples[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        wave.moveTo(x + 0.5, H / 2 - hi * scale);
        wave.lineTo(x + 0.5, H / 2 - lo * scale);
      }
    }

    if (isRecording && fillW < w) cx = fillW + 0.5;
    return { gridPath: grid, centerPath: center, wavePath: wave, cursorX: cx };
  }, [w, samples, isRecording, recordingProgress]);

  const waveColor = isRecording || hasBeat ? COLORS.teal700 : COLORS.slate400;

  let overlay: string | null = null;
  if (isRecording) overlay = null;
  else if (!active) overlay = 'Stetoskop bağlı değil';
  else if (!samples || samples.length === 0) overlay = 'Sinyal bekleniyor...';
  else if (!hasBeat) overlay = 'Kalp atışı algılanmadı';

  return (
    <View className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-sm font-medium text-zinc-600">
          {bpm !== null ? `${bpm} BPM` : '— BPM'}
        </Text>
        <Text className="text-sm text-zinc-600">{formatTime(elapsedMs)}</Text>
      </View>
      <View
        onLayout={onLayout}
        style={{ height: H }}
        className="w-full overflow-hidden rounded-lg bg-zinc-50">
        {w > 0 && (
          <Canvas style={{ width: w, height: H }}>
            <Path path={gridPath} color={COLORS.slate200} style="stroke" strokeWidth={1} />
            <Path path={centerPath} color={COLORS.slate300} style="stroke" strokeWidth={1} />
            <Path path={wavePath} color={waveColor} style="stroke" strokeWidth={1.2} />
            {cursorX >= 0 && (
              <Path
                path={(() => {
                  const p = Skia.Path.Make();
                  p.moveTo(cursorX, 0);
                  p.lineTo(cursorX, H);
                  return p;
                })()}
                color={COLORS.teal700}
                style="stroke"
                strokeWidth={2}
              />
            )}
          </Canvas>
        )}
        {overlay && (
          <View className="absolute inset-x-0 top-1/2 -translate-y-3 items-center">
            <View className="bg-zinc-50/80 px-2 py-1">
              <Text className="text-[13px] text-slate-500">{overlay}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}
