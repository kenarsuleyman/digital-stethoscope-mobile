// Bench test recordings: the raw capture stream (same path as the app's own recordings, before any DSP)
// is written as a 16-bit WAV plus a JSON sidecar describing what Android actually opened. The files go to
// the app's external files dir (…/Android/data/com.digitalstethoscope/files/test_recordings/) and are
// pulled to the PC with `adb pull` for the MATLAB / Python analysis.

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

import type { CaptureInfo } from './rawRecorder';
import type { Recording } from './types';
import { bytesToBase64, encodeWavBytes, timestampedWavName } from './wavEncode';

export const TEST_DIR_NAME = 'test_recordings';

export async function saveTestRecording(
  rec: Recording,
  info: CaptureInfo | null,
  startedAt: Date,
): Promise<string> {
  const base = RNFS.ExternalDirectoryPath ?? RNFS.DocumentDirectoryPath;
  const dir = `${base}/${TEST_DIR_NAME}`;
  await RNFS.mkdir(dir);
  const name = timestampedWavName('test');
  const path = `${dir}/${name}`;
  await RNFS.writeFile(path, bytesToBase64(encodeWavBytes(rec.samples, rec.sampleRate)), 'base64');

  const c = (Platform.constants ?? {}) as Record<string, unknown>;
  const meta = {
    file: name,
    startedAt: startedAt.toISOString(),
    sampleRate: rec.sampleRate,
    samples: rec.samples.length,
    durationS: rec.durationS,
    capture: info,
    device: {
      manufacturer: c.Manufacturer ?? null,
      model: c.Model ?? null,
      androidRelease: c.Release ?? null,
      sdk: Platform.Version,
    },
  };
  await RNFS.writeFile(path.replace(/\.wav$/, '.json'), JSON.stringify(meta, null, 2), 'utf8');
  return path;
}
