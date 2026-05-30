import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { RECORDING_LENGTH_S } from '../lib/audio/constants';
import { COLORS } from '../theme';

type Props = {
  recording: boolean;
  elapsedS: number;
  disabled?: boolean;
  onToggle: () => void;
};

const SIZE = 96;
const R = 44;

export function RecordButton({ recording, elapsedS, disabled, onToggle }: Props) {
  const clamped = Math.min(elapsedS, RECORDING_LENGTH_S);
  const pct = clamped / RECORDING_LENGTH_S;

  const { bg, fg } = useMemo(() => {
    const c = SIZE / 2;
    const bgP = Skia.Path.Make();
    bgP.addCircle(c, c, R);
    const fgP = Skia.Path.Make();
    const oval = Skia.XYWHRect(c - R, c - R, 2 * R, 2 * R);
    if (pct > 0) fgP.addArc(oval, -90, pct * 360);
    return { bg: bgP, fg: fgP };
  }, [pct]);

  return (
    <View className="flex-row items-center gap-4">
      <View style={{ width: SIZE, height: SIZE }}>
        <Canvas style={{ width: SIZE, height: SIZE }}>
          <Path path={bg} color={COLORS.teal100} style="stroke" strokeWidth={6} />
          <Path
            path={fg}
            color={COLORS.teal700}
            style="stroke"
            strokeWidth={6}
            strokeCap="round"
          />
        </Canvas>
        <View className="absolute inset-0 items-center justify-center">
          <Text className="text-xs font-medium text-zinc-700">
            {Math.floor(clamped)}sn / {RECORDING_LENGTH_S}sn
          </Text>
        </View>
      </View>

      <Pressable
        onPress={onToggle}
        disabled={disabled}
        accessibilityLabel={recording ? 'Kaydı durdur' : 'Kaydı başlat'}
        className={`h-20 w-20 items-center justify-center rounded-full border-4 border-teal-700 active:scale-95 ${
          disabled ? 'opacity-50' : ''
        }`}>
        <View
          className={`bg-red-600 ${
            recording ? 'h-7 w-7 rounded-sm' : 'h-14 w-14 rounded-full'
          }`}
        />
      </Pressable>
    </View>
  );
}
