import React from 'react';
import { Text, View } from 'react-native';

type Props = { connected: boolean };

export function Header({ connected }: Props) {
  return (
    <View className="flex-row items-center justify-between bg-teal-700 px-5 py-4 shadow">
      <View className="flex-row items-center gap-2">
        <Text className="text-lg">🩺</Text>
        <Text className="text-lg font-bold tracking-tight text-white">
          Dijital Steteskop
        </Text>
      </View>
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
    </View>
  );
}
