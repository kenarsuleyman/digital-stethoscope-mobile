// USB stethoscope detection. Wraps the native AudioDevices module
// (AudioManager.getDevices) so we only treat the stethoscope as "connected"
// when an actual USB Audio Class input device is present — instead of silently
// falling back to the built-in microphone.

import { NativeEventEmitter, NativeModules } from 'react-native';

export type InputDevice = {
  type: number;
  typeName: string;
  isUsb: boolean;
  productName: string;
  id: number;
};

type AudioDevicesNative = {
  listInputs(): Promise<InputDevice[]>;
  startObserving(): void;
  stopObserving(): void;
};

const Native: AudioDevicesNative | undefined = NativeModules.AudioDevices;

export type DeviceMatch = { label: string };

// The web app matched the Teensy USB Audio Class stethoscope by label.
const LABEL_RE = /teensy|stethoscope|audio class|uac/i;

export async function findStethoscope(): Promise<DeviceMatch | null> {
  if (!Native) return null;
  const inputs = await Native.listInputs();
  const usb = inputs.filter((d) => d.isUsb);
  if (usb.length === 0) return null;
  const match = usb.find((d) => LABEL_RE.test(d.productName)) ?? usb[0];
  return { label: match.productName || 'USB ses cihazı' };
}

// Calls `onChange` whenever an audio input device is plugged or unplugged.
export function subscribeDeviceChanges(onChange: () => void): () => void {
  if (!Native) return () => {};
  Native.startObserving();
  const emitter = new NativeEventEmitter(NativeModules.AudioDevices);
  const sub = emitter.addListener('audioDevicesChanged', onChange);
  return () => {
    sub.remove();
    Native.stopObserving();
  };
}
