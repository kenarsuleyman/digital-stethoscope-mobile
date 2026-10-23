// Zero-phase Butterworth bandpass via SOS (sosfiltfilt equivalent).
// Designs filter at runtime from (order, low, high, fs) using the bilinear
// transform on a Butterworth analog prototype, then runs forward + reverse.

type Complex = { re: number; im: number };

const C = (re: number, im = 0): Complex => ({ re, im });
const cadd = (a: Complex, b: Complex): Complex => C(a.re + b.re, a.im + b.im);
const csub = (a: Complex, b: Complex): Complex => C(a.re - b.re, a.im - b.im);
const cmul = (a: Complex, b: Complex): Complex =>
  C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const csqrt = (a: Complex): Complex => {
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sign(a.im || 1) * Math.sqrt((r - a.re) / 2);
  return C(re, im);
};

export type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

export function butterBandpassSOS(
  order: number,
  lowHz: number,
  highHz: number,
  fs: number,
): Biquad[] {
  // Prewarp analog bandpass center & bandwidth (bilinear transform).
  const w1 = 2 * fs * Math.tan((Math.PI * lowHz) / fs);
  const w2 = 2 * fs * Math.tan((Math.PI * highHz) / fs);
  const w0 = Math.sqrt(w1 * w2);
  const bw = w2 - w1;

  // Butterworth analog lowpass prototype poles on the unit circle in LHP.
  const lpPoles: Complex[] = [];
  for (let k = 1; k <= order; k++) {
    const theta = (Math.PI * (2 * k + order - 1)) / (2 * order);
    lpPoles.push(C(Math.cos(theta), Math.sin(theta)));
  }

  // Lowpass-to-bandpass: each LP pole p splits into two BP poles satisfying
  //   s² - (p*bw)*s + w0² = 0
  //   => s = (p*bw ± sqrt((p*bw)² - 4*w0²)) / 2
  const bpPoles: Complex[] = [];
  for (const p of lpPoles) {
    const pbw = C(p.re * bw, p.im * bw);
    const disc = csub(cmul(pbw, pbw), C(4 * w0 * w0));
    const root = csqrt(disc);
    bpPoles.push(C((pbw.re + root.re) / 2, (pbw.im + root.im) / 2));
    bpPoles.push(C((pbw.re - root.re) / 2, (pbw.im - root.im) / 2));
  }
  // BP zeros: `order` zeros at s=0, `order` at s=∞ (drop ∞ in BLT step).
  const bpZeros: Complex[] = [];
  for (let i = 0; i < order; i++) bpZeros.push(C(0, 0));

  // Bilinear transform: s -> 2*fs*(z-1)/(z+1)
  // Pole map: z = (2fs + p) / (2fs - p)
  const two_fs = 2 * fs;
  const dPoles = bpPoles.map((p) =>
    cdiv(C(two_fs + p.re, p.im), C(two_fs - p.re, -p.im)),
  );
  // Zero map for finite zero z = (2fs + zk)/(2fs - zk); for s=∞ zeros, z = -1.
  const dZeros: Complex[] = [];
  for (const z of bpZeros) {
    dZeros.push(cdiv(C(two_fs + z.re, z.im), C(two_fs - z.re, -z.im)));
  }
  for (let i = 0; i < order; i++) dZeros.push(C(-1, 0));

  // Pair conjugate pairs into 2nd-order sections.
  // Group poles and zeros into conjugate pairs, then combine into biquads.
  const polePairs = pairConjugates(dPoles);
  const zeroPairs = pairConjugates(dZeros);

  // Same count of pairs (order pairs for bandpass of analog order).
  const sections: Biquad[] = [];
  for (let i = 0; i < polePairs.length; i++) {
    const pp = polePairs[i];
    const zp = zeroPairs[i] ?? [C(-1, 0), C(-1, 0)];
    // (z - z1)(z - z2) = z² - (z1+z2)z + z1*z2
    const b1 = -(zp[0].re + zp[1].re);
    const b2 = cmul(zp[0], zp[1]).re;
    const a1 = -(pp[0].re + pp[1].re);
    const a2 = cmul(pp[0], pp[1]).re;
    sections.push({ b0: 1, b1, b2, a1, a2 });
  }

  // Normalize for unit gain at sqrt(low*high) center frequency.
  const centerHz = Math.sqrt(lowHz * highHz);
  const wc = (2 * Math.PI * centerHz) / fs;
  const z = C(Math.cos(wc), Math.sin(wc));
  const z2 = cmul(z, z);
  let g: Complex = C(1, 0);
  for (const s of sections) {
    const num = cadd(cadd(C(s.b0), cmul(C(s.b1), z)), cmul(C(s.b2), z2));
    const den = cadd(cadd(C(1), cmul(C(s.a1), z)), cmul(C(s.a2), z2));
    g = cmul(g, cdiv(num, den));
  }
  const gainMag = Math.hypot(g.re, g.im);
  if (gainMag > 0 && sections.length > 0) {
    const adjust = 1 / gainMag;
    // Distribute the inverse-gain into b coefficients of the first section.
    sections[0].b0 *= adjust;
    sections[0].b1 *= adjust;
    sections[0].b2 *= adjust;
  }

  return sections;
}

