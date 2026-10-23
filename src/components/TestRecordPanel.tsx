import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { TEST_RECORDING_S } from '../lib/audio/constants';

type Props = {
  active: boolean; // test recording in progress
  saving: boolean;
  elapsedS: number;
  disabled?: boolean;
  message: string | null;
  onStart: () => void;
  onStop: () => void;
};

// Bench test mode: one long raw recording (up to TEST_RECORDING_S) saved automatically as WAV + JSON.
export function TestRecordPanel({ active, saving, elapsedS, disabled, message, onStart, onStop }: Props) {
  const s = Math.floor(Math.min(elapsedS, TEST_RECORDING_S));
  const mmss = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <View className="rounded-md border border-zinc-200 bg-white p-3 gap-2">
      <Text className="text-sm font-semibold text-zinc-800">Test kaydı (laboratuvar ölçümü)</Text>
      <Text className="text-xs text-zinc-500">
        Ham akışı en fazla {TEST_RECORDING_S / 60} dk kaydeder ve WAV + JSON olarak otomatik kaydeder.
        Dizi bitince “Durdur ve kaydet”e basın.
      </Text>
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={active ? onStop : onStart}
          disabled={disabled || saving}
          className={`rounded-md px-4 py-2 ${active ? 'bg-red-600' : 'bg-teal-700'} ${
            disabled || saving ? 'opacity-50' : ''
          }`}>
          <Text className="text-sm font-medium text-white">
            {saving ? 'Kaydediliyor…' : active ? 'Durdur ve kaydet' : 'Test kaydını başlat'}
          </Text>
        </Pressable>
        {active && <Text className="text-sm font-medium text-zinc-700">{mmss}</Text>}
      </View>
      {message && <Text className="text-xs text-zinc-600">{message}</Text>}
    </View>
  );
}
