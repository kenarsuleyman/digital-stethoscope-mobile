import React from 'react';
import { Pressable, Text, View } from 'react-native';

type Props = {
  deviceLabel: string | null;
  onRetry: () => void;
  busy: boolean;
};

export function DeviceCard({ deviceLabel, onRetry, busy }: Props) {
  return (
    <View className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-base font-semibold text-zinc-900">
            {deviceLabel ?? 'Teensy 4.0 • 16 kHz • 16-bit'}
          </Text>
          <Text className="mt-1 text-sm text-zinc-500">
            Stetoskopu OTG adaptörü ile USB-C portuna takın.
          </Text>
        </View>
        <Pressable
          onPress={onRetry}
          disabled={busy}
          className={`shrink-0 rounded-md px-2 py-1 active:bg-teal-50 ${
            busy ? 'opacity-50' : ''
          }`}>
          <Text className="text-sm font-medium text-teal-700">↻ Tekrar Dene</Text>
        </Pressable>
      </View>
    </View>
  );
}
