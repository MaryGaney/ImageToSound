/**
 * Each parameter control has a ? button. If you click it, opens a 3-tab modal:
 *   Tab 1 "What it does"  — plain English effect on the sound
 *   Tab 2 "The concept"   — DSP theory explained from scratch
 *   Tab 3 "The math"      — live numbers computed from the current image
 */
'use strict';

const overlay   = document.getElementById('help-overlay');
const modalIcon = document.getElementById('help-icon');
const modalTitle = document.getElementById('help-title');
const closeBtn  = document.getElementById('help-close');
const tabs      = document.querySelectorAll('.help-tab');
const paneWhat    = document.getElementById('pane-what');
const paneConcept = document.getElementById('pane-concept');
const paneMath    = document.getElementById('pane-math');

const p  = (html) => `<p>${html}</p>`;
const strong = (t) => `<strong>${t}</strong>`;
const em = (t) => `<em>${t}</em>`;

function formula(...lines) {
  return `<div class="help-formula">${lines.map(l =>
    l.startsWith('//') ? `<span class="comment">${l}</span>` : l
  ).join('<br>')}</div>`;
}

function liveBox(label, html) {
  return `<div class="help-live-box">
    <div class="live-label">${label}</div>
    <div class="live-value">${html}</div>
  </div>`;
}

function steps(...items) {
  return items.map((item, i) => `
    <div class="help-step">
      <div class="help-step-num">${i + 1}</div>
      <div class="help-step-text">${item}</div>
    </div>`).join('');
}

function compare(a, b) {
  return `<div class="help-compare">
    <div class="help-compare-cell"><div class="cc-label">${a[0]}</div><div class="cc-val">${a[1]}</div></div>
    <div class="help-compare-cell"><div class="cc-label">${b[0]}</div><div class="cc-val">${b[1]}</div></div>
  </div>`;
}

function num(n, decimals = 4) {
  if (typeof n !== 'number' || isNaN(n)) return '<span class="dim">—</span>';
  return `<span class="num">${n.toFixed(decimals)}</span>`;
}

function vec(arr, maxShow = 8, decimals = 4) {
  if (!arr || arr.length === 0) return '<span class="dim">[ empty ]</span>';
  const shown = Array.from(arr).slice(0, maxShow);
  const more = arr.length > maxShow ? `<span class="dim"> … +${arr.length - maxShow} more</span>` : '';
  return `[ ${shown.map(v => num(v, decimals)).join(', ')} ]${more}`;
}

const noImageNote = `<div class="no-image-note">
  Load an image or sample first to see live values computed from your actual image.
</div>`;

function getLiveData() {
  const hasImage = !!(window.currentImageData);
  const dur    = parseInt(document.getElementById('dur').value);
  const quant  = parseInt(document.getElementById('quant').value);
  const harm   = parseInt(document.getElementById('harm').value);
  const filter = document.getElementById('filter-type').value;
  const base   = document.getElementById('baseline').value;

  let features = null;
  if (hasImage) {
    features = DSP.extractFeatures(window.currentImageData);
  }

  return { hasImage, dur, quant, harm, filter, base, features,
           imgData: window.currentImageData };
}