function pairConjugates(roots: Complex[]): Complex[][] {
  // Greedy: pair each complex root with its nearest conjugate; pair real
  // roots together. Returns array of [r1, r2] pairs.
  const remaining = roots.map((r) => ({ ...r }));
  const pairs: Complex[][] = [];
  while (remaining.length) {
    const r = remaining.shift()!;
    if (Math.abs(r.im) < 1e-9) {
      // Pair with next real root if any, else self-pair (shouldn't happen for
      // even-order Butterworth).
      const idx = remaining.findIndex((x) => Math.abs(x.im) < 1e-9);
      if (idx >= 0) {
        const r2 = remaining.splice(idx, 1)[0];
        pairs.push([C(r.re, 0), C(r2.re, 0)]);
      } else {
        pairs.push([C(r.re, 0), C(1, 0)]);
      }
    } else {
      // Find nearest conjugate.
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const c = remaining[i];
        const d = Math.hypot(c.re - r.re, c.im + r.im);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const r2 = remaining.splice(bestIdx, 1)[0];
        pairs.push([r, r2]);
      } else {
        // No partner found — pair with own conjugate.
        pairs.push([r, C(r.re, -r.im)]);
      }
    }
  }
  return pairs;
}

// Steady-state initial conditions of the cascade for a unit step (scipy.signal.sosfilt_zi): per section the
// lfilter_zi of the biquad, scaled by the DC gain of the sections before it.
function sosfiltZi(sos: Biquad[]): { z1: number; z2: number }[] {
  let scale = 1;
  return sos.map((s) => {
    // (I - companion(a).T) zi = b[1:] - a[1:] * b0  ->  [[1 + a1, -1], [a2, 1]] zi = [b1 - a1 b0, b2 - a2 b0]
    const r1 = s.b1 - s.a1 * s.b0;
    const r2 = s.b2 - s.a2 * s.b0;
    const z1 = (r1 + r2) / (1 + s.a1 + s.a2);
    const z2 = r2 - s.a2 * z1;
    const zi = { z1: scale * z1, z2: scale * z2 };
    scale *= (s.b0 + s.b1 + s.b2) / (1 + s.a1 + s.a2);
    return zi;
  });
}

// Transposed Direct Form II cascade in float64 with an optional initial state (scipy.signal.sosfilt).
function sosfilt64(
  x: Float64Array,
  sos: Biquad[],
  init?: { z1: number; z2: number }[],
): Float64Array {
  const y = new Float64Array(x.length);
  const state = sos.map((_, i) => (init ? { ...init[i] } : { z1: 0, z2: 0 }));
  for (let n = 0; n < x.length; n++) {
    let v = x[n];
    for (let i = 0; i < sos.length; i++) {
      const s = sos[i];
      const st = state[i];
      const out = s.b0 * v + st.z1;
      st.z1 = s.b1 * v - s.a1 * out + st.z2;
      st.z2 = s.b2 * v - s.a2 * out;
      v = out;
    }
    y[n] = v;
  }
  return y;
}

function sosfilt(x: Float32Array, sos: Biquad[]): Float32Array {
  const y = new Float32Array(x.length);
  const state = sos.map(() => ({ z1: 0, z2: 0 }));
  for (let n = 0; n < x.length; n++) {
    let v = x[n];
    for (let i = 0; i < sos.length; i++) {
      const s = sos[i];
      const st = state[i];
      // Transposed Direct Form II
      const out = s.b0 * v + st.z1;
      st.z1 = s.b1 * v - s.a1 * out + st.z2;
      st.z2 = s.b2 * v - s.a2 * out;
      v = out;
    }
    y[n] = v;
  }
  return y;
}

function reverse(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[x.length - 1 - i];
  return out;
}

export function sosfiltfilt(x: Float32Array, sos: Biquad[]): Float32Array {
  // Same as scipy.signal.sosfiltfilt (defaults), which the training pipeline used: odd extension of padlen
  // samples at both ends, steady-state initial conditions scaled by the first sample of each pass, float64.
  // (The earlier plain forward-backward pass changed the model probability by up to 0.07 on its own.)
  const nZeroB2 = sos.filter((s) => s.b2 === 0).length;
  const nZeroA2 = sos.filter((s) => s.a2 === 0).length;
  const padlen = 3 * (2 * sos.length + 1 - Math.min(nZeroB2, nZeroA2));
  const n = x.length;
  if (n <= padlen) {
    // too short for scipy's default padding: plain forward-backward pass
    return reverse(sosfilt(reverse(sosfilt(x, sos)), sos));
  }
  const ext = new Float64Array(n + 2 * padlen);
  for (let i = 0; i < padlen; i++) ext[i] = 2 * x[0] - x[padlen - i];
  for (let i = 0; i < n; i++) ext[padlen + i] = x[i];
  for (let i = 0; i < padlen; i++) ext[padlen + n + i] = 2 * x[n - 1] - x[n - 2 - i];

  const zi = sosfiltZi(sos);
  const scaled = (v: number) => zi.map((z) => ({ z1: z.z1 * v, z2: z.z2 * v }));
  const fwd = sosfilt64(ext, sos, scaled(ext[0]));
  const rev = fwd.slice().reverse();
  const back = sosfilt64(rev, sos, scaled(rev[0])).reverse();

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = back[padlen + i];
  return out;
}

let cachedSOS: { key: string; sos: Biquad[] } | null = null;

export function bandpass(
  x: Float32Array,
  lowHz: number,
  highHz: number,
  fs: number,
  order = 4,
): Float32Array {
  const key = `${order}|${lowHz}|${highHz}|${fs}`;
  if (!cachedSOS || cachedSOS.key !== key) {
    cachedSOS = { key, sos: butterBandpassSOS(order, lowHz, highHz, fs) };
  }
  return sosfiltfilt(x, cachedSOS.sos);
}
