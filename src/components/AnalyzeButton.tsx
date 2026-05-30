import React from 'react';
import { Pressable, Text } from 'react-native';

type Props = {
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
};

export function AnalyzeButton({ disabled, busy, onPress }: Props) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      className={`w-full items-center rounded-full px-5 py-3 shadow-sm ${
        off ? 'bg-zinc-300' : 'bg-teal-700 active:bg-teal-800'
      }`}>
      <Text className="text-base font-semibold text-white">
        {busy ? 'Analiz ediliyor...' : 'Analiz Et'}
      </Text>
    </Pressable>
  );
}
