import React, { useCallback, useMemo, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { Canvas, Path, Rect, Skia } from '@shopify/react-native-skia';
import { COLORS } from '../theme';
import type { Spectrum } from '../lib/audio/spectrum';

const SPECTRUM_MAX_HZ = 500;
const CARDIAC_LOW = 20;
const CARDIAC_HIGH = 150;

type Props = {
  spectrum: Spectrum;
  label: string;
  height?: number;
};

export function SpectrumPlot({ spectrum, label, height = 96 }: Props) {
  const [w, setW] = useState(0);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width),
    [],
  );
  const h = height;

  const { band, grid, fill, stroke, labels } = useMemo(() => {
    const gridP = Skia.Path.Make();
    const fillP = Skia.Path.Make();
    const strokeP = Skia.Path.Make();
    const lbls: { hz: number; x: number }[] = [];
    let bandRect = { x: 0, width: 0 };
    const { freqs, mags } = spectrum;
    if (w <= 0 || freqs.length === 0) {
      return { band: bandRect, grid: gridP, fill: fillP, stroke: strokeP, labels: lbls };
    }
    const maxHz = freqs[freqs.length - 1] || SPECTRUM_MAX_HZ;
    const hzToX = (hz: number) => (hz / maxHz) * w;
    const baseY = h - 12;

    bandRect = { x: hzToX(CARDIAC_LOW), width: hzToX(CARDIAC_HIGH) - hzToX(CARDIAC_LOW) };

    for (let hz = 0; hz <= maxHz; hz += 100) {
      const x = hzToX(hz);
      gridP.moveTo(x, 0);
      gridP.lineTo(x, h - 12);
      lbls.push({ hz, x: Math.min(Math.max(x, 12), w - 12) });
    }

    fillP.moveTo(0, baseY);
    for (let k = 0; k < freqs.length; k++) {
      const x = hzToX(freqs[k]);
      const y = baseY - mags[k] * (baseY - 2);
      fillP.lineTo(x, y);
      if (k === 0) strokeP.moveTo(x, y);
      else strokeP.lineTo(x, y);
    }
    fillP.lineTo(w, baseY);
    fillP.close();

    return { band: bandRect, grid: gridP, fill: fillP, stroke: strokeP, labels: lbls };
  }, [w, h, spectrum]);

  return (
    <View>
      <Text className="mb-1 text-xs text-zinc-500">{label}</Text>
      <View
        onLayout={onLayout}
        style={{ height: h }}
        className="w-full overflow-hidden rounded-lg bg-zinc-50">
        {w > 0 && (
          <>
            <Canvas style={{ width: w, height: h }}>
              <Rect x={band.x} y={0} width={band.width} height={h} color={COLORS.cardBand} />
              <Path path={grid} color={COLORS.grid} style="stroke" strokeWidth={1} />
              <Path path={fill} color={COLORS.spectrumFill} />
              <Path path={stroke} color={COLORS.teal700} style="stroke" strokeWidth={1.2} />
            </Canvas>
            {labels.map((l, i) => (
              <Text
                key={i}
                className="absolute text-[10px] text-slate-400"
                style={{ left: l.x - 10, bottom: 0, width: 20, textAlign: 'center' }}>
                {l.hz}
              </Text>
            ))}
          </>
        )}
      </View>
    </View>
  );
}
