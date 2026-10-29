const appRoot = document.getElementById('appRoot');
const stage = document.getElementById('stage');
const controlsFooter = document.getElementById('controlsFooter');

const imageInput = document.getElementById('imageInput');
const uploadBtn = document.getElementById('uploadBtn');
const clearBtn = document.getElementById('clearBtn');
const cameraBtn = document.getElementById('cameraBtn');
const cameraBtnLabel = document.getElementById('cameraBtnLabel');
const flipCameraBtn = document.getElementById('flipCameraBtn');
const torchBtn = document.getElementById('torchBtn');

const fullscreenBtn = document.getElementById('fullscreenBtn');
const fsIconEnter = document.getElementById('fsIconEnter');
const fsIconExit = document.getElementById('fsIconExit');

const lockBtn = document.getElementById('lockBtn');
const lockBtnLabel = document.getElementById('lockBtnLabel');
const lockIconUnlocked = document.getElementById('lockIconUnlocked');
const lockIconLocked = document.getElementById('lockIconLocked');

const cameraVideo = document.getElementById('cameraVideo');
const cameraHint = document.getElementById('cameraHint');
const sketchColorBar = document.getElementById('sketchColorBar');
const colorDotButtons = Array.from(sketchColorBar.querySelectorAll('.color-dot'));
const gestureHint = document.getElementById('gestureHint');
const emptyState = document.getElementById('emptyState');
const overlayLayer = document.getElementById('overlayLayer');
const previewImage = document.getElementById('previewImage');
const sketchCanvas = document.getElementById('sketchCanvas');
const sketchCtx = sketchCanvas.getContext('2d');
const fileNameBadge = document.getElementById('fileName');
const errorMessage = document.getElementById('errorMessage');

const transformBar = document.getElementById('transformBar');
const sketchBtn = document.getElementById('sketchBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const rotateBtn = document.getElementById('rotateBtn');
const mirrorBtn = document.getElementById('mirrorBtn');
const resetTransformBtn = document.getElementById('resetTransformBtn');

const opacityPanel = document.getElementById('opacityPanel');
const sketchDetailGroup = document.getElementById('sketchDetailGroup');
const sketchDetailSlider = document.getElementById('sketchDetailSlider');
const sketchDetailValue = document.getElementById('sketchDetailValue');
const opacitySlider = document.getElementById('opacitySlider');
const opacityValue = document.getElementById('opacityValue');

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg']);
const ALLOWED_EXT_REGEX = /\.(png|jpe?g)$/i;
const DEFAULT_CAMERA_OPACITY = 50;
const DEFAULT_SKETCH_CAMERA_OPACITY = 90;
const DEFAULT_PREVIEW_OPACITY = 100;
const DEFAULT_SKETCH_DETAIL = 65;
const MAX_SKETCH_DIM = 1400;
const MIN_SCALE = 0.2;
const MAX_SCALE = 6;
const BUTTON_ZOOM_FACTOR = 1.2;

const SKETCH_PALETTES = {
  darkOnCamera: [15, 20, 30],
  darkOnStage: [220, 226, 236],
  blue: [14, 165, 233],
  red: [239, 68, 68],
  light: [248, 250, 252]
};

const canFullscreen = Boolean(
  document.fullscreenEnabled || document.webkitFullscreenEnabled
);

let currentObjectUrl = null;
let cameraStream = null;
let currentFacingMode = 'environment';
let isCameraLoading = false;
let isTorchOn = false;
let hasImage = false;
let isSketchMode = false;
let sketchDetail = DEFAULT_SKETCH_DETAIL;
let sketchColorKey = 'dark';
let sketchCache = null;
let hasUserAdjustedOpacity = false;
let isLocked = false;
let wakeLockSentinel = null;
let gestureHintTimer = null;
let hasShownGestureHint = false;

const transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  flipX: false
};

let touchState = null;
let mouseDragState = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle) {
  let normalized = angle % 360;
  if (normalized > 180) {
    normalized -= 360;
  } else if (normalized <= -180) {
    normalized += 360;
  }
  return normalized;
}