//icons and wording help assisted by Claude AI
const HELP = {

  duration: {
    icon: '⏱',
    title: 'Duration',
    what: () => [
      p(`${strong('Duration')} controls the total length of the synthesized audio clip, from 1 to 8 seconds.`),
      p(`The image is always scanned left-to-right regardless of duration. A ${em('longer duration')} means each column of the image gets more time — each "note" is held longer, and you hear more detail in individual tones. A ${em('shorter duration')} rushes through the image quickly, creating a faster, more compressed sound.`),
      p(`Think of it like the speed at which a piano roll scrolls past the hammers. The same notes are played either way — slow scrolling means each note rings out longer; fast scrolling creates a rapid flurry.`),
      compare(
        ['Short (1–2 s)', 'Rapid, dense, texture-like'],
        ['Long (6–8 s)', 'Slow, sustained, melodic']
      ),
    ].join(''),

    concept: () => [
      p(`The image has a fixed number of columns (its pixel width). The synthesis engine assigns each column an equal slice of the total audio duration.`),
      p(`If the image is ${strong('W columns wide')} and the total duration is ${strong('D seconds')}, each column produces exactly ${strong('D/W seconds')} of audio — which at a sample rate of Fs = 44,100 Hz means ${strong('⌊Fs × D/W⌋ samples')} per column.`),
      formula(
        '// Samples assigned to each column:',
        'samplesPerCol = floor(Fs × duration / imageWidth)',
        '',
        '// Column col starts at sample:',
        'startSample = round((col / width) × totalSamples)',
      ),
      p(`This is a form of ${em('time-domain segmentation')}: the full output buffer is divided into W non-overlapping segments, and each segment is synthesized independently using that column's pixel features.`),
    ].join(''),

    math: () => {
      const { hasImage, dur, imgData } = getLiveData();
      const Fs = DSP.FS;
      const totalSamples = Math.round(Fs * dur);

      if (!hasImage) return noImageNote + formula(
        `Fs = ${Fs} samples/sec`,
        `duration (current) = ${dur} s`,
        `totalSamples = ${Fs} × ${dur} = ${totalSamples.toLocaleString()}`,
      );

      const W = imgData.width;
      const samplesPerCol = totalSamples / W;
      const secPerCol = dur / W;

      return [
        liveBox('Current image dimensions', `
          <span class="num">${W}</span> columns × 
          <span class="num">${imgData.height}</span> rows
        `),
        formula(
          `Fs = ${Fs.toLocaleString()} Hz`,
          `Duration = ${dur} s`,
          `Total samples = ${Fs.toLocaleString()} × ${dur} = ${totalSamples.toLocaleString()}`,
          ``,
          `Image width = ${W} columns`,
          `Samples per column = ${totalSamples.toLocaleString()} / ${W} = ${num(samplesPerCol, 1)}`,
          `Time per column = ${dur} / ${W} = ${num(secPerCol, 4)} s = ${num(secPerCol * 1000, 2)} ms`,
        ),
        p(`Each column gets <strong>${num(secPerCol * 1000, 2)} milliseconds</strong> of audio. ${secPerCol < 0.01 ? 'Very short — the image is wide, so notes change rapidly.' : secPerCol > 0.1 ? 'Fairly long — you\'ll hear sustained tones for each column.' : 'A comfortable note length.'}`),
      ].join('');
    },
  },

  quantization: {
    icon: '▦',
    title: 'Quantization Levels',
    what: () => [
      p(`${strong('Quantization')} controls the amplitude resolution — how precisely the brightness of each image column can be represented as a volume level.`),
      p(`${em('Fewer levels')} (e.g. 4) means volume can only take one of 4 coarse steps. You hear the amplitude jump abruptly between notes — a crunchy, lo-fi, almost robotic sound. This is intentional bit-crushing.`),
      p(`${em('More levels')} (e.g. 128) means volume changes are so fine-grained they're imperceptible. The amplitude transitions sound smooth and natural.`),
      p(`Drag the slider while listening and you can hear the quantization artifacts appear and disappear in real time after re-synthesizing.`),
      compare(
        ['4 levels', 'Lo-fi, stepped, crunchy'],
        ['128 levels', 'Smooth, natural amplitude']
      ),
    ].join(''),

    concept: () => [
      p(`Quantization is the process of rounding continuous values to the nearest allowed discrete level. It comes directly from ${strong('HW01')} (Sampling & Quantization).`),
      p(`We use a ${em('mid-tread quantizer')}: the allowed levels are symmetric around zero, and zero is itself one of the levels. The gap between adjacent levels is called ${strong('Δ (delta)')}. Every input value is divided by Δ, rounded to the nearest integer, then multiplied back by Δ.`),
      formula(
        '// Step 1: compute step size',
        'Δ = (x_max - x_min) / numLevels',
        '',
        '// Step 2: quantize each brightness value',
        'x_q[n] = Δ × round(x[n] / Δ)',
        '',
        '// Quantization error per sample:',
        'e[n] = x[n] - x_q[n]',
        '',
        '// RMS error (from HW01):',
        'RMS = sqrt( mean(e[n]²) )',
      ),
      p(`The RMS error shrinks as levels increase. For a sinusoidal input, the theoretical RMS error is approximately ${strong('Δ / √12')} — this is the formula from HW01 that predicted quantization noise before computing it directly.`),
    ].join(''),

    math: () => {
      const { hasImage, quant, features } = getLiveData();

      if (!hasImage) return noImageNote + formula(
        `numLevels (current) = ${quant}`,
        `Δ = (x_max - x_min) / ${quant}`,
      );

      const bright = features.brightness;
      const xMin = Math.min(...bright);
      const xMax = Math.max(...bright);
      const delta = (xMax - xMin) / quant;

      const brightQ = Array.from(bright).map(v => delta * Math.round(v / delta));
      const errors  = Array.from(bright).map((v, i) => v - brightQ[i]);
      const rms     = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
      const theoretical = delta / Math.sqrt(12);

      const sampleIdx = [0, Math.floor(bright.length/7), Math.floor(2*bright.length/7),
        Math.floor(3*bright.length/7), Math.floor(4*bright.length/7),
        Math.floor(5*bright.length/7), Math.floor(6*bright.length/7), bright.length - 1];

      return [
        liveBox('Brightness array (raw, first 8 columns)', vec(bright, 8, 4)),
        formula(
          `numLevels = ${quant}`,
          `x_min = ${num(xMin)}   x_max = ${num(xMax)}`,
          `Δ = (${num(xMax)} - ${num(xMin)}) / ${quant} = ${num(delta)}`,
        ),
        liveBox('After quantization (same 8 columns)', vec(brightQ, 8, 4)),
        liveBox('Quantization error e[n] = x[n] - x_q[n]', vec(errors, 8, 5)),
        formula(
          `Actual RMS error   = ${num(rms, 6)}`,
          `Theoretical Δ/√12 = ${num(theoretical, 6)}`,
          `// These should be close — confirms HW01 formula holds`,
        ),
      ].join('');
    },
  },

  harmonics: {
    icon: '∿',
    title: 'Max Harmonics',
    what: () => [
      p(`${strong('Max harmonics')} sets the maximum number of sine wave layers that can be stacked to build each sound.`),
      p(`At ${em('1 harmonic')}, every note is a pure sine wave — simple, flute-like, almost electronic. There's only one frequency per column.`),
      p(`At ${em('12 harmonics')}, each note can contain up to 12 layered sine waves at integer multiples of the base frequency. This creates a richer, more complex timbre — closer to a real instrument or a full chord.`),
      p(`The actual number of harmonics used per column is also controlled by that column's ${em('saturation')}: a fully grey column always uses just 1 harmonic regardless of this setting. This slider sets the ceiling.`),
      compare(
        ['1 harmonic', 'Pure tone, flute-like'],
        ['12 harmonics', 'Rich, organ or string-like']
      ),
    ].join(''),

    concept: () => [
      p(`This is the core of ${strong('Fourier synthesis from HW03')}. Any periodic sound can be built by summing sine waves at integer multiples of a fundamental frequency F₀:`),
      formula(
        'x(t) = Σ  A_k · cos(2π · k · F₀ · t  +  φ_k)',
        '       k=1 to K',
        '',
        '// k = harmonic index (1, 2, 3, ...)',
        '// A_k = amplitude of the k-th harmonic',
        '// F₀ = fundamental frequency (Hz)',
        '// φ_k = phase of the k-th harmonic (radians)',
      ),
      p(`In HW03, you synthesized a violin middle C using ${strong('K = 10 harmonics')} with specific amplitudes in dB. Here, instead of fixed violin amplitudes, the amplitudes come from the image's color channels.`),
      p(`The amplitude of each harmonic falls off as ${em('A_k ∝ 1/k')} — a natural spectral rolloff that prevents the high harmonics from sounding harsh. Then hue adjusts whether odd or even harmonics are boosted above this baseline.`),
    ].join(''),

    math: () => {
      const { hasImage, harm, features } = getLiveData();
      const F_MIN = 200, F_MAX = 2000;

      if (!hasImage) return noImageNote + formula(
        `K (max harmonics, current) = ${harm}`,
        `For column with brightness b and hue h:`,
        `  F₀ = 200 × (2000/200)^(1 - b)  Hz`,
        `  A_k = amplitude × hScale_k / k`,
      );

      const bright = features.brightness;
      const hue    = features.hue;
      const sat    = features.saturation;

      const col = Math.floor(bright.length / 2);
      const b = bright[col], h = hue[col], s = sat[col];
      const F0 = F_MIN * Math.pow(F_MAX / F_MIN, 1 - b);
      const nHarm = Math.max(1, Math.round(s * harm));

      const amps = [];
      for (let k = 0; k < nHarm; k++) {
        const harmIdx = k + 1;
        let hScale;
        if (harmIdx % 2 === 1) {
          hScale = 0.5 + Math.abs(Math.cos(h * Math.PI * 2)) * 0.5;
        } else {
          hScale = 0.5 + Math.abs(Math.sin(h * Math.PI * 2)) * 0.5;
        }
        amps.push(b * hScale / harmIdx);
      }

      const freqs = amps.map((_, k) => F0 * (k + 1));

      return [
        liveBox(`Representative column: col ${col} of ${bright.length}`, `
          Brightness b = ${num(b)}<br>
          Hue h = ${num(h)}<br>
          Saturation s = ${num(s)}
        `),
        formula(
          `F₀ = 200 × (2000/200)^(1 - ${num(b)})`,
          `   = 200 × 10^(${num(1-b)})`,
          `   = ${num(F0, 1)} Hz`,
          ``,
          `nHarm = max(1, round(${num(s)} × ${harm})) = ${nHarm}`,
        ),
        liveBox(`Harmonic frequencies  [k×F₀]  Hz`, vec(freqs, 8, 1)),
        liveBox(`Harmonic amplitudes   [A_k]`, vec(amps, 8, 5)),
        p(`The signal for this column is:<br><code style="font-size:11px;color:var(--accent)">x(t) = ${amps.map((a, k) => `${num(a,3)}·cos(2π·${num(freqs[k],0)}·t)`).join(' + ')}</code>`),
      ].join('');
    },
  },

  filter: {
    icon: '⌂',
    title: 'FIR Filter',
    what: () => [
      p(`The ${strong('filter')} shapes the frequency content of the entire synthesized audio after all the harmonics are generated.`),
      p(`${em('None')}: all frequencies pass through unchanged.`),
      p(`${em('Low-pass')}: only frequencies below ~1200 Hz survive. The sound becomes muffled, warm, and bass-heavy — like hearing music through a wall.`),
      p(`${em('High-pass')}: only frequencies above ~800 Hz survive. The sound becomes thin, bright, and tinny — like a telephone or old radio.`),
      p(`${em('Band-pass')}: only frequencies between ~400 and ~2400 Hz survive. The sound narrows to a mid-range "honk" — like audio through a walkie-talkie.`),
      compare(
        ['Low-pass', 'Warm, muffled, bass-heavy'],
        ['High-pass', 'Thin, bright, tinny']
      ),
    ].join(''),

    concept: () => [
      p(`This is ${strong('HW04 (Ideal Filters)')} directly. A Finite Impulse Response (FIR) filter is designed by specifying its impulse response h[n] — what the filter outputs when you give it a single spike as input.`),
      p(`The ideal low-pass filter in the ${em('frequency domain')} is a perfect rectangle: 1 below the cutoff, 0 above. In the ${em('time domain')}, this rectangle transforms into a sinc function:`),
      formula(
        '// Low-pass FIR kernel (from HW04 get_hn_lp):',
        'h_LP[n] = (ωc/π) · sinc((ωc/π) · (n - M/2))',
        '',
        '// where sinc(x) = sin(πx) / (πx)',
        '// ωc = cutoff frequency in radians/sample',
        '// M = filter length (1025 taps)',
        '',
        '// High-pass = delta minus low-pass:',
        'h_HP[n] = δ[n - M/2]  -  h_LP[n]',
        '',
        '// Band-pass = two LPs subtracted:',
        'h_BP[n] = h_LP2[n]  -  h_LP1[n]',
        '',
        '// Applied via convolution:',
        'y[n] = Σ x[k] · h[n-k]  (full linear convolution)',
      ),
      p(`The filter is applied by convolving the full audio output with the kernel using the FFT-based method. The kernel has ${strong('1,025 taps')} — long enough for a sharp transition between passband and stopband.`),
    ].join(''),

    math: () => {
      const { filter } = getLiveData();
      const Fs = DSP.FS;
      const lenH = 1025;
      const middle = Math.floor(lenH / 2);

      const configs = {
        none:      { label: 'No filter selected', f1: null, f2: null },
        lowpass:   { label: 'Low-pass', f1: 1200, f2: null },
        highpass:  { label: 'High-pass', f1: 800, f2: null },
        bandpass:  { label: 'Band-pass', f1: 400, f2: 2400 },
      };
      const cfg = configs[filter] || configs.none;

      if (filter === 'none') {
        return `<p style="color:var(--muted);font-size:12px;">No filter is currently selected. Choose Low-pass, High-pass, or Band-pass to see the kernel math.</p>`;
      }

      const toOmega = (hz) => (2 * Math.PI * hz / Fs);
      const sinc = (x) => Math.abs(x) < 1e-10 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);

      const showIdx = [0, 1, 2, 3, middle - 1, middle, middle + 1, middle + 2];

      let kernelVals;
      if (filter === 'lowpass') {
        const omegaC = toOmega(cfg.f1);
        kernelVals = showIdx.map(n => {
          const ns = n - middle;
          return ns === 0 ? omegaC / Math.PI : (omegaC / Math.PI) * sinc((omegaC / Math.PI) * ns);
        });
      } else if (filter === 'highpass') {
        const omegaC = toOmega(cfg.f1);
        kernelVals = showIdx.map(n => {
          const ns = n - middle;
          const lp = ns === 0 ? omegaC / Math.PI : (omegaC / Math.PI) * sinc((omegaC / Math.PI) * ns);
          return (n === middle ? 1 : 0) - lp;
        });
      } else {
        const omegaC1 = toOmega(cfg.f1);
        const omegaC2 = toOmega(cfg.f2);
        kernelVals = showIdx.map(n => {
          const ns = n - middle;
          const lp1 = ns === 0 ? omegaC1/Math.PI : (omegaC1/Math.PI)*sinc((omegaC1/Math.PI)*ns);
          const lp2 = ns === 0 ? omegaC2/Math.PI : (omegaC2/Math.PI)*sinc((omegaC2/Math.PI)*ns);
          return lp2 - lp1;
        });
      }

      const omega1 = cfg.f1 ? toOmega(cfg.f1) : null;
      const omega2 = cfg.f2 ? toOmega(cfg.f2) : null;

      return [
        liveBox(`Active filter: ${cfg.label}`, `
          Filter length M = <span class="num">${lenH}</span> taps<br>
          Center tap at n = <span class="num">${middle}</span>
          ${omega1 ? `<br>ωc = 2π × ${cfg.f1} / ${Fs.toLocaleString()} = <span class="num">${omega1.toFixed(6)}</span> rad/sample` : ''}
          ${omega2 ? `<br>ωc₂ = 2π × ${cfg.f2} / ${Fs.toLocaleString()} = <span class="num">${omega2.toFixed(6)}</span> rad/sample` : ''}
        `),
        formula(
          filter === 'lowpass'  ? `h_LP[n] = (ωc/π) · sinc((ωc/π) · (n - ${middle}))` :
          filter === 'highpass' ? `h_HP[n] = δ[n - ${middle}]  -  h_LP[n]` :
                                  `h_BP[n] = h_LP(ωc₂)[n]  -  h_LP(ωc₁)[n]`,
          ``,
          `// Indices shown: [${showIdx.join(', ')}]`,
        ),
        liveBox(`h[n] at selected indices`, vec(kernelVals, 8, 6)),
        p(`h[${middle}] = <span class="num" style="color:var(--accent)">${num(kernelVals[showIdx.indexOf(middle)], 6)}</span> — this is the center (peak) of the kernel. Values taper toward zero at the edges.`),
        formula(
          `Convolution output: y[n] = Σ x[k] · h[n-k]`,
          `// Computed via FFT for speed (HW02 method)`,
          `// Output length = audio length + ${lenH} - 1`,
          `// Trimmed back to original audio length`,
        ),
      ].join('');
    },
  },

  baseline: {
    icon: '≡',
    title: 'Baseline Comparison',
    what: () => [
      p(`${strong('Baselines')} let you hear deliberately simplified versions of the system to understand what each mapping contributes to the sound.`),
      p(`${em('Full system')} (default): all features active — brightness, hue, saturation, frequency, harmonics.`),
      p(`${em('B1 – Brightness only')}: a single sine wave whose volume follows brightness. No pitch variation, no harmonics, no color information. Everything sounds like the same flat tone at different volumes.`),
      p(`${em('B2 – Random tones')}: frequencies and amplitudes are chosen randomly with no connection to the image. Press synthesize multiple times — you'll get a different sound each time. This demonstrates that the structure in the full system comes from the image, not coincidence.`),
      p(`${em('B3 – Fixed harmonics')}: the exact violin middle-C harmonic series from HW03 is applied to every column, regardless of the image's color. Same timbre everywhere, only the timing/scanning changes.`),
    ].join(''),

    concept: () => [
      p(`Baselines are a standard evaluation technique in DSP and machine learning research. By comparing a full system to simplified versions that isolate one variable at a time, we can determine which components are actually contributing to the output.`),
      p(`${strong('B1')} isolates the amplitude mapping: amplitude = brightness. All other mappings are disabled.`),
      formula(
        '// B1: single sine at fixed 440 Hz',
        'x(t) = brightness[col] × cos(2π × 440 × t)',
      ),
      p(`${strong('B2')} is a ${em('random control')} baseline. If the full system sounds structured and B2 sounds chaotic, the structure in the full system must come from the image features — not from the synthesis process itself.`),
      formula(
        '// B2: random frequency and amplitude',
        'F0 = 200 + random() × 1800   // Hz, unrelated to image',
        'amp = 0.3 + random() × 0.4   // unrelated to image',
      ),
      p(`${strong('B3')} uses the fixed violin-C amplitudes from ${strong('HW03')} as a control: levels = [50.2, 23.8, 55.6, 40.1, 32.1, 50.4, 38.3, 49.9, 41.1, 45.0] dB for harmonics 1–10.`),
      formula(
        '// B3: fixed violin harmonic levels (HW03)',
        'levels = [50.2, 23.8, 55.6, 40.1, 32.1, ...]  dB',
        'A_k = 10^(level_k / 20)  × 0.001  (scaled)',
        'F₀ = 261.63 Hz  (middle C, fixed regardless of image)',
      ),
    ].join(''),

    math: () => {
      const { hasImage, base, features } = getLiveData();
      const violinLevels = [50.2, 23.8, 55.6, 40.1, 32.1, 50.4, 38.3, 49.9, 41.1, 45.0];
      const violinAmps   = violinLevels.map(l => Math.pow(10, l / 20) * 0.001);

      const baseLabel = {
        none:      'Full system (all features active)',
        amplitude: 'B1 — Brightness → amplitude only',
        random:    'B2 — Random tones',
        fixed:     'B3 — Fixed harmonics (HW03 violin-C)',
      }[base] || 'Full system';

      return [
        liveBox('Currently selected', baseLabel),

        base === 'none' ? [
          p(`The full system is active. All image features are used. ${!hasImage ? '' : 'Load an image and synthesize to see how each feature maps to sound.'}`),
          !hasImage ? noImageNote : (() => {
            const bright = features.brightness;
            const sat    = features.saturation;
            const hue    = features.hue;
            return [
              liveBox(`Brightness range across image`, `min = ${num(Math.min(...bright))}, max = ${num(Math.max(...bright))}, mean = ${num(bright.reduce((s,v) => s+v, 0)/bright.length)}`),
              liveBox(`Saturation range`, `min = ${num(Math.min(...sat), 3)}, max = ${num(Math.max(...sat), 3)}`),
              liveBox(`Hue range`, `min = ${num(Math.min(...hue), 3)}, max = ${num(Math.max(...hue), 3)}`),
            ].join('');
          })(),
        ].join('') : '',

        base === 'amplitude' ? [
          p(`B1 strips everything down to one mapping: ${strong('amplitude = brightness')}. This is the bare minimum sonification.`),
          formula(
            '// B1 synthesis per column:',
            'F₀ = 440 Hz  (fixed A4, regardless of image)',
            'amp = quantized_brightness[col]',
            'x(t) = amp × cos(2π × 440 × t)',
          ),
          !hasImage ? noImageNote : (() => {
            const bright = features.brightness;
            const quant  = parseInt(document.getElementById('quant').value);
            const xMin = Math.min(...bright), xMax = Math.max(...bright);
            const delta = (xMax - xMin) / quant;
            const brightQ = Array.from(bright).map(v => delta * Math.round(v / delta));
            return liveBox(`B1 amplitudes (quantized brightness, first 8 cols)`, vec(brightQ, 8, 4));
          })(),
        ].join('') : '',

        base === 'random' ? [
          p(`B2 generates random values — pressing Synthesize again will produce a completely different sound.`),
          formula(
            '// B2 synthesis per column:',
            'amp = 0.3 + Math.random() × 0.4',
            'F₀  = 200 + Math.random() × 1800  Hz',
            '',
            '// Note: Math.random() → uniform [0, 1)',
            '// So amp ∈ [0.3, 0.7], F₀ ∈ [200, 2000] Hz',
            '// Neither is correlated with the image',
          ),
          p(`Synthesize with B2 selected, then switch to the full system and synthesize the same image. The difference demonstrates that structure in the full system comes from the image features, not the synthesis machinery.`),
        ].join('') : '',

        base === 'fixed' ? [
          p(`B3 uses the exact violin middle-C harmonic amplitudes from HW03 for every column, regardless of the image.`),
          formula(
            '// Violin middle-C levels from HW03:',
            'levels = [50.2, 23.8, 55.6, 40.1, 32.1,',
            '          50.4, 38.3, 49.9, 41.1, 45.0]  dB',
            '',
            '// Converted to amplitudes: A = 10^(level/20)',
          ),
          liveBox('Violin amplitudes A_k = 10^(level/20) × 0.001', vec(violinAmps, 10, 5)),
          formula(
            'F₀ = 261.63 Hz  (middle C, fixed for all columns)',
            '',
            '// Every column sounds identical in timbre.',
            '// Only the scan timing differs.',
          ),
        ].join('') : '',

      ].join('');
    },
  },

};

