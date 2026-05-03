/**
 * mirrors the course code hw1-4 in js
 *
 * Pipeline:
 * - image decode (Canvas API)
 * - feature extraction (brightness, hue, saturation per column-slice)
 * - mid-tread quantization -hw1
 * - fourier / harmonic synthesis -hw2
 * - sinc-based FIR filtering  -hw4?
 * - pcm output buffer
 */

'use strict';

//constants
const FS = 44100;           //sampling rate (sample/sec)
const F_MIN = 200;           //min fund freq -hz
const F_MAX = 2000;          // min fund freq -hz

/**
 * mid-trad quantizer
 * @param {Float32Array} signal
 * @param {number} numLevels
 * @returns {Float32Array}
 */
function midTreadQuantize(signal, numLevels) {
  const xMin = Math.min(...signal);
  const xMax = Math.max(...signal);
  const delta = (xMax - xMin) / numLevels;
  if (delta === 0) return signal.slice();
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    out[i] = delta * Math.round(signal[i] / delta);
  }
  return out;
}

function levelToAmplitude(levelDB) {
  return Math.pow(10, levelDB / 20);
}

//fourier/harmonic synthesis
/**
 *synthesize segment from harmonic phasors
 *
 * @param {number[]} amplitudes  -per-harmonic amplitudes
 * @param {number[]} phases      -per-harmonic phases (radians)
 * @param {number}   F0          -fundamental frequency (Hz)
 * @param {number}   numSamples  -output length
 * @returns {Float32Array}
 */
function synthesizeSegment(amplitudes, phases, F0, numSamples) {
  const out = new Float32Array(numSamples);
  const dt = 1 / FS;
  for (let k = 0; k < amplitudes.length; k++) {
    const A = amplitudes[k];
    const phi = phases[k];
    const freq = (k + 1) * F0;
    if (freq > FS / 2) break;
    for (let n = 0; n < numSamples; n++) {
      out[n] += A * Math.cos(2 * Math.PI * freq * n * dt + phi);
    }
  }
  return out;
}

//filter design
/**
 * low pass filter
 * @param {number} omegaC -cutoff in radians/sample
 * @param {number} lenH   -filter length
 * @returns {Float64Array}
 */
function getHnLP(omegaC, lenH) {
  const h = new Float64Array(lenH);
  const middle = Math.floor(lenH / 2);
  for (let n = 0; n < lenH; n++) {
    const nShifted = n - middle;
    if (nShifted === 0) {
      h[n] = omegaC / Math.PI;
    } else {
      h[n] = (omegaC / Math.PI) * sinc((omegaC / Math.PI) * nShifted);
    }
  }
  return h;
}

/**
 *high pass filter
 */
function getHnHP(omegaC, lenH) {
  const hLp = getHnLP(omegaC, lenH);
  const hHp = new Float64Array(lenH);
  const middle = Math.floor(lenH / 2);
  for (let n = 0; n < lenH; n++) {
    hHp[n] = (n === middle ? 1 : 0) - hLp[n];
  }
  return hHp;
}

/**
 *band pass filter
 */
function getHnBP(omegaC1, omegaC2, lenH) {
  const hLp1 = getHnLP(omegaC1, lenH);
  const hLp2 = getHnLP(omegaC2, lenH);
  const hBp = new Float64Array(lenH);
  for (let n = 0; n < lenH; n++) {
    hBp[n] = hLp2[n] - hLp1[n];
  }
  return hBp;
}

/**norm sync */
function sinc(x) {
  if (Math.abs(x) < 1e-10) return 1;
  return Math.sin(Math.PI * x) / (Math.PI * x);
}

/**
 *linear convolution using fft
 */