function updateSliderFill(sliderEl) {
  const min = Number(sliderEl.min) || 0;
  const max = Number(sliderEl.max) || 100;
  const val = Number(sliderEl.value) || 0;
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  sliderEl.style.setProperty('--slider-fill', `${clamp(pct, 0, 100)}%`);
}

function openFilePicker() {
  if (isLocked) {
    return;
  }
  imageInput.click();
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function hideError() {
  errorMessage.textContent = '';
  errorMessage.hidden = true;
}

function setOpacity(percent) {
  const clamped = clamp(Math.round(Number(percent) || 0), 0, 100);
  opacitySlider.value = String(clamped);
  opacityValue.textContent = `%${clamped}`;
  overlayLayer.style.opacity = String(clamped / 100);
  updateSliderFill(opacitySlider);
}

function applyAutoOpacity() {
  if (!hasImage || hasUserAdjustedOpacity) {
    return;
  }
  if (!cameraStream) {
    setOpacity(DEFAULT_PREVIEW_OPACITY);
  } else {
    setOpacity(isSketchMode ? DEFAULT_SKETCH_CAMERA_OPACITY : DEFAULT_CAMERA_OPACITY);
  }
}

function clampPosition() {
  const stageWidth = stage.clientWidth || 360;
  const stageHeight = stage.clientHeight || 640;
  const maxSpan = Math.max(stageWidth, stageHeight) * Math.max(1, transform.scale) * 0.9;
  transform.x = clamp(transform.x, -maxSpan, maxSpan);
  transform.y = clamp(transform.y, -maxSpan, maxSpan);
}

function applyTransform() {
  clampPosition();
  const scaleX = transform.flipX ? -transform.scale : transform.scale;
  const scaleY = transform.scale;
  overlayLayer.style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0) rotate(${transform.rotation}deg) scale(${scaleX}, ${scaleY})`;

  mirrorBtn.classList.toggle('is-active', transform.flipX);
  mirrorBtn.setAttribute('aria-pressed', String(transform.flipX));
}

function resetTransform() {
  transform.x = 0;
  transform.y = 0;
  transform.scale = 1;
  transform.rotation = 0;
  transform.flipX = false;
  applyTransform();
}

function zoomAroundPoint(factor, clientX, clientY) {
  if (!hasImage || isLocked) {
    return;
  }

  const nextScale = clamp(transform.scale * factor, MIN_SCALE, MAX_SCALE);
  const actualRatio = nextScale / transform.scale;

  let mx = 0;
  let my = 0;
  if (typeof clientX === 'number' && typeof clientY === 'number') {
    const rect = stage.getBoundingClientRect();
    mx = clientX - (rect.left + rect.width / 2);
    my = clientY - (rect.top + rect.height / 2);
  }

  transform.x = mx + (transform.x - mx) * actualRatio;
  transform.y = my + (transform.y - my) * actualRatio;
  transform.scale = nextScale;
  applyTransform();
}

function rotateBy(deltaDegrees) {
  if (!hasImage || isLocked) {
    return;
  }
  transform.rotation = normalizeAngle(transform.rotation + deltaDegrees);
  applyTransform();
}

function toggleMirror() {
  if (!hasImage || isLocked) {
    return;
  }
  transform.flipX = !transform.flipX;
  applyTransform();
}

/* --- Gelişmiş Eskiz Motoru: Çift Çizgi Yapmayan + İnce Çizgileri Koruyan Hibrit Algoritma --- */
function getEffectiveSketchRGB() {
  if (sketchColorKey === 'dark') {
    return cameraStream ? SKETCH_PALETTES.darkOnCamera : SKETCH_PALETTES.darkOnStage;
  }
  return SKETCH_PALETTES[sketchColorKey] || SKETCH_PALETTES.darkOnCamera;
}

function buildSketchCache() {
  if (!hasImage || !previewImage.naturalWidth || !previewImage.naturalHeight) {
    return null;
  }

  const scale = Math.min(
    1,
    MAX_SKETCH_DIM / Math.max(previewImage.naturalWidth, previewImage.naturalHeight)
  );
  const w = Math.max(1, Math.round(previewImage.naturalWidth * scale));
  const h = Math.max(1, Math.round(previewImage.naturalHeight * scale));
  const pixelCount = w * h;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
  tempCtx.drawImage(previewImage, 0, 0, w, h);

  const srcData = tempCtx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(pixelCount);

  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    const alpha = srcData[p + 3];
    const lum = (77 * srcData[p] + 150 * srcData[p + 1] + 29 * srcData[p + 2]) >> 8;
    gray[i] = ((lum * alpha + 255 * (255 - alpha)) / 255) | 0;
  }

  const strokes = new Uint8Array(pixelCount);

  if (w >= 4 && h >= 4) {
    // 1) İntegral görüntü (Summed-Area Table): Kalın çizgilerin içini dolu tutar,
    //    1 piksellik en ince kalem hatlarını bulanıklaştırmadan korur.
    const stride = w + 1;
    const sat = new Uint32Array(stride * (h + 1));

    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      const srcRow = y * w;
      const prevRow = y * stride;
      const currRow = (y + 1) * stride;
      for (let x = 0; x < w; x++) {
        rowSum += gray[srcRow + x];
        sat[currRow + x + 1] = sat[prevRow + x + 1] + rowSum;
      }
    }

    const radius = clamp(Math.round(Math.min(w, h) * 0.009), 4, 10);
    const MAX_SCORE = 512;
    const rawScore = new Uint16Array(pixelCount);
    const histogram = new Uint32Array(MAX_SCORE + 1);

    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(h - 1, y + radius);
      const satTop = y0 * stride;
      const satBot = (y1 + 1) * stride;
      const boxH = y1 - y0 + 1;

      const yPrev = y > 0 ? y - 1 : 0;
      const yNext = y < h - 1 ? y + 1 : h - 1;
      const rowCurr = y * w;
      const rowPrev = yPrev * w;
      const rowNext = yNext * w;

      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(w - 1, x + radius);
        const area = (x1 - x0 + 1) * boxH;

        const sum =
          sat[satBot + x1 + 1] -
          sat[satTop + x1 + 1] -
          sat[satBot + x0] +
          sat[satTop + x0];

        const localMean = sum / area;
        const centerVal = gray[rowCurr + x];

        // Bölgesel koyuluk farkı (çizgi içi dolu kalır, çift çizgi oluşmaz)
        const darkLineStrength = Math.max(0, localMean - centerVal) * 2.2;

        // Gerçek fotoğraflardaki yumuşak geçiş sınırları için ince gradyan desteği
        const xPrev = x > 0 ? x - 1 : 0;
        const xNext = x < w - 1 ? x + 1 : w - 1;
        const gx = Math.abs(gray[rowCurr + xNext] - gray[rowCurr + xPrev]);
        const gy = Math.abs(gray[rowNext + x] - gray[rowPrev + x]);
        const fineEdgeStrength = (gx + gy) * 0.55;

        const combined = Math.min(
          MAX_SCORE,
          Math.round(Math.max(darkLineStrength, fineEdgeStrength))
        );

        rawScore[rowCurr + x] = combined;
        histogram[combined]++;
      }
    }

    const targetRank = Math.floor(pixelCount * 0.975);
    let cumulative = 0;
    let p975 = 90;
    for (let s = 0; s <= MAX_SCORE; s++) {
      cumulative += histogram[s];
      if (cumulative >= targetRank) {
        p975 = s;
        break;
      }
    }

    const normDivisor = Math.max(36, p975);
    for (let i = 0; i < pixelCount; i++) {
      const val = ((rawScore[i] * 255) / normDivisor) | 0;
      strokes[i] = val > 255 ? 255 : val;
    }
  }

  sketchCanvas.width = w;
  sketchCanvas.height = h;
  const outputImageData = sketchCtx.createImageData(w, h);

  return {
    width: w,
    height: h,
    strokes,
    outputImageData,
    appliedColorSig: ''
  };
}

function renderSketch() {
  if (!hasImage) {
    return;
  }
  if (!sketchCache) {
    sketchCache = buildSketchCache();
  }
  if (!sketchCache) {
    return;
  }

  const [r, g, b] = getEffectiveSketchRGB();
  const colorSig = `${r},${g},${b}`;
  const { strokes, outputImageData } = sketchCache;
  const out = outputImageData.data;

  if (sketchCache.appliedColorSig !== colorSig) {
    for (let p = 0; p < out.length; p += 4) {
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
    }
    sketchCache.appliedColorSig = colorSig;
  }

  const t = clamp(sketchDetail, 5, 100) / 100;
  const lowThreshold = Math.round(92 * Math.pow(1 - t, 1.35) + 3);
  const span = Math.max(16, Math.round(54 - t * 34));
  const gamma = 0.72 - t * 0.2;
  const lut = new Uint8Array(256);

  for (let s = 0; s < 256; s++) {
    if (s <= lowThreshold) {
      lut[s] = 0;
    } else {
      const norm = Math.min(1, (s - lowThreshold) / span);
      lut[s] = Math.round(Math.pow(norm, gamma) * 255);
    }
  }

  for (let i = 0, p = 3; i < strokes.length; i++, p += 4) {
    out[p] = lut[strokes[i]];
  }

  sketchCtx.putImageData(outputImageData, 0, 0);
}

function setSketchDetail(value) {
  sketchDetail = clamp(Math.round(Number(value) || DEFAULT_SKETCH_DETAIL), 5, 100);
  sketchDetailSlider.value = String(sketchDetail);
  sketchDetailValue.textContent = `%${sketchDetail}`;
  updateSliderFill(sketchDetailSlider);

  if (isSketchMode && hasImage) {
    renderSketch();
  }
}

function setSketchColor(colorKey) {
  if (! colorKey) {
    return;
  }
  sketchColorKey = colorKey;
  colorDotButtons.forEach((btn) => {
    btn.classList.toggle('is-selected', btn.dataset.color === colorKey);
  });

  if (isSketchMode && hasImage) {
    renderSketch();
  }
}

function toggleSketchMode() {
  if (!hasImage || isLocked) {
    return;
  }
  hideError();
  isSketchMode = !isSketchMode;

  if (isSketchMode) {
    renderSketch();
  }

  applyAutoOpacity();
  syncStageVisibility();
}

/* --- Tam Ekran (Fullscreen) Desteği --- */
function isCurrentlyFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function syncFullscreenUI() {
  if (!canFullscreen) {
    fullscreenBtn.hidden = true;
    return;
  }
  fullscreenBtn.hidden = false;
  const active = isCurrentlyFullscreen();
  fullscreenBtn.setAttribute('aria-pressed', String(active));
  fsIconEnter.hidden = active;
  fsIconExit.hidden = !active;
}

async function toggleFullscreen() {
  if (!canFullscreen) {
    return;
  }
  try {
    if (!isCurrentlyFullscreen()) {
      const rootEl = document.documentElement;
      if (rootEl.requestFullscreen) {
        await rootEl.requestFullscreen();
      } else if (rootEl.webkitRequestFullscreen) {
        rootEl.webkitRequestFullscreen();
      }
    } else if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } catch (_) {
    // Yoksay
  }
  syncFullscreenUI();
}

/* --- Flaş / Kağıt Aydınlatma (Torch) --- */
async function toggleTorch() {
  if (!cameraStream || isCameraLoading) {
    return;
  }
  hideError();

  const [videoTrack] = cameraStream.getVideoTracks();
  if (!videoTrack || typeof videoTrack.applyConstraints !== 'function') {
    showError('Bu kamerada flaş (aydınlatma) desteği bulunamadı.');
    return;
  }

  const capabilities =
    typeof videoTrack.getCapabilities === 'function' ? videoTrack.getCapabilities() : {};

  if (!capabilities || !capabilities.torch) {
    showError(
      'Bu kamera veya tarayıcı flaş kontrolünü desteklemiyor (telefonun arka kamerasında çalışır).'
    );
    return;
  }

  const nextTorch = !isTorchOn;
  try {
    await videoTrack.applyConstraints({
      advanced: [{ torch: nextTorch }]
    });
    isTorchOn = nextTorch;
    syncStageVisibility();
  } catch (_) {
    isTorchOn = false;
    syncStageVisibility();
    showError('Flaş durumu değiştirilemedi.');
  }
}

function showGestureHintOnce() {
  if (hasShownGestureHint || !hasImage || isLocked) {
    return;
  }
  hasShownGestureHint = true;
  gestureHint.hidden = false;
  requestAnimationFrame(() => {
    gestureHint.classList.add('is-visible');
  });

  clearTimeout(gestureHintTimer);
  gestureHintTimer = setTimeout(dismissGestureHint, 3500);
}

function dismissGestureHint() {
  clearTimeout(gestureHintTimer);
  gestureHint.classList.remove('is-visible');
  setTimeout(() => {
    if (!gestureHint.classList.contains('is-visible')) {
      gestureHint.hidden = true;
    }
  }, 260);
}

async function syncWakeLock() {
  const shouldKeepAwake = Boolean(cameraStream) || (hasImage && isLocked);

  if (!('wakeLock' in navigator) || !navigator.wakeLock) {
    return;
  }

  if (shouldKeepAwake && document.visibilityState === 'visible') {
    if (!wakeLockSentinel) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      } catch (_) {
        wakeLockSentinel = null;
      }
    }
  } else if (!shouldKeepAwake && wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch (_) {
      // Yoksay
    }
    wakeLockSentinel = null;
  }
}

function setLocked(nextLocked) {
  isLocked = Boolean(nextLocked) && hasImage;
  touchState = null;
  mouseDragState = null;
  stage.classList.remove('is-dragging');

  if (isLocked) {
    hideError();
    dismissGestureHint();
  }

  syncStageVisibility();
  syncWakeLock();
}

function syncStageVisibility() {
  const isCameraActive = Boolean(cameraStream);

  appRoot.classList.toggle('is-locked', isLocked);
  appRoot.classList.toggle('has-camera', isCameraActive);
  stage.classList.toggle('is-interactive', hasImage && !isLocked);

  emptyState.hidden = hasImage || isCameraActive;
  cameraHint.hidden = !isCameraActive || hasImage;
  overlayLayer.hidden = !hasImage;

  previewImage.hidden = !hasImage || isSketchMode;
  sketchCanvas.hidden = !hasImage || !isSketchMode;
  sketchColorBar.hidden = !hasImage || !isSketchMode || isLocked;

  sketchBtn.classList.toggle('is-active', isSketchMode);
  sketchBtn.setAttribute('aria-pressed', String(isSketchMode));
  sketchDetailGroup.hidden = !hasImage || !isSketchMode;
  opacityPanel.classList.toggle('is-split', hasImage && isSketchMode);

  lockBtn.hidden = !hasImage;
  lockBtn.classList.toggle('is-locked', isLocked);
  lockBtn.setAttribute('aria-pressed', String(isLocked));
  lockBtnLabel.textContent = isLocked ? 'Kilitli • Aç' : 'Kilitle';
  lockIconUnlocked.hidden = isLocked;
  lockIconLocked.hidden = !isLocked;

  fileNameBadge.hidden = !hasImage || isLocked;
  // Flaş kilit modundayken de açık kalır (çizim ortasında kağıdı aydınlatabilmek için)
  torchBtn.hidden = !isCameraActive;
  torchBtn.classList.toggle('is-torch-active', isTorchOn);
  torchBtn.setAttribute('aria-pressed', String(isTorchOn));
  flipCameraBtn.hidden = !isCameraActive || isLocked;
  syncFullscreenUI();

  transformBar.hidden = !hasImage;
  opacityPanel.hidden = !hasImage;
  clearBtn.hidden = !hasImage;

  cameraVideo.hidden = !isCameraActive;
  cameraBtn.classList.toggle('is-active', isCameraActive);
  cameraBtnLabel.textContent = isCameraActive ? 'Kamerayı Kapat' : 'Kamerayı Aç';
}

function isSupportedImage(file) {
  if (ALLOWED_MIME_TYPES.has(file.type)) {
    return true;
  }
  return file.type === '' && ALLOWED_EXT_REGEX.test(file.name);
}

function loadPreview(file) {
  hideError();

  if (!isSupportedImage(file)) {
    showError('Lütfen yalnızca PNG veya JPG formatında bir fotoğraf seçin.');
    imageInput.value = '';
    return;
  }

  const nextObjectUrl = URL.createObjectURL(file);

  previewImage.onload = () => {
    if (currentObjectUrl && currentObjectUrl !== nextObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
    }
    currentObjectUrl = nextObjectUrl;
    hasImage = true;
    sketchCache = null;

    fileNameBadge.textContent = file.name;
    resetTransform();

    if (isSketchMode) {
      renderSketch();
    }

    applyAutoOpacity();
    syncStageVisibility();
    showGestureHintOnce();
  };

  previewImage.onerror = () => {
    URL.revokeObjectURL(nextObjectUrl);
    showError('Seçilen görsel yüklenemedi. Lütfen başka bir PNG veya JPG dosyası deneyin.');
  };

  previewImage.src = nextObjectUrl;
  imageInput.value = '';
}

function clearPreview() {
  hideError();

  previewImage.onload = null;
  previewImage.onerror = null;
  previewImage.removeAttribute('src');

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  hasImage = false;
  isSketchMode = false;
  sketchCache = null;
  sketchCanvas.width = 1;
  sketchCanvas.height = 1;
  setSketchDetail(DEFAULT_SKETCH_DETAIL);

  isLocked = false;
  hasUserAdjustedOpacity = false;
  resetTransform();
  setOpacity(DEFAULT_PREVIEW_OPACITY);
  dismissGestureHint();

  fileNameBadge.textContent = '';
  imageInput.value = '';

  syncStageVisibility();
  syncWakeLock();
}

function stopStreamTracks(stream) {
  if (!stream) {
    return;
  }
  stream.getTracks().forEach((track) => track.stop());
}

function stopCamera() {
  stopStreamTracks(cameraStream);
  cameraStream = null;
  isTorchOn = false;

  cameraVideo.pause();
  cameraVideo.srcObject = null;
  cameraVideo.classList.remove('is-mirrored');

  if (isSketchMode && hasImage) {
    renderSketch();
  }

  applyAutoOpacity();
  syncStageVisibility();
  syncWakeLock();
}

function getCameraErrorMessage(error) {
  if (!window.isSecureContext) {
    return 'Kamera erişimi için sayfanın HTTPS veya localhost üzerinden açılması gerekir. Doğrudan dosya (file://) olarak açıldığında tarayıcı kamerayı engeller.';
  }
  if (!error) {
    return 'Kamera başlatılırken beklenmeyen bir hata oluştu.';
  }
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    return 'Kamera izni verilmedi. Lütfen tarayıcı ayarlarından kamera iznini etkinleştirin.';
  }
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return 'Bu cihazda kullanılabilir bir kamera bulunamadı.';
  }
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    return 'Kamera şu anda başka bir uygulama tarafından kullanılıyor olabilir.';
  }
  return 'Kamera açılamadı. Lütfen kamera izinlerini ve bağlantınızı kontrol edin.';
}

async function requestCameraStream(facingMode) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
  } catch (error) {
    if (error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
      throw error;
    }
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: false
    });
  }
}

async function startCamera(facingMode = currentFacingMode) {
  if (isCameraLoading) {
    return;
  }

  hideError();

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    showError(getCameraErrorMessage(null));
    return;
  }

  isCameraLoading = true;
  cameraBtn.disabled = true;
  flipCameraBtn.disabled = true;
  torchBtn.disabled = true;

  try {
    if (cameraStream) {
      stopStreamTracks(cameraStream);
      cameraStream = null;
      isTorchOn = false;
      cameraVideo.srcObject = null;
    }

    const stream = await requestCameraStream(facingMode);
    cameraStream = stream;
    currentFacingMode = facingMode;
    isTorchOn = false;

    const [videoTrack] = stream.getVideoTracks();
    if (videoTrack) {
      const settings = typeof videoTrack.getSettings === 'function' ? videoTrack.getSettings() : {};
      cameraVideo.classList.toggle('is-mirrored', settings.facingMode === 'user');

      videoTrack.addEventListener('ended', () => {
        if (cameraStream === stream) {
          stopCamera();
        }
      });
    }

    cameraVideo.srcObject = stream;

    if (isSketchMode && hasImage) {
      renderSketch();
    }

    syncStageVisibility();
    syncWakeLock();
    await cameraVideo.play().catch(() => {});

    applyAutoOpacity();
  } catch (error) {
    stopCamera();
    showError(getCameraErrorMessage(error));
  } finally {
    isCameraLoading = false;
    cameraBtn.disabled = false;
    flipCameraBtn.disabled = false;
    torchBtn.disabled = false;
  }
}

function toggleCamera() {
  if (isLocked) {
    return;
  }
  hideError();
  if (cameraStream) {
    stopCamera();
  } else {
    startCamera(currentFacingMode);
  }
}

function flipCamera() {
  if (!cameraStream || isCameraLoading || isLocked) {
    return;
  }
  const nextMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  startCamera(nextMode);
}

/* --- Dokunmatik (Mobil) Hareketler: Sürükle + İki Parmak Büyüt/Döndür --- */
function captureTouchBaseline(touches) {
  if (!touches || touches.length === 0) {
    touchState = null;
    return;
  }

  if (touches.length === 1) {
    touchState = {
      mode: 'pan',
      lastX: touches[0].clientX,
      lastY: touches[0].clientY
    };
    return;
  }

  const t1 = touches[0];
  const t2 = touches[1];
  const rect = stage.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;

  touchState = {
    mode: 'pinch',
    lastMx: (t1.clientX + t2.clientX) / 2 - centerX,
    lastMy: (t1.clientY + t2.clientY) / 2 - centerY,
    lastDist: Math.max(1, Math.hypot(dx, dy)),
    lastAngle: (Math.atan2(dy, dx) * 180) / Math.PI
  };
}

stage.addEventListener(
  'touchstart',
  (event) => {
    if (!hasImage || isLocked || event.target.closest('.sketch-color-bar')) {
      return;
    }
    dismissGestureHint();
    captureTouchBaseline(event.touches);
  },
  { passive: true }
);

stage.addEventListener(
  'touchmove',
  (event) => {
    if (!hasImage || isLocked || !touchState) {
      return;
    }
    event.preventDefault();

    const touches = event.touches;
    if (touches.length === 1 && touchState.mode === 'pan') {
      const dx = touches[0].clientX - touchState.lastX;
      const dy = touches[0].clientY - touchState.lastY;
      touchState.lastX = touches[0].clientX;
      touchState.lastY = touches[0].clientY;

      transform.x += dx;
      transform.y += dy;
      applyTransform();
    } else if (touches.length >= 2) {
      if (touchState.mode !== 'pinch') {
        captureTouchBaseline(touches);
        return;
      }

      const t1 = touches[0];
      const t2 = touches[1];
      const rect = stage.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const mx = (t1.clientX + t2.clientX) / 2 - centerX;
      const my = (t1.clientY + t2.clientY) / 2 - centerY;
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

      const rawScaleRatio = dist / touchState.lastDist;
      const nextScale = clamp(transform.scale * rawScaleRatio, MIN_SCALE, MAX_SCALE);
      const actualRatio = nextScale / transform.scale;

      const deltaAngle = normalizeAngle(angle - touchState.lastAngle);
      const rad = (deltaAngle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const vx = transform.x - touchState.lastMx;
      const vy = transform.y - touchState.lastMy;

      transform.x = mx + (vx * cos - vy * sin) * actualRatio;
      transform.y = my + (vx * sin + vy * cos) * actualRatio;
      transform.scale = nextScale;
      transform.rotation = normalizeAngle(transform.rotation + deltaAngle);

      touchState.lastMx = mx;
      touchState.lastMy = my;
      touchState.lastDist = dist;
      touchState.lastAngle = angle;

      applyTransform();
    }
  },
  { passive: false }
);

function handleTouchEnd(event) {
  if (!hasImage || isLocked) {
    touchState = null;
    return;
  }
  captureTouchBaseline(event.touches);
}

stage.addEventListener('touchend', handleTouchEnd, { passive: true });
stage.addEventListener('touchcancel', handleTouchEnd, { passive: true });

/* --- Masaüstü Fare & Tekerlek Desteği --- */
stage.addEventListener('mousedown', (event) => {
  if (!hasImage || isLocked || event.button !== 0 || event.target.closest('.sketch-color-bar')) {
    return;
  }
  dismissGestureHint();
  mouseDragState = {
    lastX: event.clientX,
    lastY: event.clientY
  };
  stage.classList.add('is-dragging');
});

window.addEventListener('mousemove', (event) => {
  if (!mouseDragState || !hasImage || isLocked) {
    return;
  }
  const dx = event.clientX - mouseDragState.lastX;
  const dy = event.clientY - mouseDragState.lastY;
  mouseDragState.lastX = event.clientX;
  mouseDragState.lastY = event.clientY;

  transform.x += dx;
  transform.y += dy;
  applyTransform();
});

window.addEventListener('mouseup', () => {
  if (mouseDragState) {
    mouseDragState = null;
    stage.classList.remove('is-dragging');
  }
});

stage.addEventListener(
  'wheel',
  (event) => {
    if (!hasImage || isLocked) {
      return;
    }
    event.preventDefault();
    dismissGestureHint();

    if (event.shiftKey) {
      const step = event.deltaY > 0 ? 5 : -5;
      rotateBy(step);
    } else {
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      zoomAroundPoint(factor, event.clientX, event.clientY);
    }
  },
  { passive: false }
);

/* --- Buton ve Kontroller --- */
uploadBtn.addEventListener('click', openFilePicker);

emptyState.addEventListener('click', openFilePicker);
emptyState.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openFilePicker();
  }
});

imageInput.addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }
  loadPreview(file);
});

clearBtn.addEventListener('click', clearPreview);
cameraBtn.addEventListener('click', toggleCamera);
flipCameraBtn.addEventListener('click', flipCamera);
torchBtn.addEventListener('click', toggleTorch);
fullscreenBtn.addEventListener('click', toggleFullscreen);
sketchBtn.addEventListener('click', toggleSketchMode);

colorDotButtons.forEach((btn) => {
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    setSketchColor(btn.dataset.color);
  });
});

lockBtn.addEventListener('click', () => {
  setLocked(!isLocked);
});

zoomInBtn.addEventListener('click', () => {
  dismissGestureHint();
  zoomAroundPoint(BUTTON_ZOOM_FACTOR);
});

zoomOutBtn.addEventListener('click', () => {
  dismissGestureHint();
  zoomAroundPoint(1 / BUTTON_ZOOM_FACTOR);
});

rotateBtn.addEventListener('click', () => {
  dismissGestureHint();
  rotateBy(90);
});

mirrorBtn.addEventListener('click', () => {
  dismissGestureHint();
  toggleMirror();
});

resetTransformBtn.addEventListener('click', () => {
  dismissGestureHint();
  resetTransform();
});

sketchDetailSlider.addEventListener('input', (event) => {
  setSketchDetail(event.target.value);
});

opacitySlider.addEventListener('input', (event) => {
  hasUserAdjustedOpacity = true;
  setOpacity(event.target.value);
});

document.addEventListener('fullscreenchange', syncFullscreenUI);
document.addEventListener('webkitfullscreenchange', syncFullscreenUI);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncWakeLock();
  }
});

window.addEventListener('pagehide', () => {
  if (cameraStream) {
    stopStreamTracks(cameraStream);
  }
});

// İlk yükleme durumu
updateSliderFill(opacitySlider);
updateSliderFill(sketchDetailSlider);
syncStageVisibility();
