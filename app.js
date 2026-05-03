
'use strict';

const uploadZone    = document.getElementById('upload-zone');
const fileInput     = document.getElementById('file-input');
const imgCanvas     = document.getElementById('img-canvas');
const scanCanvas    = document.getElementById('scan-line');
const specCanvas    = document.getElementById('spectrum-canvas');
const waveCanvas    = document.getElementById('waveform-canvas');
const synthBtn      = document.getElementById('synth-btn');
const playBtn       = document.getElementById('play-btn');
const stopBtn       = document.getElementById('stop-btn');
const dlBtn         = document.getElementById('dl-btn');
const playbackRow   = document.getElementById('playback-row');
const progressWrap  = document.getElementById('progress-wrap');
const progressBar   = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const durSlider     = document.getElementById('dur');
const quantSlider   = document.getElementById('quant');
const harmSlider    = document.getElementById('harm');
const filterSel     = document.getElementById('filter-type');
const baselineSel   = document.getElementById('baseline');

let currentImageData = null;
let pcmBuffer        = null;
let audioCtx         = null;
let activeSource     = null;
let wavBlob          = null;

function bindSlider(slider, outId, fmt) {
  const out = document.getElementById(outId);
  function update() { out.textContent = fmt(slider.value); }
  slider.addEventListener('input', update);
  update();
}
bindSlider(durSlider,   'dur-val',   v => `${v} s`);
bindSlider(quantSlider, 'quant-val', v => v);
bindSlider(harmSlider,  'harm-val',  v => v);

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const isImage = file.type.startsWith('image/');
  const ext = file.name.split('.').pop().toLowerCase();
  const isAllowed = isImage || ext === 'heic' || ext === 'heif';
  if (isAllowed) {
    loadImageFile(file);
  } else {
    showUploadError(`"${file.name}" is not a supported image format. Try JPG, PNG, WEBP, or HEIC.`);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadImageFile(fileInput.files[0]);
});

function isHeic(file) {
  if (file.type === 'image/heic' || file.type === 'image/heif') return true;
  const ext = file.name.split('.').pop().toLowerCase();
  return ext === 'heic' || ext === 'heif';
}

function loadImageFile(file) {
  if (isHeic(file)) {
    uploadZone.classList.add('converting');
    heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
      .then(jpegBlob => {
        uploadZone.classList.remove('converting');
        const reader = new FileReader();
        reader.onload = e => loadImageSrc(e.target.result);
        reader.readAsDataURL(jpegBlob);
      })
      .catch(err => {
        uploadZone.classList.remove('converting');
        showUploadError('Could not convert HEIC file. Try exporting as JPG from your Photos app.');
        console.error('heic2any error:', err);
      });
  } else {
    const reader = new FileReader();
    reader.onload = e => loadImageSrc(e.target.result);
    reader.readAsDataURL(file);
  }
}

function showUploadError(msg) {
  const existing = document.getElementById('upload-error');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'upload-error';
  el.style.cssText = 'font-size:11px;color:#f09595;margin-top:6px;padding:6px 8px;background:rgba(240,149,149,0.08);border-radius:4px;border:1px solid rgba(240,149,149,0.2);';
  el.textContent = msg;
  uploadZone.after(el);
  setTimeout(() => el.remove(), 6000);
}

function loadImageSrc(src) {
  const img = new Image();
  img.onload = () => {
    const err = document.getElementById('upload-error');
    if (err) err.remove();
    const ctx = imgCanvas.getContext('2d');
    imgCanvas.width  = img.naturalWidth;
    imgCanvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    currentImageData = ctx.getImageData(0, 0, imgCanvas.width, imgCanvas.height);
    window.currentImageData = currentImageData; 
    uploadZone.classList.add('has-image');
    synthBtn.disabled = false;
    playbackRow.hidden = true;
    pcmBuffer = null;
    clearSpectra();
    drawPlaceholderSpectrum();
  };
  img.src = src;
}

//could probably have put some of this in a function, but choosing not to cause I'm lazy
document.querySelectorAll('.sample-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.sample;
    const imgData = DSP.generateSampleImageData(type, 300, 200);
    const ctx = imgCanvas.getContext('2d');
    imgCanvas.width  = imgData.width;
    imgCanvas.height = imgData.height;
    ctx.putImageData(imgData, 0, 0);
    currentImageData = imgData;
    window.currentImageData = currentImageData;
    uploadZone.classList.add('has-image');
    synthBtn.disabled = false;
    playbackRow.hidden = true;
    pcmBuffer = null;
    clearSpectra();
    drawPlaceholderSpectrum();
  });
});

synthBtn.addEventListener('click', () => {
  if (!currentImageData) return;
  stopAudio();

  progressWrap.hidden = false;
  progressBar.classList.add('running');
  progressLabel.textContent = 'Synthesizing…';
  synthBtn.disabled = true;
  playbackRow.hidden = true;


  setTimeout(() => {
    const opts = {
      duration:     parseInt(durSlider.value),
      quantLevels:  parseInt(quantSlider.value),
      maxHarmonics: parseInt(harmSlider.value),
      filterType:   filterSel.value,
      baseline:     baselineSel.value,
      onProgress:   (f) => {
        progressLabel.textContent = `Synthesizing… ${Math.round(f * 100)}%`;
      },
    };

    pcmBuffer = DSP.sonify(currentImageData, opts);

    wavBlob = DSP.encodeWAV(pcmBuffer, DSP.FS);
    const url = URL.createObjectURL(wavBlob);
    dlBtn.href = url;

    progressBar.classList.remove('running');
    progressWrap.hidden = true;
    playbackRow.hidden = false;
    synthBtn.disabled = false;

    drawSpectrum(pcmBuffer);
    drawWaveform(pcmBuffer);
    animateScanLine();
  }, 50);
});
playBtn.addEventListener('click', () => {
  if (!pcmBuffer) return;
  stopAudio();

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: DSP.FS,
    latencyHint: 'playback',
  });

  try {
    if (audioCtx.audioSession) {
      audioCtx.audioSession.category = 'playback';
    }
  } catch(e) {/*not supported on browser*/ }
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const ab = audioCtx.createBuffer(1, pcmBuffer.length, DSP.FS);
  ab.getChannelData(0).set(pcmBuffer);

  activeSource = audioCtx.createBufferSource();
  activeSource.buffer = ab;
  activeSource.connect(audioCtx.destination);
  activeSource.start();
  activeSource.onended = () => { playBtn.textContent = '▶ Play'; };

  playBtn.textContent = '◼ Playing…';
});

