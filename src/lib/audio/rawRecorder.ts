// Thin JS wrapper around the native AudioCapture module (raw AudioRecord with
// AudioSource.UNPROCESSED). Replaces @picovoice/react-native-voice-processor so
// the OS doesn't high-pass / AGC the signal before our DSP sees it.

import {
  NativeEventEmitter,
  NativeModules,
  type EmitterSubscription,
} from 'react-native';

type AudioCaptureNative = {
  start(sampleRate: number, frameLength: number): Promise<void>;
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
  async start(frameLength: number, sampleRate: number): Promise<void> {
    if (!Native) throw new Error('AudioCapture yerel modülü bulunamadı.');
    await Native.start(sampleRate, frameLength);
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
