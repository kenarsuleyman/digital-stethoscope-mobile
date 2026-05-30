import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
} from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { SEGMENT_LENGTH_S } from '../lib/audio/constants';
import type { Recording } from '../lib/audio/types';
import { decodeWavBase64 } from '../lib/audio/wavDecode';

type Props = {
  onLoaded: (rec: Recording, filename: string) => void;
  onError: (msg: string) => void;
};

function fileUriToPath(uri: string): string {
  let p = uri;
  if (p.startsWith('file://')) p = p.slice('file://'.length);
  try {
    p = decodeURIComponent(p);
  } catch {}
  return p;
}

export function FileUploadPanel({ onLoaded, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);

  const onPick = async () => {
    setBusy(true);
    try {
      const [picked] = await pick({ type: [types.audio] });
      if (!picked) return;
      const [copy] = await keepLocalCopy({
        files: [{ uri: picked.uri, fileName: picked.name ?? 'audio.wav' }],
        destination: 'cachesDirectory',
      });
      if (copy.status !== 'success') throw new Error('Dosya kopyalanamadı.');
      const b64 = await RNFS.readFile(fileUriToPath(copy.localUri), 'base64');
      const rec = decodeWavBase64(b64);
      if (rec.durationS < SEGMENT_LENGTH_S) {
        throw new Error(
          `Ses dosyası en az ${SEGMENT_LENGTH_S} saniye olmalı (yüklenen: ${rec.durationS.toFixed(1)} sn).`,
        );
      }
      setFilename(picked.name ?? 'Dosya');
      onLoaded(rec, picked.name ?? 'Dosya');
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return;
      onError(e instanceof Error ? e.message : String(e));
      setFilename(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        className="flex-row items-center justify-between px-5 py-3">
        <Text className="text-sm font-medium text-zinc-700">Dosyadan yükle</Text>
        <Text className="text-zinc-500">{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open && (
        <View className="border-t border-zinc-200 px-5 py-4">
          <Text className="mb-3 text-xs text-zinc-500">
            Mikrofon yerine bilgisayardan bir kayıt dosyası (WAV) yükleyebilirsiniz.
            En az {SEGMENT_LENGTH_S} saniye olmalı.
          </Text>
          <Pressable
            onPress={onPick}
            disabled={busy}
            className={`self-start rounded-md border border-teal-700 px-3 py-2 active:bg-teal-50 ${
              busy ? 'opacity-50' : ''
            }`}>
            <Text className="text-sm font-medium text-teal-700">
              {busy ? 'Yükleniyor...' : 'Dosya Seç'}
            </Text>
          </Pressable>
          {filename && (
            <Text className="mt-3 text-xs text-zinc-500">
              Yüklendi: <Text className="font-medium text-zinc-700">{filename}</Text>
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
