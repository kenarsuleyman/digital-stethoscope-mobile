// Decode a WAV file (read off disk as base64) into a mono Float32Array.
// Replaces the web app's WebAudio decodeAudioData for the file-upload path.
// Supports PCM 16/24/32-bit integer and 32-bit IEEE float, mono or multi-channel
// (channels are averaged to mono), matching the live-capture Recording shape.

import type { Recording } from './types';

const B64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Hermes does not guarantee a global atob, so decode base64 ourselves.
export function base64ToUint8(b64: string): Uint8Array {
  const lookup = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;

  // Strip whitespace and padding length.
  let len = b64.length;
  while (len > 0 && (b64[len - 1] === '=' || b64[len - 1] === '\n' || b64[len - 1] === '\r')) {
    len--;
  }
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);

  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < len; i++) {
    const v = lookup[b64.charCodeAt(i)];
    if (v < 0) continue; // skip non-base64 chars
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return o === outLen ? out : out.subarray(0, o);
}

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

export function decodeWav(bytes: Uint8Array): Recording {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44 || readFourCC(view, 0) !== 'RIFF' || readFourCC(view, 8) !== 'WAVE') {
    throw new Error('Geçersiz WAV dosyası (RIFF/WAVE başlığı bulunamadı).');
  }

  // Walk chunks to find 'fmt ' and 'data' (sizes/order are not fixed).
  let fmtOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;
  let p = 12;
  while (p + 8 <= bytes.length) {
    const id = readFourCC(view, p);
    const size = view.getUint32(p + 4, true);
    if (id === 'fmt ') fmtOffset = p + 8;
    else if (id === 'data') {
      dataOffset = p + 8;
      dataSize = Math.min(size, bytes.length - dataOffset);
    }
    p += 8 + size + (size & 1); // chunks are word-aligned
  }
  if (fmtOffset < 0 || dataOffset < 0) {
    throw new Error('WAV fmt/data bölümü eksik.');
  }

  const audioFormat = view.getUint16(fmtOffset, true); // 1 = PCM, 3 = IEEE float
  const channels = view.getUint16(fmtOffset + 2, true) || 1;
  const sampleRate = view.getUint32(fmtOffset + 4, true);
  const bitsPerSample = view.getUint16(fmtOffset + 14, true);
  const bytesPerSample = bitsPerSample >> 3;
  const frameSize = bytesPerSample * channels;
  if (frameSize === 0) throw new Error('WAV biçimi okunamadı.');
  const frames = Math.floor(dataSize / frameSize);

  const samples = new Float32Array(frames);
  const isFloat = audioFormat === 3;

  for (let f = 0; f < frames; f++) {
    let acc = 0;
    const base = dataOffset + f * frameSize;
    for (let c = 0; c < channels; c++) {
      const off = base + c * bytesPerSample;
      let s: number;
      if (isFloat) {
        s = bitsPerSample === 64 ? view.getFloat64(off, true) : view.getFloat32(off, true);
      } else if (bitsPerSample === 16) {
        s = view.getInt16(off, true) / 0x8000;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(off);
        const b1 = view.getUint8(off + 1);
        const b2 = view.getUint8(off + 2);
        let v = b0 | (b1 << 8) | (b2 << 16);
        if (v & 0x800000) v |= ~0xffffff; // sign-extend
        s = v / 0x800000;
      } else if (bitsPerSample === 32) {
        s = view.getInt32(off, true) / 0x80000000;
      } else if (bitsPerSample === 8) {
        s = (view.getUint8(off) - 128) / 128; // 8-bit WAV is unsigned
      } else {
        throw new Error(`Desteklenmeyen WAV bit derinliği: ${bitsPerSample}`);
      }
      acc += s;
    }
    samples[f] = acc / channels;
  }

  return { samples, sampleRate, durationS: frames / sampleRate };
}

export function decodeWavBase64(b64: string): Recording {
  return decodeWav(base64ToUint8(b64));
}
