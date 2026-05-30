import React from 'react';
import { Text, View } from 'react-native';
import type { Prediction } from '../lib/model/predict';

type Props = { result: Prediction | null; error: string | null };

export function ResultPanel({ result, error }: Props) {
  if (error) {
    return (
      <View className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <Text className="text-sm text-rose-800">{error}</Text>
      </View>
    );
  }
  if (!result) return null;

  const abnormal = result.label === 'Abnormal';
  const label = abnormal ? 'Anormal' : 'Normal';
  const confidence = abnormal ? result.probability : 1 - result.probability;

  return (
    <View
      className={`rounded-2xl border p-4 ${
        abnormal ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'
      }`}>
      <View className="flex-row items-baseline justify-between">
        <Text
          className={`text-lg font-bold ${
            abnormal ? 'text-amber-800' : 'text-emerald-800'
          }`}>
          {label}
        </Text>
        <Text className="text-sm text-zinc-600">
          Güven: %{(confidence * 100).toFixed(1)}
        </Text>
      </View>
      <Text className="mt-1 text-xs text-zinc-500">
        Segment olasılıkları: {result.perSegment.map((p) => p.toFixed(3)).join(', ')}
      </Text>
    </View>
  );
}
