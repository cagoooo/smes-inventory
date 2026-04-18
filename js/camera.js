// Live 相機預覽：getUserMedia + 九宮格 + 曝光/對焦偵測
(function() {
  let stream = null;
  let videoEl = null;
  let canvas = null;
  let overlay = null;
  let onCapture = null;  // 拍完 callback(file)
  let analyzeTimer = null;

  // iOS Safari 友善的 getUserMedia：多層 fallback（有些 iOS 版本 ideal 約束會失敗）
  async function getStreamWithFallback() {
    const tries = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false },
      { video: { facingMode: { exact: 'environment' } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false }
    ];
    let lastErr = null;
    for (const constraint of tries) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraint);
      } catch (e) {
        lastErr = e;
        console.warn('[camera] constraint failed', constraint, e.name);
      }
    }
    throw lastErr || new Error('無法取得相機串流');
  }

  async function open(captureCallback) {
    onCapture = captureCallback;
    const modal = document.getElementById('cameraModal');
    if (!modal) { alert('相機 UI 尚未初始化'); return; }

    // iOS Safari 要求 HTTPS + 使用者手勢啟動。檢查
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      alert('Live 相機需要 HTTPS 連線才能使用');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('此瀏覽器不支援 Live 相機。請使用 iOS 11.3+ Safari 或 Android Chrome。');
      return;
    }

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    videoEl = document.getElementById('cameraVideo');
    canvas = document.getElementById('cameraCanvas');
    overlay = document.getElementById('cameraOverlay');

    try {
      stream = await getStreamWithFallback();
      videoEl.srcObject = stream;

      // iOS Safari 需要明確 play() 且 playsinline（已設 attr）
      // iOS 有時 play() 會因 autoplay policy 失敗 → 用 try
      try { await videoEl.play(); }
      catch (e) {
        console.warn('[camera] autoplay blocked, waiting for user tap');
        // 點擊視訊區域再 play
        videoEl.addEventListener('click', () => videoEl.play(), { once: true });
      }

      startAnalyze();
    } catch (e) {
      console.error('[camera] open failed', e);
      let msg = e.message || '未知錯誤';
      if (e.name === 'NotAllowedError') msg = '相機權限被拒絕。請到瀏覽器設定允許本站使用相機。';
      else if (e.name === 'NotFoundError') msg = '找不到相機裝置';
      else if (e.name === 'NotReadableError') msg = '相機被其他 App 占用';
      alert('無法開啟相機：\n' + msg);
      close();
    }
  }

  function close() {
    stopAnalyze();
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
    const modal = document.getElementById('cameraModal');
    if (modal) modal.classList.remove('show');
    document.body.style.overflow = '';
  }

  // ============ 拍照 ============
  async function capture() {
    if (!videoEl || !stream) return;
    const w = videoEl.videoWidth, h = videoEl.videoHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);

    // 震動回饋
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);

    // 閃光效果
    const flash = document.getElementById('cameraFlash');
    if (flash) {
      flash.classList.add('flash');
      setTimeout(() => flash.classList.remove('flash'), 200);
    }

    canvas.toBlob(async (blob) => {
      const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
      close();
      if (onCapture) onCapture(file);
    }, 'image/jpeg', 0.92);
  }

  // ============ 即時分析：曝光 / 亮度警示 ============
  function startAnalyze() {
    stopAnalyze();
    analyzeTimer = setInterval(() => analyzeFrame(), 600);
  }
  function stopAnalyze() {
    if (analyzeTimer) { clearInterval(analyzeTimer); analyzeTimer = null; }
  }

  function analyzeFrame() {
    if (!videoEl || !videoEl.videoWidth) return;
    // 縮小到 120px 寬度做分析
    const W = 120, H = Math.round(120 * videoEl.videoHeight / videoEl.videoWidth);
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;

    let sum = 0, min = 255, max = 0, overBright = 0, total = W * H;
    for (let i = 0; i < data.length; i += 4) {
      // 感知亮度 (Rec. 709)
      const l = data[i] * 0.2126 + data[i+1] * 0.7152 + data[i+2] * 0.0722;
      sum += l;
      if (l < min) min = l;
      if (l > max) max = l;
      if (l > 245) overBright++;
    }
    const avg = sum / total;
    const overRatio = overBright / total;

    const hint = document.getElementById('cameraHint');
    if (!hint) return;

    if (avg < 60) {
      hint.className = 'camera-hint warn';
      hint.innerHTML = '💡 光線偏暗，建議開燈或移到明亮處';
    } else if (avg > 210) {
      hint.className = 'camera-hint warn';
      hint.innerHTML = '☀️ 過曝 · 請遠離強光';
    } else if (overRatio > 0.05) {
      hint.className = 'camera-hint warn';
      hint.innerHTML = '✨ 偵測到反光點 · 調整角度避開反光';
    } else {
      hint.className = 'camera-hint good';
      hint.innerHTML = '✓ 光線合宜，可拍照';
    }
  }

  // ============ 初始化 UI ============
  function ensureUI() {
    if (document.getElementById('cameraModal')) return;
    const html = `
      <div class="camera-modal" id="cameraModal">
        <div class="camera-topbar">
          <button class="camera-close" onclick="SMES_CAMERA.close()">✕</button>
          <div class="camera-title">📷 相機盤點</div>
          <button class="camera-grid-toggle" onclick="document.getElementById('cameraOverlay').classList.toggle('show-grid')" title="切換網格">▦</button>
        </div>
        <div class="camera-view">
          <video id="cameraVideo" playsinline muted autoplay></video>
          <div class="camera-overlay show-grid" id="cameraOverlay">
            <!-- 九宮格 -->
            <div class="grid-line h" style="top:33.33%"></div>
            <div class="grid-line h" style="top:66.66%"></div>
            <div class="grid-line v" style="left:33.33%"></div>
            <div class="grid-line v" style="left:66.66%"></div>
            <!-- 中央取景框 -->
            <div class="focus-frame"></div>
          </div>
          <div class="camera-flash" id="cameraFlash"></div>
        </div>
        <div class="camera-hint" id="cameraHint">⏳ 偵測中…</div>
        <div class="camera-bottom">
          <button class="camera-shutter" onclick="SMES_CAMERA.capture()">
            <span class="shutter-inner"></span>
          </button>
        </div>
        <canvas id="cameraCanvas" style="display:none;"></canvas>
      </div>
    `;
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
  }

  // 瀏覽器是否支援 (iOS Safari 11.3+ / Android Chrome 53+)
  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  window.SMES_CAMERA = { open, close, capture, ensureUI, isSupported };
})();
