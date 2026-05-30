import React from 'react';
import { Pressable, Text, View } from 'react-native';

type Props = {
  connected: boolean;
  scanning?: boolean;
  onRetry?: () => void;
};

export function Header({ connected, scanning, onRetry }: Props) {
  return (
    <View className="flex-row items-center justify-between bg-teal-700 px-5 py-4 shadow">
      <View className="flex-row items-center gap-2">
        <Text className="text-lg">🩺</Text>
        <Text className="text-lg font-bold tracking-tight text-white">
          Dijital Steteskop
        </Text>
      </View>
      <View className="flex-row items-center gap-2">
        <View
          className={`rounded-full px-3 py-1 ${
            connected ? 'bg-emerald-400/90' : 'bg-rose-400/90'
          }`}>
          <Text
            className={`text-xs font-medium ${
              connected ? 'text-emerald-950' : 'text-rose-950'
            }`}>
            {connected ? 'USB Bağlı' : 'USB Bağlı Değil'}
          </Text>
        </View>
        {!connected && onRetry && (
          <Pressable
            onPress={onRetry}
            disabled={scanning}
            hitSlop={8}
            accessibilityLabel="Yeniden tara"
            className="h-8 w-8 items-center justify-center rounded-full bg-white/20 active:bg-white/30">
            <Text className="text-base font-semibold text-white">
              {scanning ? '⟳' : '↻'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