function convolve(signal, kernel) {
  const N = signal.length;
  const M = kernel.length;
  const outLen = N + M - 1;

  const fftLen = nextPow2(outLen);

  const sigPad = new Float64Array(fftLen);
  const kerPad = new Float64Array(fftLen);
  for (let i = 0; i < N; i++) sigPad[i] = signal[i];
  for (let i = 0; i < M; i++) kerPad[i] = kernel[i];

  const SIG = fft(sigPad);
  const KER = fft(kerPad);

  const PROD = new Array(fftLen);
  for (let i = 0; i < fftLen; i++) {
    PROD[i] = cMul(SIG[i], KER[i]);
  }

  const result = ifft(PROD);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = result[i].re;
  return out;
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

//https://en.wikipedia.org/wiki/Cooley%E2%80%93Tukey_FFT_algorithm
//this was taken from an old stack page and updated using Claude's AI
function fft(x) {
  const N = x.length;
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = { re: x[i] || 0, im: 0 };
  fftInPlace(out);
  return out;
}
function ifft(X) {
  const N = X.length;
  //conjugate -> FFT -> conjugate -> /N
  const conj = X.map(c => ({ re: c.re, im: -c.im }));
  fftInPlace(conj);
  return conj.map(c => ({ re: c.re / N, im: -c.im / N }));
}
function fftInPlace(x) {
  const N = x.length;
  if (N <= 1) return;
  //bit reversal
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = x[i]; x[i] = x[j]; x[j] = t; }
  }
  //this was taken from an old stack page and updated using Claude's AI
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let uRe = 1, uIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const even = x[i + k];
        const odd  = x[i + k + len / 2];
        const tRe = uRe * odd.re - uIm * odd.im;
        const tIm = uRe * odd.im + uIm * odd.re;
        x[i + k]           = { re: even.re + tRe, im: even.im + tIm };
        x[i + k + len / 2] = { re: even.re - tRe, im: even.im - tIm };
        const newURe = uRe * wRe - uIm * wIm;
        uIm = uRe * wIm + uIm * wRe;
        uRe = newURe;
      }
    }
  }
}
function cMul(a, b) {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

//image feature extraction
/**
 * extract features from the image data object
 * return the arrays of length = image width
 * features per column (averaged over the rows)
 * brightness  [0,1]  - luminance
 * hue         [0,1]  - dominant hue
 * saturation  [0,1]  - color saturation
 */
function extractFeatures(imageData) {
  const { data, width, height } = imageData;
  const brightness  = new Float32Array(width);
  const hue         = new Float32Array(width);
  const saturation  = new Float32Array(width);

  for (let col = 0; col < width; col++) {
    let sumL = 0, sumH = 0, sumS = 0;
    for (let row = 0; row < height; row++) {
      const idx = (row * width + col) * 4;
      const r = data[idx]     / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;

      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      sumL += L;

      const cMax = Math.max(r, g, b);
      const cMin = Math.min(r, g, b);
      const delta = cMax - cMin;

      let H = 0;
      if (delta > 0.001) {
        if (cMax === r)      H = ((g - b) / delta) % 6;
        else if (cMax === g) H = (b - r) / delta + 2;
        else                 H = (r - g) / delta + 4;
        H = ((H / 6) + 1) % 1;
      }
      sumH += H;

      const sl = (L > 0.5)
        ? delta / (2 - cMax - cMin + 1e-9)
        : delta / (cMax + cMin + 1e-9);
      sumS += sl;
    }
    brightness[col]  = sumL / height;
    hue[col]         = sumH / height;
    saturation[col]  = sumS / height;
  }
  return { brightness, hue, saturation };
}

//sonification function
//used AI to tighten generation time and provide better design quality
/**
 * convert features -> PCM audio buffer.
 *
 * @param {ImageData} imageData
 * @param {object}    opts
 *  -duration: total seconds
 *  -quantLevels: mid-tread quantization levels
 *  -maxHarmonics: max harmonics allowed
 *  -filterType: 'none'|'lowpass'|'highpass'|'bandpass'
 *  -baseline: 'none'|'amplitude'|'random'|'fixed'
 *  -onProgress: callback(fraction)
 * @returns {Float32Array} PCM samples at FS
 */
function sonify(imageData, opts = {}) {
  const {
    duration     = 3,
    quantLevels  = 32,
    maxHarmonics = 6,
    filterType   = 'none',
    baseline     = 'none',
    onProgress   = () => {},
  } = opts;

  const totalSamples = Math.round(FS * duration);
  const output = new Float32Array(totalSamples);

  const { width, height } = imageData;
  const samplesPerCol = Math.ceil(totalSamples / width);

  const { brightness, hue, saturation } = extractFeatures(imageData);

  //quantize the brightness
  const qBrightness = midTreadQuantize(brightness, quantLevels);

  for (let col = 0; col < width; col++) {
    onProgress(col / width);

    const startSample = Math.round((col / width) * totalSamples);
    const endSample   = Math.min(Math.round(((col + 1) / width) * totalSamples), totalSamples);
    const n = endSample - startSample;
    if (n <= 0) continue;

    let segment;

    //baselines
    if (baseline === 'amplitude') {
      //single sine, amplitude = brightness only
      const amp = qBrightness[col];
      const F0  = 440;
      segment = synthesizeSegment([amp], [0], F0, n);

    } else if (baseline === 'random') {
      //random tones
      const amp = 0.3 + Math.random() * 0.4;
      const F0  = 200 + Math.random() * 1800;
      segment = synthesizeSegment([amp, amp * 0.5], [0, Math.random()], F0, n);

    } else if (baseline === 'fixed') {
      //fixed violin-C harmonic series
      const levels = [50.2, 23.8, 55.6, 40.1, 32.1, 50.4, 38.3, 49.9, 41.1, 45.0];
      const amps = levels.slice(0, maxHarmonics).map(l => levelToAmplitude(l) * 0.001);
      const phases = amps.map(() => 0);
      const F0 = 261.63;
      segment = synthesizeSegment(amps, phases, F0, n);

    } else {
      const amp  = qBrightness[col];

      //frequency from vertical center of mass
      //(col maps to time, within col, use brightness already averaged)
      //F0 is log-scaled between F_MIN and F_MAX based on brightness
      //(brighter -> higher frequency feels more natural for image sonification)
      const F0 = F_MIN * Math.pow(F_MAX / F_MIN, 1 - brightness[col]);

      // Number of harmonics from saturation
      const nHarm = Math.max(1, Math.round(saturation[col] * maxHarmonics));

      //harmonic amplitudes from hue:
      //hue in [0,0.17] = red  -> amplify odd harmonics
      //hue in [0.30,0.45] = green -> boost all evenly
      //hue in [0.60,0.75] = blue -> amplify even harmonics
      const amplitudes = [];
      const phases     = [];
      for (let k = 0; k < nHarm; k++) {
        const harmIdx = k + 1;
        let hScale = 1.0;
        const h = hue[col];
        if (harmIdx % 2 === 1) {
          //odd harmonic: boosted by red hue
          hScale = 0.5 + Math.abs(Math.cos(h * Math.PI * 2)) * 0.5;
        } else {
          //even harmonic: boosted by blue hue
          hScale = 0.5 + Math.abs(Math.sin(h * Math.PI * 2)) * 0.5;
        }
        //amplitude falls off as 1/k (natural spectral rolloff), scaled by brightness
        amplitudes.push(amp * hScale / harmIdx);
        phases.push(0);
      }

      segment = synthesizeSegment(amplitudes, phases, F0, n);
    }

    //(prevents clicks)
    applyHannEnvelope(segment, Math.min(32, Math.floor(n / 4)));

    //output
    for (let i = 0; i < n; i++) {
      output[startSample + i] += segment[i];
    }
  }

  onProgress(0.95);

  normalize(output);

  //filtering :)
  if (filterType !== 'none') {
    const lenH = 1025;
    let kernel;
    if (filterType === 'lowpass') {
      const omegaC = 2 * Math.PI * 1200 / FS;
      kernel = getHnLP(omegaC, lenH);
    } else if (filterType === 'highpass') {
      const omegaC = 2 * Math.PI * 800 / FS;
      kernel = getHnHP(omegaC, lenH);
    } else {
      const omegaC1 = 2 * Math.PI * 400 / FS;
      const omegaC2 = 2 * Math.PI * 2400 / FS;
      kernel = getHnBP(omegaC1, omegaC2, lenH);
    }
    const filtered = convolve(output, kernel);
    const offset = Math.floor(lenH / 2);
    const final = output;
    for (let i = 0; i < totalSamples; i++) {
      final[i] = filtered[i + offset] || 0;
    }
    normalize(final);
  }

  onProgress(1.0);
  return output;
}

function applyHannEnvelope(buf, fadeLen) {
  const N = buf.length;
  const fade = Math.min(fadeLen, Math.floor(N / 2));
  for (let i = 0; i < fade; i++) {
    const w = 0.5 * (1 - Math.cos(Math.PI * i / fade));
    buf[i]         *= w;
    buf[N - 1 - i] *= w;
  }
}

function normalize(buf) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    if (Math.abs(buf[i]) > peak) peak = Math.abs(buf[i]);
  }
  if (peak > 0.001) {
    const scale = 0.9 / peak;
    for (let i = 0; i < buf.length; i++) buf[i] *= scale;
  }
}