let currentHelp = null;

function openHelp(key) {
  const def = HELP[key];
  if (!def) return;
  currentHelp = key;

  modalIcon.textContent = def.icon;
  modalTitle.textContent = def.title;

  paneWhat.innerHTML    = def.what();
  paneConcept.innerHTML = def.concept();
  paneMath.innerHTML    = def.math();


  switchTab('what');

  overlay.hidden = false;
  document.body.style.overflow = 'hidden';


  closeBtn.focus();
}

function closeHelp() {
  overlay.hidden = true;
  document.body.style.overflow = '';
  currentHelp = null;
}

function switchTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  [paneWhat, paneConcept, paneMath].forEach(p => p.classList.remove('active'));
  document.getElementById(`pane-${name}`).classList.add('active');
}

document.querySelectorAll('.help-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openHelp(btn.dataset.help);
  });
});


tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    switchTab(name);
    //rerender the pane (helps if values change)
    if (name === 'math' && currentHelp) {
      paneMath.innerHTML = HELP[currentHelp].math();
    }
  });
});

closeBtn.addEventListener('click', closeHelp);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeHelp(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) closeHelp(); });

//expose currentImageData to window so help.js can read it
//app.js stores it as a local var; we patch loadImageSrc to also write window.currentImageData
const _origLoadSrc = window._patchedLoadSrc;
