// Thin JS wrapper around the native AudioCapture module (raw AudioRecord with
// AudioSource.UNPROCESSED). Replaces @picovoice/react-native-voice-processor so
// the OS doesn't high-pass / AGC the signal before our DSP sees it.

import {
  NativeEventEmitter,
  NativeModules,
  type EmitterSubscription,
} from 'react-native';

/** What Android actually opened (AudioCaptureModule.start). */
export type CaptureInfo = {
  source: string; // UNPROCESSED / VOICE_RECOGNITION / MIC
  sampleRate: number;
  bufferBytes: number;
  routedDevice: string;
  routedDeviceType: number; // AudioDeviceInfo.TYPE_* (11 = USB device, 22 = USB headset)
};

type AudioCaptureNative = {
  start(sampleRate: number, frameLength: number): Promise<CaptureInfo | null>;
  stop(): Promise<void>;
  isRecording(): Promise<boolean>;
};

const Native: AudioCaptureNative | undefined = NativeModules.AudioCapture;

export type FrameListener = (frame: number[]) => void;

let emitter: NativeEventEmitter | null = null;
function getEmitter(): NativeEventEmitter {
  if (!emitter) emitter = new NativeEventEmitter(NativeModules.AudioCapture);
  return emitter;
}

export const RawRecorder = {
  available(): boolean {
    return !!Native;
  },
  async start(frameLength: number, sampleRate: number): Promise<CaptureInfo | null> {
    if (!Native) throw new Error('AudioCapture yerel modülü bulunamadı.');
    return (await Native.start(sampleRate, frameLength)) ?? null;
  },
  async stop(): Promise<void> {
    await Native?.stop();
  },
  async isRecording(): Promise<boolean> {
    return (await Native?.isRecording()) ?? false;
  },
  addFrameListener(listener: FrameListener): EmitterSubscription {
    return getEmitter().addListener('audioFrame', listener);
  },
};