function computeSpectrum(pcm, N = 2048) {
  const slice = new Float64Array(N);
  const step = Math.floor(pcm.length / N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
    slice[i] = (pcm[i * step] || 0) * w;
  }
  const X = fft(slice);
  const mag = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    mag[i] = Math.sqrt(X[i].re * X[i].re + X[i].im * X[i].im);
  }
  return mag;
}

function encodeWAV(samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function generateSampleImageData(type, w = 200, h = 200) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (type === 'gradient') {
    const grd = ctx.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#1a0040');
    grd.addColorStop(0.3, '#c8f542');
    grd.addColorStop(0.6, '#0080ff');
    grd.addColorStop(1, '#ff4080');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);

  } else if (type === 'stripes') {
    for (let x = 0; x < w; x++) {
      const hue = (x / w) * 360;
      ctx.fillStyle = `hsl(${hue}, 80%, ${30 + 40 * Math.abs(Math.sin(x * 0.15))}%)`;
      ctx.fillRect(x, 0, 1, h);
    }

  } else if (type === 'noise') {
    const id = ctx.createImageData(w, h);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = Math.random() * 255;
      const r = Math.random() > 0.6 ? v * 1.2 : v * 0.4;
      const g = Math.random() > 0.5 ? v * 0.8 : v * 0.2;
      const b = Math.random() > 0.4 ? v : v * 0.6;
      id.data[i]   = Math.min(255, r);
      id.data[i+1] = Math.min(255, g);
      id.data[i+2] = Math.min(255, b);
      id.data[i+3] = 255;
    }
    ctx.putImageData(id, 0, 0);

  } else if (type === 'circle') {
    ctx.fillStyle = '#0a0a14'; ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    for (let r = Math.min(w, h) / 2; r > 2; r -= 8) {
      const hue = ((r / (Math.min(w, h) / 2)) * 240);
      const bright = 20 + (1 - r / (Math.min(w, h) / 2)) * 60;
      ctx.strokeStyle = `hsl(${hue}, 80%, ${bright}%)`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
  }

  return ctx.getImageData(0, 0, w, h);
}
window.DSP = {
  sonify,
  computeSpectrum,
  encodeWAV,
  extractFeatures,
  generateSampleImageData,
  FS,
};
