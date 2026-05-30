import React, { useCallback, useMemo, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { COLORS } from '../theme';

type Props = {
  samples: Float32Array;
  label: string;
  color: string;
  height?: number;
};

export function SignalPlot({ samples, label, color, height = 96 }: Props) {
  const [w, setW] = useState(0);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width),
    [],
  );
  const h = height;

  const { mid, wave } = useMemo(() => {
    const midP = Skia.Path.Make();
    const waveP = Skia.Path.Make();
    if (w <= 0) return { mid: midP, wave: waveP };
    midP.moveTo(0, h / 2);
    midP.lineTo(w, h / 2);

    if (samples.length > 0) {
      const step = Math.max(1, Math.floor(samples.length / w));
      let maxAbs = 0;
      for (let i = 0; i < samples.length; i += step) {
        const a = Math.abs(samples[i]);
        if (a > maxAbs) maxAbs = a;
      }
      const scale = maxAbs > 0 ? ((h / 2) * 0.95) / maxAbs : 1;
      for (let x = 0; x < w; x++) {
        const start = x * step;
        const end = Math.min(start + step, samples.length);
        let lo = 0;
        let hi = 0;
        for (let i = start; i < end; i++) {
          const v = samples[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        waveP.moveTo(x + 0.5, h / 2 - hi * scale);
        waveP.lineTo(x + 0.5, h / 2 - lo * scale);
      }
    }
    return { mid: midP, wave: waveP };
  }, [w, h, samples]);

  return (
    <View>
      <Text className="mb-1 text-xs text-zinc-500">{label}</Text>
      <View
        onLayout={onLayout}
        style={{ height: h }}
        className="w-full overflow-hidden rounded-lg bg-zinc-50">
        {w > 0 && (
          <Canvas style={{ width: w, height: h }}>
            <Path path={mid} color={COLORS.slate200} style="stroke" strokeWidth={1} />
            <Path path={wave} color={color} style="stroke" strokeWidth={1} />
          </Canvas>
        )}
      </View>
    </View>
  );
}