stopBtn.addEventListener('click', stopAudio);

function stopAudio() {
  if (activeSource) {
    try { activeSource.stop(); } catch(e) {}
    activeSource = null;
  }
  playBtn.textContent = '▶ Play';
}

function drawSpectrum(pcm) {
  const ctx = specCanvas.getContext('2d');
  const W = specCanvas.width, H = specCanvas.height;
  ctx.clearRect(0, 0, W, H);

  const mag = DSP.computeSpectrum(pcm, 2048);
  const maxBin = mag.length;

  const maxFreq = 8000;
  const maxBinShow = Math.round(maxFreq / (DSP.FS / 2) * maxBin);

  let peak = 0;
  for (let i = 0; i < maxBinShow; i++) if (mag[i] > peak) peak = mag[i];

  ctx.fillStyle = '#0d0d10';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 0.5;
  for (let f = 1000; f < maxFreq; f += 1000) {
    const x = (f / maxFreq) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  ctx.fillStyle = '#c8f542';
  for (let i = 0; i < W; i++) {
    const binIdx = Math.floor((i / W) * maxBinShow);
    const v = peak > 0 ? mag[binIdx] / peak : 0;
    const barH = Math.round(v * H);

    const hue = 75 + (i / W) * 90;
    ctx.fillStyle = `hsl(${hue}, 90%, 55%)`;
    ctx.fillRect(i, H - barH, 1, barH);
  }


  ctx.fillStyle = 'rgba(136,136,128,0.8)';
  ctx.font = '9px Space Mono, monospace';
  for (let f = 1000; f < maxFreq; f += 1000) {
    const x = (f / maxFreq) * W;
    ctx.fillText(`${f / 1000}k`, x + 2, H - 3);
  }
}

function drawWaveform(pcm) {
  const ctx = waveCanvas.getContext('2d');
  const W = waveCanvas.width, H = waveCanvas.height;
  ctx.fillStyle = '#0d0d10';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#42f5c8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = Math.floor(pcm.length / W);
  for (let x = 0; x < W; x++) {
    const i = x * step;
    const y = (0.5 + pcm[i] * 0.45) * H;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function clearSpectra() {
  [specCanvas, waveCanvas].forEach(c => {
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0d0d10';
    ctx.fillRect(0, 0, c.width, c.height);
  });
  const scanCtx = scanCanvas.getContext('2d');
  scanCtx.clearRect(0, 0, scanCanvas.width, scanCanvas.height);
}

function drawPlaceholderSpectrum() {
  const ctx = specCanvas.getContext('2d');
  const W = specCanvas.width, H = specCanvas.height;
  ctx.fillStyle = '#0d0d10'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(136,136,128,0.3)';
  ctx.font = '11px Space Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Spectrum will appear after synthesis', W / 2, H / 2);
  ctx.textAlign = 'left';
}

function animateScanLine() {
  if (!activeSource) return;
  const dur = parseInt(durSlider.value) * 1000;
  const W = scanCanvas.width, H = scanCanvas.height;
  const start = performance.now();

  function frame(now) {
    const elapsed = now - start;
    const frac = Math.min(elapsed / dur, 1);
    const ctx = scanCanvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(200,245,66,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(frac * W, 0);
    ctx.lineTo(frac * W, H);
    ctx.stroke();
    if (frac < 1 && activeSource) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  }
  requestAnimationFrame(frame);
}


(function heroAnimation() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let t = 0;

  function frame() {
    ctx.fillStyle = '#0d0d10';
    ctx.fillRect(0, 0, W, H);

    //fake waveform
    const numLines = 6;
    for (let ln = 0; ln < numLines; ln++) {
      const y0 = (ln + 0.5) * (H / numLines);
      ctx.beginPath();
      ctx.strokeStyle = `hsl(${75 + ln * 20}, 85%, ${45 + ln * 4}%)`;
      ctx.lineWidth = 1.5;
      for (let x = 0; x < W; x++) {
        const freq = 0.04 + ln * 0.015;
        const amp  = 8 + ln * 3;
        const y    = y0 + amp * Math.sin(x * freq + t * (0.7 + ln * 0.2))
                        + (amp * 0.4) * Math.sin(x * freq * 2.3 - t * 1.1);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    const barW = 28;
    for (let i = 0; i < 12; i++) {
      const barH = 8 + 40 * Math.abs(Math.sin(t * (0.5 + i * 0.3) + i));
      const hue = 75 + i * 12;
      ctx.fillStyle = `hsl(${hue}, 85%, 50%)`;
      ctx.fillRect(W - barW + 2, H - 8 - barH, barW - 6, barH);
    }

    t += 0.025;
    requestAnimationFrame(frame);
  }
  frame();
})();

drawPlaceholderSpectrum();
clearSpectra();
