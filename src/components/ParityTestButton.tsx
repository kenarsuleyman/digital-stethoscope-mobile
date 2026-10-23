import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { runParityTest } from '../test/parityTest';

// Runs src/test/parityTest.ts on the WAVs + golden.json pushed to <ExternalDir>/test_wavs/ (adb push) and
// writes <ExternalDir>/rn_results.json. Test branch only.
export function ParityTestButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg('Çalışıyor… (yaklaşık 1 dk, ekranı açık tutun)');
    try {
      const r = await runParityTest();
      setMsg(`Bitti: sınıf uyumu %${r.parity.class_agreement_pct}, MAE ${r.parity.mean_prob_MAE} (rn_results.json)`);
    } catch (e) {
      setMsg(`Hata: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="rounded-md border border-zinc-200 bg-white p-3 gap-2">
      <Text className="text-sm font-semibold text-zinc-800">Parite testi (masaüstü ↔ uygulama)</Text>
      <Pressable
        onPress={run}
        disabled={busy}
        className={`self-start rounded-md bg-zinc-700 px-4 py-2 ${busy ? 'opacity-50' : ''}`}>
        <Text className="text-sm font-medium text-white">{busy ? 'Çalışıyor…' : 'Parite testini çalıştır'}</Text>
      </Pressable>
      {msg && <Text className="text-xs text-zinc-600">{msg}</Text>}
    </View>
  );
}
