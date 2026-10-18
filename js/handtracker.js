import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const TIPS = [4, 8, 12, 16, 20];
const FINGER_JOINTS = [
  { tip: 4, pip: 3, mcp: 2 },
  { tip: 8, pip: 6, mcp: 5 },
  { tip: 12, pip: 10, mcp: 9 },
  { tip: 16, pip: 14, mcp: 13 },
  { tip: 20, pip: 18, mcp: 17 },
];

const MODEL_URL = new URL('../vendor/models/hand_landmarker.task', import.meta.url).href;
const WASM_URL = new URL('../vendor/mediapipe/wasm', import.meta.url).href.replace(/\/$/, '');

export class HandTracker {
  constructor({ video, overlay, onHand, onStatus, onError }) {
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay ? overlay.getContext('2d') : null;
    this.onHand = onHand || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});

    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.raf = 0;
    this.delegate = 'GPU';
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    this.missedFrames = 0;
    this.prev = null;
    this.lastHand = null;
    this.smoothed = null;
    this.palmWidth = 0.2;
    this.overlayWidth = 0;
    this.overlayHeight = 0;
    this.status = '';
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  async start() {
    if (this.running) return;
    this.setStatus('model');

    try {
      this.landmarker = await this.createLandmarker('GPU');
    } catch (gpuError) {
      console.warn('[handtracker] GPU delegate unavailable, falling back to CPU.', gpuError);
      this.delegate = 'CPU';
      this.landmarker = await this.createLandmarker('CPU');
    }

    this.setStatus('camera');
    try {
      await this.startCamera();
    } catch (error) {
      await this.closeLandmarker();
      throw error;
    }

    this.running = true;
    this.setStatus('ready');
    this.loop();
  }

  async createLandmarker(delegate) {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate,
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    });
  }

  async startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const error = new Error('当前浏览器不支持摄像头访问');
      error.name = 'NotSupportedError';
      throw error;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 30, max: 30 },
      },
    });

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;

    if (this.video.readyState < 1) {
      await new Promise((resolve, reject) => {
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('摄像头画面加载失败'));
        };
        const cleanup = () => {
          this.video.removeEventListener('loadedmetadata', onLoaded);
          this.video.removeEventListener('error', onError);
        };
        this.video.addEventListener('loadedmetadata', onLoaded, { once: true });
        this.video.addEventListener('error', onError, { once: true });
      });
    }

    await this.video.play();
  }

  loop() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this.loop());
    if (!this.landmarker || this.video.readyState < 2) return;

    const now = performance.now();
    if (now - this.lastTimestamp < 22) return;

    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      this.lastTimestamp = now;
      try {
        const result = this.landmarker.detectForVideo(this.video, now);
        this.handleResult(result);
      } catch (error) {
        console.error('[handtracker] detectForVideo failed', error);
        this.onError(error);
        this.running = false;
      }
    }
  }

  handleResult(result) {
    const landmarks = result?.landmarks?.[0];
    if (!landmarks || landmarks.length < 21) {
      this.missedFrames += 1;
      if (this.missedFrames === 4) {
        this.smoothed = null;
        this.lastHand = null;
        this.clearOverlay();
        this.onHand(null);
        this.setStatus('searching');
      }
      return;
    }

    this.missedFrames = 0;
    this.setStatus('tracking');

    const aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight);
    const points = landmarks.map((point) => ({
      x: 1 - point.x,
      y: point.y,
      z: point.z ?? 0,
    }));

    const metric = points.map((p) => ({ x: p.x * aspect, y: p.y }));
    const palm = this.getPalm(points);
    const palmWidth = Math.max(
      0.04,
      Math.hypot(metric[5].x - metric[17].x, metric[5].y - metric[17].y)
    );
    this.palmWidth = palmWidth;

    const scores = [];
    for (let i = 0; i < 5; i++) {
      const { tip, pip } = FINGER_JOINTS[i];
      const tipDistance = Math.hypot(metric[tip].x - metric[0].x, metric[tip].y - metric[0].y);
      const pipDistance = Math.hypot(metric[pip].x - metric[0].x, metric[pip].y - metric[0].y);
      const reach = tipDistance / Math.max(0.001, pipDistance);

      if (i === 0) {
        const thumbDistance = Math.hypot(
          metric[4].x - metric[5].x,
          metric[4].y - metric[5].y
        ) / palmWidth;
        const thumbReach = reach;
        scores.push(
          clamp(
            0.65 * smoothstep(0.42, 0.95, thumbDistance) +
              0.35 * smoothstep(0.9, 1.28, thumbReach),
            0,
            1
          )
        );
      } else {
        scores.push(smoothstep(1.02, 1.42, reach));
      }
    }

    const openness = scores.reduce((sum, score) => sum + score, 0) / 5;
    const fingerScore = (scores[1] + scores[2] + scores[3] + scores[4]) / 4;

    let spreadDistance = 0;
    for (const tip of [8, 12, 16, 20]) {
      spreadDistance += Math.hypot(
        metric[tip].x - (palm.x * aspect),
        metric[tip].y - palm.y
      );
    }
    spreadDistance /= 4;
    const spread = spreadDistance / palmWidth;
    const spreadScore = smoothstep(0.5, 1.02, spread);

    const rawBloom = clamp(
      0.82 * smoothstep(0.1, 0.7, openness) +
        0.18 * spreadScore,
      0,
      1
    );

    const roll = clamp(
      Math.atan2(
        (metric[9].x - metric[0].x),
        Math.max(0.02, metric[0].y - metric[9].y)
      ),
      -1.1,
      1.1
    );

    const tips = TIPS.map((index) => ({
      x: points[index].x,
      y: points[index].y,
      z: points[index].z,
    }));

    const hand = {
      visible: true,
      palm: {
        x: clamp(palm.x, 0.03, 0.97),
        y: clamp(palm.y, 0.04, 0.96),
        z: 0,
      },
      tips,
      landmarks: points,
      roll,
      openness,
      fingerScore,
      spread,
      palmWidth,
      bloom: rawBloom,
      fingers: scores.map((score) => score > 0.45),
      scores,
      confidence: result?.handednesses?.[0]?.[0]?.score ?? 1,
      handedness: result?.handednesses?.[0]?.[0]?.categoryName ?? 'Unknown',
      aspect,
    };

    const smoothed = this.smoothHand(hand);
    this.lastHand = smoothed;
    this.drawOverlay(smoothed);
    this.onHand(smoothed);
  }

  getPalm(points) {
    const ids = [0, 5, 9, 13, 17];
    let x = 0;
    let y = 0;
    for (const id of ids) {
      x += points[id].x;
      y += points[id].y;
    }
    x /= ids.length;
    y /= ids.length;
    // Nudge toward the knuckles, where the flower feels most naturally rooted.
    return {
      x: x + (points[9].x - points[0].x) * 0.18,
      y: y + (points[9].y - points[0].y) * 0.18,
    };
  }

  smoothHand(hand) {
    if (!this.smoothed) {
      this.smoothed = {
        palm: { ...hand.palm },
        tips: hand.tips.map((tip) => ({ ...tip })),
        bloom: hand.bloom,
        roll: hand.roll,
        openness: hand.openness,
        landmarks: hand.landmarks.map((p) => ({ ...p })),
      };
      return { ...hand, ...this.smoothed };
    }

    const alpha = 0.52;
    const prev = this.smoothed;
    const palm = {
      x: prev.palm.x + (hand.palm.x - prev.palm.x) * alpha,
      y: prev.palm.y + (hand.palm.y - prev.palm.y) * alpha,
      z: 0,
    };
    const tips = hand.tips.map((tip, i) => ({
      x: prev.tips[i].x + (tip.x - prev.tips[i].x) * alpha,
      y: prev.tips[i].y + (tip.y - prev.tips[i].y) * alpha,
      z: prev.tips[i].z + (tip.z - prev.tips[i].z) * alpha,
    }));
    const landmarks = hand.landmarks.map((p, i) => ({
      x: prev.landmarks[i].x + (p.x - prev.landmarks[i].x) * alpha,
      y: prev.landmarks[i].y + (p.y - prev.landmarks[i].y) * alpha,
      z: prev.landmarks[i].z + (p.z - prev.landmarks[i].z) * alpha * 0.4,
    }));

    this.smoothed = {
      palm,
      tips,
      landmarks,
      bloom: prev.bloom + (hand.bloom - prev.bloom) * 0.38,
      roll: prev.roll + (hand.roll - prev.roll) * 0.32,
      openness: prev.openness + (hand.openness - prev.openness) * 0.4,
    };

    return { ...hand, ...this.smoothed };
  }

  resizeOverlay() {
    if (!this.overlay || !this.video.videoWidth) return;
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (width === this.overlayWidth && height === this.overlayHeight) return;
    this.overlayWidth = width;
    this.overlayHeight = height;
    this.overlay.width = width;
    this.overlay.height = height;
  }

  drawOverlay(hand) {
    this.resizeOverlay();
    const ctx = this.ctx;
    if (!ctx) return;
    const width = this.overlay.width;
    const height = this.overlay.height;
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    if (!hand) return;

    const scale = Math.max(1, width / 640);
    const toCanvas = (p) => ({ x: p.x * width, y: p.y * height });
    const connections = HandLandmarker.HAND_CONNECTIONS || [];

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 176, 207, 0.55)';
    ctx.lineWidth = 1.7 * scale;
    for (const connection of connections) {
      const start = toCanvas(hand.landmarks[connection.start ?? connection[0]]);
      const end = toCanvas(hand.landmarks[connection.end ?? connection[1]]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }

    ctx.shadowColor = 'rgba(255, 151, 193, 0.95)';
    ctx.shadowBlur = 10 * scale;
    for (let i = 0; i < hand.landmarks.length; i++) {
      const p = toCanvas(hand.landmarks[i]);
      const isTip = TIPS.includes(i);
      ctx.beginPath();
      ctx.fillStyle = isTip ? 'rgba(255, 239, 219, 0.98)' : 'rgba(255, 203, 224, 0.86)';
      ctx.arc(p.x, p.y, (isTip ? 4.4 : 2.4) * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    const palm = toCanvas(hand.palm);
    ctx.shadowBlur = 18 * scale;
    ctx.strokeStyle = 'rgba(255, 218, 173, 0.55)';
    ctx.lineWidth = 1.3 * scale;
    ctx.beginPath();
    ctx.arc(palm.x, palm.y, (12 + hand.bloom * 9) * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  clearOverlay() {
    if (!this.ctx || !this.overlay) return;
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  async closeLandmarker() {
    if (!this.landmarker) return;
    try {
      await this.landmarker.close();
    } catch (error) {
      console.warn('[handtracker] failed to close landmarker', error);
    }
    this.landmarker = null;
  }

  async stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.clearOverlay();
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    await this.closeLandmarker();
    this.smoothed = null;
    this.lastHand = null;
    this.lastVideoTime = -1;
  }
}
