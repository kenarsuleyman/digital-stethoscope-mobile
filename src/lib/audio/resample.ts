// Polyphase resampler equivalent to scipy.signal.resample_poly with a
// Hamming-windowed sinc anti-aliasing FIR. Handles any rational ratio.

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
}

function designLowpass(numTaps: number, cutoffNorm: number): Float32Array {
  // cutoffNorm: in [0, 1], where 1 is Nyquist of the (upsampled) signal.
  const h = new Float32Array(numTaps);
  const M = numTaps - 1;
  let sum = 0;
  for (let n = 0; n <= M; n++) {
    const x = n - M / 2;
    const sinc =
      x === 0
        ? cutoffNorm
        : Math.sin(Math.PI * cutoffNorm * x) / (Math.PI * x);
    const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / M);
    h[n] = sinc * win;
    sum += h[n];
  }
  // Normalize DC gain to 1 (then we'll scale by L to compensate for
  // zero-insertion in the polyphase math).
  for (let i = 0; i < numTaps; i++) h[i] /= sum;
  return h;
}

export function resamplePoly(
  x: Float32Array,
  sourceSr: number,
  targetSr: number,
): Float32Array {
  if (sourceSr === targetSr) return x.slice();

  const g = gcd(sourceSr, targetSr);
  const L = targetSr / g; // upsample factor
  const M = sourceSr / g; // downsample factor
  const maxLM = Math.max(L, M);

  // Filter length similar to scipy default (kaiser, ~20*max(L,M) taps).
  // Use odd number for linear phase.
  let numTaps = 20 * maxLM + 1;
  if (numTaps % 2 === 0) numTaps += 1;

  // Cutoff is min Nyquist of input/output, in normalized (upsampled) units.
  // After zero-insertion the new Nyquist is fs_in*L/2, and we must keep
  // everything below min(fs_in, fs_out)/2 = fs_in/(2*max(L,M)) in
  // upsampled-Nyquist units => normalized cutoff = 1/max(L,M).
  const cutoffNorm = 1 / maxLM;
  const h = designLowpass(numTaps, cutoffNorm);
  // Scale by L: zero-insertion drops average level by 1/L.
  for (let i = 0; i < numTaps; i++) h[i] *= L;

  const outLen = Math.ceil((x.length * L) / M);
  const out = new Float32Array(outLen);
  const halfTap = (numTaps - 1) / 2; // linear-phase delay (in upsampled samples)

  // Polyphase: y[n] = sum_k h[k] * x_up[n*M - k]
  //   where x_up[m] = x[m/L] if m mod L == 0 else 0
  //   => only k with (n*M - k) mod L == 0 contributes
  //   => k = ((n*M) mod L), then step by L
  // Compensate for filter delay by sampling at n*M + halfTap in upsampled time.
  for (let n = 0; n < outLen; n++) {
    const t = n * M + halfTap;
    const phase = ((t % L) + L) % L;
    let acc = 0;
    // First valid k: k = phase, then phase+L, phase+2L, ...
    // Corresponding x index: (t - k) / L
    for (let k = phase; k < numTaps; k += L) {
      const xIdx = (t - k) / L;
      if (xIdx < 0) continue;
      if (xIdx >= x.length) continue;
      acc += h[k] * x[xIdx];
    }
    out[n] = acc;
  }
  return out;
}
