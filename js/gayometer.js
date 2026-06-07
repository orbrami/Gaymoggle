/* ── GAY-O-METER™ v3 — Real Face Analysis + Landmark Dots Overlay ──────── */

const GayOMeter = (() => {

  let _video      = null;
  let _overlayCanvas = null;  // shown on top of video for dots
  let _analysisCanvas= null;  // hidden, for pixel work
  let _actx       = null;
  let _interval   = null;
  let _prevPx     = null;
  let _score      = 5.0;
  let _smooth     = 5.0;
  let _target     = 5.0;
  let _onScore    = null;
  let _faceReady  = false;
  let _detOpts    = null;
  let _tick       = 0;
  let _lastFace   = { smile:.5, brow:.5, tilt:.2, symmetry:.7, faceSize:.4 };
  let _dotsVisible = true;
  // History of last N scores for stability detection
  const _scoreHistory = [];

  async function _loadModels() {
    if (typeof faceapi === 'undefined') return;
    try {
      const M = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
      await faceapi.nets.tinyFaceDetector.loadFromUri(M);
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri(M);
      _detOpts   = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.35 });
      _faceReady = true;
      console.log('GayOMeter: face-api loaded ✓');
    } catch(e) {
      console.warn('GayOMeter: pixel-only mode', e.message);
    }
  }

  function _drawDots(landmarks, box) {
    if (!_overlayCanvas || !_dotsVisible) return;
    const ctx = _overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, _overlayCanvas.width, _overlayCanvas.height);
    if (!landmarks || !box) return;

    // Scale from analysis canvas (160x120) to overlay canvas size
    const scaleX = _overlayCanvas.width  / 160;
    const scaleY = _overlayCanvas.height / 120;

    // Draw landmark dots
    const groups = [
      { pts: landmarks.slice(0,17),  color: '#ff6ef7', r: 2.5 }, // jaw
      { pts: landmarks.slice(17,27), color: '#ffef6e', r: 3   }, // eyebrows
      { pts: landmarks.slice(27,36), color: '#6ef7ff', r: 2.5 }, // nose
      { pts: landmarks.slice(36,48), color: '#6eff9e', r: 3   }, // eyes
      { pts: landmarks.slice(48,68), color: '#ff6ef7', r: 2.5 }, // mouth
    ];

    for (const g of groups) {
      for (const p of g.pts) {
        ctx.beginPath();
        ctx.arc(p.x * scaleX, p.y * scaleY, g.r, 0, Math.PI * 2);
        ctx.fillStyle = g.color;
        ctx.shadowColor = g.color;
        ctx.shadowBlur  = 6;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      // Connect dots with thin line
      if (g.pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(g.pts[0].x * scaleX, g.pts[0].y * scaleY);
        for (let i = 1; i < g.pts.length; i++) {
          ctx.lineTo(g.pts[i].x * scaleX, g.pts[i].y * scaleY);
        }
        ctx.strokeStyle = g.color + '55';
        ctx.lineWidth   = 0.8;
        ctx.stroke();
      }
    }

    // Score badge on face
    if (box) {
      const bx = box.x * scaleX;
      const by = box.y * scaleY;
      const bw = box.width * scaleX;
      const score = Math.round(_smooth * 10) / 10;
      const label = getLabel(score);

      // Box outline
      ctx.strokeStyle = '#ff6ef7aa';
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(bx, by, bw, box.height * scaleY);

      // Score tag above box
      const tag = `${label.emoji} ${score.toFixed(1)}`;
      ctx.font = `bold ${Math.max(11, bw * 0.12)}px 'Space Mono', monospace`;
      const tw  = ctx.measureText(tag).width;
      const tx  = bx + bw/2 - tw/2;
      const ty  = by - 8;

      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(tx - 4, ty - 14, tw + 8, 18);
      ctx.fillStyle   = '#ff6ef7';
      ctx.shadowColor = '#ff6ef7';
      ctx.shadowBlur  = 8;
      ctx.fillText(tag, tx, ty);
      ctx.shadowBlur  = 0;
    }
  }

  function _clearDots() {
    if (!_overlayCanvas) return;
    _overlayCanvas.getContext('2d').clearRect(0,0,_overlayCanvas.width,_overlayCanvas.height);
  }

  async function _analyze() {
    if (!_video || _video.readyState < 2 || !_video.videoWidth) return;

    _actx.drawImage(_video, 0, 0, 160, 120);
    const img = _actx.getImageData(0, 0, 160, 120);
    const px  = img.data;
    const n   = px.length / 4;

    // Color vibrancy
    let satSum = 0;
    for (let i = 0; i < px.length; i += 16) {
      const r = px[i]/255, g = px[i+1]/255, b = px[i+2]/255;
      const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
      satSum += mx === 0 ? 0 : (mx-mn)/mx;
    }
    const vibrancy = satSum / (n/4);

    // Warm/pink color
    let warm = 0;
    for (let i = 0; i < px.length; i += 8) {
      const r = px[i], g = px[i+1], b = px[i+2];
      if (r > 160 && g < 100 && b > 110) warm++;
      if (r > 170 && g < 80)             warm += .5;
    }
    const warmth = Math.min(1, (warm/(n/2))*12);

    // Motion
    let motion = 0;
    if (_prevPx) {
      for (let i = 0; i < px.length; i += 8)
        motion += Math.abs(px[i]-_prevPx[i]) + Math.abs(px[i+1]-_prevPx[i+1]) + Math.abs(px[i+2]-_prevPx[i+2]);
      motion = Math.min(1, (motion/(n/2))/255*5);
    } else { motion = 0.3; }
    _prevPx = new Uint8ClampedArray(px);

    // Face landmarks
    if (_faceReady && _tick % 3 === 0) {
      try {
        const det = await faceapi.detectSingleFace(_analysisCanvas, _detOpts).withFaceLandmarks(true);
        if (det) {
          const lm  = det.landmarks.positions;
          const box = det.detection.box;

          const mW = Math.abs(lm[54].x - lm[48].x) || 1;
          const mH = Math.abs(lm[57].y - lm[51].y);
          _lastFace.smile = Math.min(1, (mH/mW)*4);

          const bDist = ((Math.abs(lm[19].y-lm[37].y)+Math.abs(lm[24].y-lm[44].y))/2);
          _lastFace.brow = Math.min(1, Math.max(0,(bDist-8)/25));

          const lec = { x:(lm[36].x+lm[39].x)/2, y:(lm[36].y+lm[39].y)/2 };
          const rec = { x:(lm[42].x+lm[45].x)/2, y:(lm[42].y+lm[45].y)/2 };
          _lastFace.tilt = Math.min(1, Math.abs(Math.atan2(rec.y-lec.y,rec.x-lec.x)*180/Math.PI)/18);

          const cx = (lm[0].x+lm[16].x)/2;
          let asym = 0;
          for (let p = 0; p < 8; p++) asym += Math.abs(Math.abs(lm[p].x-cx)-Math.abs(lm[16-p].x-cx));
          _lastFace.symmetry  = Math.max(0, 1-asym/8/12);
          _lastFace.faceSize  = Math.min(1, (box.width*box.height)/(160*120)*6);

          _drawDots(lm, box);
        } else {
          _clearDots();
        }
      } catch(e) { /* skip */ }
    }

    // Composite
    const sigs = {
      vibrancy, warmth, motion,
      smile:    _lastFace.smile,
      brow:     _lastFace.brow,
      tilt:     _lastFace.tilt,
      symmetry: _lastFace.symmetry,
      faceSize: _lastFace.faceSize,
    };
    const W = { vibrancy:.12, warmth:.08, motion:.10, smile:.22, brow:.16, tilt:.10, symmetry:.12, faceSize:.10 };
    let raw = 0;
    for (const [k,w] of Object.entries(W)) raw += (sigs[k]??0.5)*w;

    const sigmoid = 1/(1+Math.exp(-7*(raw-0.5)));
    _target = Math.max(1, Math.min(10, 1 + sigmoid*9));
    _score  = _score*0.85 + _target*0.15;
    _smooth = Math.max(1, Math.min(10, _score));

    // Track history
    _scoreHistory.push(Math.round(_smooth*10)/10);
    if (_scoreHistory.length > 30) _scoreHistory.shift();

    _tick++;
    if (_onScore) _onScore(Math.round(_smooth*10)/10);
  }

  // Check if score has been stable in last N readings (within threshold)
  function isStable(readings, threshold) {
    if (_scoreHistory.length < readings) return false;
    const recent = _scoreHistory.slice(-readings);
    const mn = Math.min(...recent), mx = Math.max(...recent);
    return (mx - mn) <= threshold;
  }

  // Public
  async function start(videoEl, overlayCanvasEl, cb) {
    _video          = videoEl;
    _overlayCanvas  = overlayCanvasEl;
    _onScore        = cb;
    _analysisCanvas        = document.createElement('canvas');
    _analysisCanvas.width  = 160;
    _analysisCanvas.height = 120;
    _actx = _analysisCanvas.getContext('2d', { willReadFrequently: true });
    await _loadModels();
    _interval = setInterval(_analyze, 600);
  }

  function stop()       { if (_interval) { clearInterval(_interval); _interval = null; } _clearDots(); }
  function getScore()   { return Math.round(_smooth*10)/10; }
  function hideDots()   { _dotsVisible = false; _clearDots(); }
  function showDots()   { _dotsVisible = true; }

  // Returns true if last `readings` scores are within `threshold` of each other
  function checkStability(readings=8, threshold=0.6) { return isStable(readings, threshold); }
  function getHistory()  { return [..._scoreHistory]; }

  return { start, stop, getScore, hideDots, showDots, checkStability, getHistory };
})();
