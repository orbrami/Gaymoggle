/**
 * GAY-O-METER™ v3 — Real Face Analysis Engine
 * Now returns landmarks to caller for dot overlay rendering
 */

const GayOMeter = (() => {
  let _video     = null;
  let _canvas    = null;
  let _ctx       = null;
  let _interval  = null;
  let _prevPx    = null;
  let _score     = 5.0;
  let _smooth    = 5.0;
  let _onScore   = null;
  let _faceReady = false;
  let _detOpts   = null;
  let _tick      = 0;
  let _lastFaceSigs = { smile:0.5, brow:0.5, tilt:0.2, symmetry:0.7, faceSize:0.4 };
  let _lastLandmarks = [];

  async function _loadModels() {
    if (typeof faceapi === 'undefined') return;
    try {
      const M = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
      await faceapi.nets.tinyFaceDetector.loadFromUri(M);
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri(M);
      _detOpts   = new faceapi.TinyFaceDetectorOptions({ inputSize:128, scoreThreshold:0.35 });
      _faceReady = true;
    } catch(e) {
      console.warn('GayOMeter: face-api failed, pixel-only mode:', e.message);
    }
  }

  async function _analyze() {
    if (!_video || _video.readyState < 2 || !_video.videoWidth) return;

    _ctx.drawImage(_video, 0, 0, 160, 120);
    const img = _ctx.getImageData(0, 0, 160, 120);
    const px  = img.data;
    const n   = px.length / 4;

    // 1. Color vibrancy
    let satSum = 0;
    for (let i=0; i<px.length; i+=16) {
      const r=px[i]/255, g=px[i+1]/255, b=px[i+2]/255;
      const max=Math.max(r,g,b), min=Math.min(r,g,b);
      satSum += max===0 ? 0 : (max-min)/max;
    }
    const vibrancy = satSum/(n/4);

    // 2. Warm/pink
    let warmPx=0;
    for (let i=0; i<px.length; i+=8) {
      const r=px[i], g=px[i+1], b=px[i+2];
      if (r>160&&g<100&&b>110) warmPx++;
      if (r>170&&g<80)         warmPx+=0.5;
    }
    const warmth = Math.min(1,(warmPx/(n/2))*12);

    // 3. Motion
    let motion=0;
    if (_prevPx) {
      for (let i=0; i<px.length; i+=8)
        motion += Math.abs(px[i]-_prevPx[i])+Math.abs(px[i+1]-_prevPx[i+1])+Math.abs(px[i+2]-_prevPx[i+2]);
      motion = Math.min(1,(motion/(n/2))/255*5);
    } else { motion=0.3; }
    _prevPx = new Uint8ClampedArray(px);

    // 4. Face landmarks (every 3rd tick)
    if (_faceReady && _tick%3===0) {
      try {
        const det = await faceapi
          .detectSingleFace(_canvas, _detOpts)
          .withFaceLandmarks(true);
        if (det) {
          const lm = det.landmarks.positions;
          _lastLandmarks = lm;
          const mW = Math.abs(lm[54].x-lm[48].x)||1;
          const mH = Math.abs(lm[57].y-lm[51].y);
          _lastFaceSigs.smile = Math.min(1,(mH/mW)*4);
          const bDist = ((Math.abs(lm[19].y-lm[37].y)+Math.abs(lm[24].y-lm[44].y))/2);
          _lastFaceSigs.brow  = Math.min(1,Math.max(0,(bDist-8)/25));
          const lec = {x:(lm[36].x+lm[39].x)/2, y:(lm[36].y+lm[39].y)/2};
          const rec = {x:(lm[42].x+lm[45].x)/2, y:(lm[42].y+lm[45].y)/2};
          const angle = Math.abs(Math.atan2(rec.y-lec.y, rec.x-lec.x)*180/Math.PI);
          _lastFaceSigs.tilt  = Math.min(1, angle/18);
          const cx = (lm[0].x+lm[16].x)/2;
          let asym=0;
          for (let p=0;p<8;p++) asym+=Math.abs(Math.abs(lm[p].x-cx)-Math.abs(lm[16-p].x-cx));
          _lastFaceSigs.symmetry = Math.max(0,1-asym/8/12);
          const box = det.detection.box;
          _lastFaceSigs.faceSize = Math.min(1,(box.width*box.height)/(160*120)*6);
        }
      } catch(e) {}
    }

    const W = { vibrancy:0.12, warmth:0.08, motion:0.10, smile:0.22, brow:0.16, tilt:0.10, symmetry:0.12, faceSize:0.10 };
    const sigs = { vibrancy, warmth, motion, smile:_lastFaceSigs.smile, brow:_lastFaceSigs.brow, tilt:_lastFaceSigs.tilt, symmetry:_lastFaceSigs.symmetry, faceSize:_lastFaceSigs.faceSize };
    let raw=0;
    for (const [k,w] of Object.entries(W)) raw+=(sigs[k]??0.5)*w;
    const sigmoid = 1/(1+Math.exp(-7*(raw-0.5)));
    const target  = 1+sigmoid*9;
    _score  = _score*0.85+target*0.15;
    _smooth = Math.max(1,Math.min(10,_score));
    _tick++;
    if (_onScore) _onScore(Math.round(_smooth*10)/10, _lastLandmarks);
  }

  async function start(videoEl, cb) {
    _video   = videoEl;
    _onScore = cb;
    _canvas        = document.createElement('canvas');
    _canvas.width  = 160;
    _canvas.height = 120;
    _ctx = _canvas.getContext('2d', { willReadFrequently:true });
    await _loadModels();
    _interval = setInterval(_analyze, 600);
  }

  function stop() {
    if (_interval) { clearInterval(_interval); _interval=null; }
    _lastLandmarks = [];
  }

  function getScore() { return Math.round(_smooth*10)/10; }

  return { start, stop, getScore };
})();
