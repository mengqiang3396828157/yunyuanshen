import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Canvas textures                                                     */
/* ------------------------------------------------------------------ */

function makeGlowTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.12, 'rgba(255,255,255,0.92)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.34)');
  gradient.addColorStop(0.62, 'rgba(255,255,255,0.07)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function makeHaloTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, size * 0.06, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,0.16)');
  gradient.addColorStop(0.32, 'rgba(255,255,255,0.11)');
  gradient.addColorStop(0.62, 'rgba(255,255,255,0.035)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

const BACKGROUND_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BACKGROUND_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = uv - 0.5;
    float aspect = 1.65;
    vec2 q = p * vec2(aspect, 1.0);

    vec3 deep = vec3(0.012, 0.008, 0.026);
    vec3 lift = vec3(0.042, 0.021, 0.064);
    float center = smoothstep(0.92, 0.08, length(q));
    vec3 color = mix(deep, lift, center * 0.9);

    float rose = exp(-length((uv - vec2(0.79, 0.64)) * vec2(1.15, 1.0)) * 4.2);
    color += vec3(0.23, 0.055, 0.16) * rose * 0.42;

    float violet = exp(-length((uv - vec2(0.18, 0.25)) * vec2(1.2, 1.4)) * 4.8);
    color += vec3(0.035, 0.07, 0.22) * violet * 0.38;

    float hearth = exp(-length((uv - vec2(0.5, 0.48)) * vec2(0.72, 1.6)) * 4.5);
    color += vec3(0.13, 0.035, 0.1) * hearth * 0.3;

    float aura = exp(-length(uv - vec2(0.62, 0.47)) * 3.1);
    color += vec3(0.16, 0.05, 0.12) * aura * 0.18;

    float grain = hash21(uv * 980.0 + uTime * 0.04) - 0.5;
    color += grain * 0.012;

    float vignette = smoothstep(1.2, 0.18, length(q * vec2(1.0, 1.22)));
    color *= 0.45 + 0.55 * vignette;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const FLOWER_VERT = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uBloom;
  uniform float uPixelRatio;
  uniform float uTipStrength;
  uniform vec3 uTips[5];

  attribute vec3 aBud;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  attribute float aDelay;
  attribute float aLayer;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vGlow;

  float ease(float x) {
    return x * x * (3.0 - 2.0 * x);
  }

  void main() {
    float p = ease(clamp((uBloom - aDelay) / 0.32, 0.0, 1.0));
    vec3 pos = mix(aBud, position, p);

    // Slow unfurling swirl as the flower leaves its bud state.
    float burst = sin(p * 3.14159265);
    pos.xy += vec2(-pos.y, pos.x) * (0.105 * burst) * (0.45 + 0.55 * sin(aSeed * 6.283));

    // Breathing and organic drift.
    pos.xy *= 1.0 + 0.013 * sin(uTime * 0.78 + aSeed * 6.283 + aLayer * 0.9);
    pos.z += 0.034 * sin(uTime * 1.15 + aSeed * 8.0);
    pos.z += 0.02 * sin(uTime * 0.55 + aLayer * 4.0);

    vec4 world = modelMatrix * vec4(pos, 1.0);
    float glow = 0.0;
    // The pollen heart is a separate layer and must stay put; the fingertip
    // may stir the petals, but pushing the core aside reads as a hole.
    float coreMask = 1.0 - step(-0.5, aLayer);
    // Only the broad outer ring yields to a fingertip. The middle/inner rings
    // and pollen heart stay put so the throat never opens into a black hole.
    float pushMask = (1.0 - coreMask) * (1.0 - smoothstep(0.12, 0.38, aLayer));

    for (int i = 0; i < 5; i++) {
      vec3 d = world.xyz - uTips[i];
      float dl = length(d.xy);
      float infl = exp(-dl * dl * 5.0) * uTipStrength;
      float ripple = 0.72 + 0.28 * sin(uTime * 3.4 + aSeed * 22.0);
      world.xy += normalize(d.xy + vec2(0.0008)) * infl * 0.075 * ripple * pushMask;
      world.z += infl * 0.045 * sin(aSeed * 31.0 + uTime * 2.1) * pushMask;
      glow += infl;
    }
    glow = clamp(glow, 0.0, 1.5);

    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;

    float size = aSize * (0.82 + 0.32 * p) * (1.0 + 0.1 * sin(uTime * 1.8 + aSeed * 40.0));
    gl_PointSize = clamp(size * uPixelRatio * (14.0 / max(1.0, -mv.z)), 1.0, 24.0);

    vColor = mix(aColor * 0.5, aColor * (1.0 + 0.12 * p), p);
    vColor = mix(vColor, vec3(1.0, 0.78, 0.48), min(glow * 0.42, 0.55));

    // A few gold glints travel across the petals, then a cool falloff toward
    // the back gives the cloud real depth as the flower turns in 3D.
    float glint = pow(max(0.0, sin(uTime * 1.3 + aSeed * 53.0)), 14.0);
    vColor += vec3(1.0, 0.82, 0.5) * glint * 0.3 * p;
    float depth = smoothstep(-9.4, -6.5, mv.z);
    vColor = mix(vColor * vec3(0.6, 0.52, 0.76), vColor, depth);
    vColor += vec3(0.03, 0.01, 0.055) * (1.0 - depth);

    vAlpha = (0.24 + 0.28 * p) * (0.82 + 0.18 * sin(aSeed * 19.0 + uTime * 0.85));
    vAlpha += glint * 0.05 * p;
    vGlow = glow + 0.08 * p;
  }
`;

const FLOWER_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vGlow;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.2, d);
    alpha = pow(alpha, 1.45);
    float core = smoothstep(0.16, 0.0, d);
    vec3 color = vColor + core * vec3(0.62, 0.4, 0.18) * vGlow;
    gl_FragColor = vec4(color, alpha * vAlpha);
  }
`;

const MOTE_VERT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uBloom;
  uniform float uPixelRatio;
  attribute float aSeed;
  attribute float aRadius;
  attribute float aSpeed;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float angle = aSeed * 6.2831853 + uTime * aSpeed;
    float radius = mix(1.15, 4.35, aRadius) * (0.82 + 0.18 * sin(uTime * 0.25 + aSeed * 9.0));
    vec3 pos;
    pos.x = cos(angle) * radius;
    pos.y = sin(angle) * radius * 0.62 + sin(uTime * 0.42 + aSeed * 13.0) * 0.32;
    pos.z = sin(angle * 1.63 + aSeed * 11.0) * (0.45 + aRadius * 0.95);

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;

    float size = aSize * uPixelRatio * (5.4 / max(1.0, -mv.z));
    gl_PointSize = clamp(size, 1.0, 8.0);

    vColor = aColor;
    vAlpha = (0.16 + 0.6 * uBloom) * (0.36 + 0.64 * aSeed) * (0.7 + 0.3 * sin(uTime * 2.0 + aSeed * 25.0));
  }
`;

const MOTE_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.02, d);
    a *= a;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

const BURST_VERT = /* glsl */ `
  precision highp float;
  uniform float uPixelRatio;
  attribute float aLife;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    if (aLife <= 0.001) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      vColor = aColor;
      return;
    }
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * aLife * uPixelRatio * (7.0 / max(1.0, -mv.z)), 0.0, 12.0);
    vColor = aColor;
    vAlpha = aLife;
  }
`;

const BURST_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.18, 0.0, d);
    gl_FragColor = vec4(vColor + core * 0.55, a * vAlpha);
  }
`;

/* ------------------------------------------------------------------ */
/* Burst particles                                                     */
/* ------------------------------------------------------------------ */

const BURST_MAX = 1900;

class BurstField {
  constructor(scene, pixelRatio) {
    this.count = BURST_MAX;
    this.cursor = 0;
    this.positions = new Float32Array(BURST_MAX * 3);
    this.velocities = new Float32Array(BURST_MAX * 3);
    this.life = new Float32Array(BURST_MAX);
    this.maxLife = new Float32Array(BURST_MAX);
    this.sizes = new Float32Array(BURST_MAX);
    this.colors = new Float32Array(BURST_MAX * 3);
    this.alpha = new Float32Array(BURST_MAX);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aLife', new THREE.BufferAttribute(this.alpha, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: pixelRatio } },
      vertexShader: BURST_VERT,
      fragmentShader: BURST_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);

    this.geometry = geometry;
    this.palette = [
      new THREE.Color('#ffd7a1'),
      new THREE.Color('#ffae76'),
      new THREE.Color('#ff7eb3'),
      new THREE.Color('#ff3f8f'),
      new THREE.Color('#b78cff'),
      new THREE.Color('#fff0da'),
    ];
    this.random = mulberry32(87123);
    this.emitAccumulator = 0;
  }

  setPixelRatio(ratio) {
    this.material.uniforms.uPixelRatio.value = ratio;
  }

  spawn(origin, amount, options = {}) {
    const power = options.power ?? 1;
    const bias = options.bias ?? { x: 0, y: 0.35 };
    const spread = options.spread ?? 1;
    for (let n = 0; n < amount; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % BURST_MAX;

      const i3 = i * 3;
      this.positions[i3] = origin.x + (this.random() - 0.5) * 0.14;
      this.positions[i3 + 1] = origin.y + (this.random() - 0.5) * 0.14;
      this.positions[i3 + 2] = origin.z + (this.random() - 0.5) * 0.14;

      const angle = this.random() * TAU;
      const radial = 0.18 + this.random() * 1.25;
      const speed = (0.35 + this.random() * 1.2) * power;
      this.velocities[i3] = Math.cos(angle) * radial * speed + bias.x * power;
      this.velocities[i3 + 1] = Math.sin(angle) * radial * speed * 0.78 + bias.y * power;
      this.velocities[i3 + 2] = (this.random() - 0.35) * 0.8 * speed;

      const life = (1.15 + this.random() * 1.7) * (0.8 + power * 0.2);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.alpha[i] = 1;
      this.sizes[i] = (0.9 + this.random() * 2.2) * spread;

      const color = this.palette[(this.random() * this.palette.length) | 0];
      this.colors[i3] = color.r;
      this.colors[i3 + 1] = color.g;
      this.colors[i3 + 2] = color.b;
    }
  }

  update(dt) {
    const pos = this.positions;
    const vel = this.velocities;
    for (let i = 0; i < BURST_MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const i3 = i * 3;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const drag = Math.max(0, 1 - 1.55 * dt);
      vel[i3] *= drag;
      vel[i3 + 1] = vel[i3 + 1] * drag + 0.035 * dt;
      vel[i3 + 2] *= drag;
      this.alpha[i] = this.life[i] / this.maxLife[i];
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aLife.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* Main scene                                                          */
/* ------------------------------------------------------------------ */

export class FlowerScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'idle';
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.aspect = window.innerWidth / window.innerHeight;
    this.isMobile = window.matchMedia('(max-width: 760px)').matches;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.75 : 2);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setClearColor(0x05030a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, this.aspect, 0.1, 80);
    this.camera.position.set(0, 0.15, 7.6);
    this.camera.lookAt(0, 0, 0);

    this.glowTexture = makeGlowTexture(256);
    this.haloTexture = makeHaloTexture(512);

    this.mouse = new THREE.Vector2(0, 0);
    this.targetMouse = new THREE.Vector2(0, 0);
    this.currentBloom = 0.88;
    this.targetBloom = 0.88;
    this.handVisible = false;
    this.lastHandTime = -10;
    this.roll = 0;
    this.targetRoll = 0;
    this.tiltX = 0;
    this.targetTiltX = 0;
    this.tiltY = 0;
    this.targetTiltY = 0;
    this.tipStrength = 0;
    this.targetTipStrength = 0;
    this.worldTips = Array.from({ length: 5 }, () => new THREE.Vector3(99, 99, 0));
    this.targetPosition = new THREE.Vector3();
    this.demoPointer = { x: 0, y: 0, active: false };
    this.demoHolding = false;
    this.bloomOverride = null;
    this.prevBloom = 0.88;
    this.emitCursor = 0;
    this.lastGesture = 'transition';
    this.gesture = { state: 'none', label: '等待手掌', bloom: 0.88, fingers: [false, false, false, false, false] };
    this.onUpdate = null;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.buildBackdrop();
    this.buildStars();
    this.buildFlower();
    this.buildOrbit();
    this.buildMotes();
    this.buildAura();
    this.bursts = new BurstField(this.scene, this.pixelRatio);
    this.buildTipLights();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.isMobile ? 0.36 : 0.44,
      0.6,
      0.36
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.targetPosition.set(this.getIdleOffset(), 0.08, 0);
    this.flowerGroup.position.copy(this.targetPosition);
    this.flowerGroup.rotation.set(-0.02, 0.05, 0.02);

    this.raf = 0;
    this.running = true;
    this.render = this.render.bind(this);
    this.raf = requestAnimationFrame(this.render);
  }

  /* ---------------------------------------------------------------- */
  /* Construction                                                     */
  /* ---------------------------------------------------------------- */

  buildBackdrop() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.backgroundMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: BACKGROUND_VERT,
      fragmentShader: BACKGROUND_FRAG,
      depthWrite: false,
      depthTest: false,
    });
    this.background = new THREE.Mesh(geometry, this.backgroundMaterial);
    this.background.position.set(0, 0, -12);
    this.background.renderOrder = -100;
    this.background.frustumCulled = false;
    this.scene.add(this.background);
  }

  buildStars() {
    const random = mulberry32(55401);
    const groups = [
      { count: 520, size: 0.055, color: '#d9c9ff', opacity: 0.54, range: [13, 8, 7, 18] },
      { count: 190, size: 0.095, color: '#ffd8b8', opacity: 0.45, range: [10, 7, 5, 15] },
    ];
    this.starGroups = [];
    for (const cfg of groups) {
      const positions = new Float32Array(cfg.count * 3);
      const colors = new Float32Array(cfg.count * 3);
      const base = new THREE.Color(cfg.color);
      for (let i = 0; i < cfg.count; i++) {
        positions[i * 3] = (random() - 0.5) * cfg.range[0] * 2;
        positions[i * 3 + 1] = (random() - 0.5) * cfg.range[1] * 2;
        positions[i * 3 + 2] = -cfg.range[2] - random() * cfg.range[3];
        const tint = 0.55 + random() * 0.45;
        colors[i * 3] = base.r * tint;
        colors[i * 3 + 1] = base.g * tint;
        colors[i * 3 + 2] = base.b * tint;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const material = new THREE.PointsMaterial({
        size: cfg.size,
        sizeAttenuation: true,
        map: this.glowTexture,
        transparent: true,
        opacity: cfg.opacity,
        vertexColors: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      this.scene.add(points);
      this.starGroups.push(points);
    }
  }

  buildFlower() {
    this.flowerGroup = new THREE.Group();
    this.scene.add(this.flowerGroup);

    const data = this.generateFlowerGeometry();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.open, 3));
    geometry.setAttribute('aBud', new THREE.Float32BufferAttribute(data.bud, 3));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(data.colors, 3));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(data.sizes, 1));
    geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(data.seeds, 1));
    geometry.setAttribute('aDelay', new THREE.Float32BufferAttribute(data.delays, 1));
    geometry.setAttribute('aLayer', new THREE.Float32BufferAttribute(data.layers, 1));

    this.flowerMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBloom: { value: 0.88 },
        uPixelRatio: { value: this.pixelRatio },
        uTipStrength: { value: 0 },
        uTips: { value: this.worldTips },
      },
      vertexShader: FLOWER_VERT,
      fragmentShader: FLOWER_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.flowerPoints = new THREE.Points(geometry, this.flowerMaterial);
    this.flowerPoints.frustumCulled = false;
    this.flowerPoints.renderOrder = 2;
    this.flowerGroup.add(this.flowerPoints);
    this.flowerCount = data.open.length / 3;

    // Decorative orbital arcs around the flower.
    this.arcs = [];
    const arcConfigs = [
      { radius: 2.55, color: '#ff9ec6', opacity: 0.22, start: 0.2, length: 1.55, speed: 0.012, tilt: 0.04 },
      { radius: 2.92, color: '#b89cff', opacity: 0.16, start: 2.7, length: 0.78, speed: -0.008, tilt: -0.05 },
      { radius: 3.18, color: '#ffd29d', opacity: 0.12, start: 4.25, length: 0.44, speed: 0.006, tilt: 0.07 },
    ];
    for (const cfg of arcConfigs) {
      const points = [];
      const segments = Math.max(24, Math.floor(cfg.length * 64));
      for (let i = 0; i <= segments; i++) {
        const a = cfg.start + (i / segments) * cfg.length;
        points.push(new THREE.Vector3(Math.cos(a) * cfg.radius, Math.sin(a) * cfg.radius, 0));
      }
      const geometryArc = new THREE.BufferGeometry().setFromPoints(points);
      const materialArc = new THREE.LineBasicMaterial({
        color: new THREE.Color(cfg.color),
        transparent: true,
        opacity: cfg.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const arc = new THREE.Line(geometryArc, materialArc);
      arc.rotation.x = cfg.tilt;
      arc.rotation.y = cfg.tilt * 2.2;
      arc.userData.speed = cfg.speed;
      arc.userData.baseOpacity = cfg.opacity;
      this.flowerGroup.add(arc);
      this.arcs.push(arc);
    }
  }

  buildOrbit() {
    this.orbitGroup = new THREE.Group();
    this.orbitGroup.rotation.set(0.36, -0.24, 0.12);
    this.orbitRadius = 2.18;
    this.orbitTrailCount = 30;
    this.orbitAngle = 0.72;

    // A barely-there ring gives the comet a path without boxing the flower in.
    const ringPoints = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * TAU;
      ringPoints.push(new THREE.Vector3(Math.cos(a) * this.orbitRadius, Math.sin(a) * this.orbitRadius, 0));
    }
    const ringGeometry = new THREE.BufferGeometry().setFromPoints(ringPoints);
    const ringMaterial = new THREE.LineBasicMaterial({
      color: 0xffd6a8,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.orbitRing = new THREE.Line(ringGeometry, ringMaterial);
    this.orbitGroup.add(this.orbitRing);

    // The comet trail is rebuilt in local space every frame, so a wrist roll
    // drags a visible streak around the flower even when its petals look
    // almost radially symmetric.
    const trailPositions = new Float32Array(this.orbitTrailCount * 3);
    const trailColors = new Float32Array(this.orbitTrailCount * 3);
    const gold = new THREE.Color('#ffd9a4');
    const violet = new THREE.Color('#c8a6ff');
    for (let i = 0; i < this.orbitTrailCount; i++) {
      const fade = Math.pow(1 - i / this.orbitTrailCount, 1.8);
      const color = violet.clone().lerp(gold, 1 - i / this.orbitTrailCount);
      trailColors[i * 3] = color.r * fade;
      trailColors[i * 3 + 1] = color.g * fade;
      trailColors[i * 3 + 2] = color.b * fade;
    }
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
    this.orbitTrail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.orbitGroup.add(this.orbitTrail);

    const headMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xffe3bb,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.orbitHead = new THREE.Sprite(headMaterial);
    this.orbitHead.scale.setScalar(0.22);
    this.orbitGroup.add(this.orbitHead);

    this.flowerGroup.add(this.orbitGroup);
  }

  updateOrbit(dt, time) {
    if (!this.orbitGroup) return;
    this.orbitGroup.visible = this.currentBloom > 0.2;
    if (!this.orbitGroup.visible) return;
    // On phones the landing flower sits close to the headline; drop the faint
    // orbit line there so it never draws a stroke through the display type.
    this.orbitRing.visible = !(this.isMobile && this.mode === 'idle');

    this.orbitAngle += dt * 0.08;
    const headAngle = this.orbitAngle + this.roll * 1.8;
    const positions = this.orbitTrail.geometry.attributes.position;
    for (let i = 0; i < this.orbitTrailCount; i++) {
      const a = headAngle - i * 0.045;
      positions.array[i * 3] = Math.cos(a) * this.orbitRadius;
      positions.array[i * 3 + 1] = Math.sin(a) * this.orbitRadius;
      positions.array[i * 3 + 2] = 0.02 + i * 0.002;
    }
    positions.needsUpdate = true;
    this.orbitHead.position.set(
      Math.cos(headAngle) * this.orbitRadius,
      Math.sin(headAngle) * this.orbitRadius,
      0.04
    );
    this.orbitHead.material.opacity = 0.72 + Math.sin(time * 2.2) * 0.16;
  }

  generateFlowerGeometry() {
    const open = [];
    const bud = [];
    const colors = [];
    const sizes = [];
    const seeds = [];
    const delays = [];
    const layers = [];
    const random = mulberry32(20260214);

    const stops = [
      { t: 0.0, color: new THREE.Color('#ffeccb') },
      { t: 0.2, color: new THREE.Color('#ffc79a') },
      { t: 0.42, color: new THREE.Color('#ff8fb2') },
      { t: 0.64, color: new THREE.Color('#ff4f98') },
      { t: 0.84, color: new THREE.Color('#d263ee') },
      { t: 1.0, color: new THREE.Color('#8b7bff') },
    ];
    const white = new THREE.Color('#fff5e4');
    const warm = new THREE.Color('#ffd39b');
    const rimColor = new THREE.Color('#ffbd8e');

    const mixedColor = (t, u, v, rim, vein, r) => {
      let lower = stops[0];
      let upper = stops[stops.length - 1];
      for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i].t && t <= stops[i + 1].t) {
          lower = stops[i];
          upper = stops[i + 1];
          break;
        }
      }
      const local = smoothstep(lower.t, upper.t, t);
      const color = lower.color.clone().lerp(upper.color, local);
      color.lerp(white, Math.pow(u, 2.4) * 0.1);
      color.lerp(rimColor, rim * 0.36);
      if (vein) color.lerp(warm, 0.16);
      if (r() < 0.018) color.lerp(white, 0.5);
      return color;
    };

    const addParticle = (openPos, budPos, color, size, delay, layer) => {
      open.push(openPos.x, openPos.y, openPos.z);
      bud.push(budPos.x, budPos.y, budPos.z);
      colors.push(color.r, color.g, color.b);
      sizes.push(size);
      seeds.push(random());
      delays.push(delay);
      layers.push(layer);
    };

    // Three deliberate rings read as a flower instead of a nebula: eight broad
    // outer petals, seven mid petals tucked between them, seven inner petals.
    // Each petal gets enough particles to actually fill its surface.
    const rings = [
      {
        petals: 8, count: 1750, t: 0.82, base: 0.34, length: 1.62, width: 0.54,
        cup: 0.2, droop: 0.34, z: -0.06, offset: 0.12 + Math.PI / 8, delay: 0.02,
      },
      {
        petals: 7, count: 1250, t: 0.46, base: 0.26, length: 1.12, width: 0.39,
        cup: 0.3, droop: 0.2, z: 0.13, offset: Math.PI / 7 + 0.1, delay: 0.23,
      },
      {
        petals: 7, count: 900, t: 0.14, base: 0.18, length: 0.74, width: 0.28,
        cup: 0.36, droop: 0.07, z: 0.3, offset: Math.PI / 7 + 0.22, delay: 0.44,
      },
    ];

    for (let l = 0; l < rings.length; l++) {
      const ring = rings[l];
      for (let p = 0; p < ring.petals; p++) {
        const angle = ring.offset + (p / ring.petals) * TAU + (random() - 0.5) * 0.035;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        for (let i = 0; i < ring.count; i++) {
          // Stratified sampling keeps the petal surface even; dedicated rim
          // grains draw a bright dotted contour around each petal.
          const stride = (i + 0.5) / ring.count;
          const isRim = i % 9 === 0;
          const isVein = !isRim && i % 19 === 0;
          const r = clamp(stride + (random() - 0.5) * (0.4 / ring.count), 0.001, 0.999);
          let u = Math.acos(1 - 2 * r) / Math.PI;
          u = clamp(u, 0.035, 0.985);

          let v;
          if (isRim) {
            const side = Math.floor(i / 9) % 2 === 0 ? -1 : 1;
            v = side;
          } else if (isVein) {
            v = (random() - 0.5) * 0.055;
          } else {
            v = ((i * 0.6180339887498949 + 0.17) % 1) * 2 - 1;
            v = clamp(v + (random() - 0.5) * 0.045, -0.975, 0.975);
          }

          const profile = Math.pow(Math.sin(Math.PI * u), 0.9);
          const width = ring.width * profile;
          const ruffle = Math.sin(u * 11 + p * 1.9 + l * 0.8) * ring.width * 0.035 * profile;
          const lateral = v * width + ruffle;
          const radial = ring.base + u * ring.length;

          const cup = ring.cup * Math.pow(Math.sin(Math.PI * u), 0.65) * (1 - v * v * 0.35);
          let z = ring.z + cup - Math.pow(u, 2.4) * ring.droop;
          z += Math.pow(Math.abs(v), 3) * ring.width * 0.09;
          z += (random() - 0.5) * 0.03 * (0.4 + profile);

          const x = cosA * radial - sinA * lateral;
          const y = sinA * radial + cosA * lateral;
          const openPos = new THREE.Vector3(x, y, z);

          // Fold every petal into a tapered, twisted bud along Y. The v axis
          // wraps around the bud so the closed flower reads as a solid volume
          // rather than a handful of glowing spiral lines.
          const rr = clamp(Math.hypot(x, y) / 1.96, 0, 1);
          const bt = Math.pow(rr, 0.82);
          const budProfile =
            Math.pow(Math.sin(Math.PI * clamp(bt * 0.92 + 0.04, 0, 1)), 0.7) *
            (1 - smoothstep(0.52, 1, bt) * 0.82) *
            (0.55 + 0.45 * smoothstep(0, 0.18, bt));
          const wrap = 0.86 + 0.28 * Math.sin(Math.PI * u);
          const budAngle = angle + bt * 4.9 + v * wrap;
          const budRadius =
            0.43 * budProfile * (1 - 0.16 * bt) * (0.86 + 0.14 * random());
          const budPos = new THREE.Vector3(
            Math.cos(budAngle) * budRadius,
            -0.95 + bt * 1.9 + v * 0.09 * Math.sin(Math.PI * bt) + (random() - 0.5) * 0.025,
            Math.sin(budAngle) * budRadius * 0.72 + 0.05
          );

          const rim = smoothstep(0.86, 1.0, Math.abs(v));
          const color = mixedColor(ring.t, u, v, rim, isVein, random);
          let size =
            1.0 +
            random() * 1.05 +
            rim * 0.6 +
            (isVein ? 0.24 : 0) +
            Math.pow(u, 3) * 0.16;
          if (isRim) size += 0.55;
          if (random() < 0.02) size *= 1.75;

          const delay = Math.min(ring.delay + random() * 0.05, 0.62);
          addParticle(openPos, budPos, color, size, delay, l / (rings.length - 1));
        }
      }
    }

    // Warm pollen core: a dense golden heart that also fills the bud.
    const coreCount = 2300;
    const coreColors = [
      new THREE.Color('#ffd38f'),
      new THREE.Color('#ffb765'),
      new THREE.Color('#ff9a62'),
      new THREE.Color('#ffc59c'),
    ];
    for (let i = 0; i < coreCount; i++) {
      const rad = Math.pow(random(), 0.6) * 0.62;
      const a = random() * TAU;
      const z = 0.5 + (1 - rad / 0.62) * 0.14 + random() * 0.08;
      const openPos = new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad * 0.92, z);

      const by = -0.78 + random() * 1.58;
      const br = Math.pow(random(), 0.6) * 0.16 * (1 - Math.abs(by) / 1.15);
      const budPos = new THREE.Vector3(
        Math.cos(a) * br,
        by + (random() - 0.5) * 0.03,
        Math.sin(a) * br * 0.8 + 0.05
      );
      const color = coreColors[(random() * coreColors.length) | 0].clone();
      color.lerp(warm, random() * 0.3);
      addParticle(
        openPos,
        budPos,
        color,
        0.85 + random() * 1.25,
        0.015 + random() * 0.09,
        -1.0
      );
    }

    return { open, bud, colors, sizes, seeds, delays, layers };
  }

  buildMotes() {
    const count = this.isMobile ? 900 : 1700;
    const random = mulberry32(91032);
    const seeds = new Float32Array(count);
    const radii = new Float32Array(count);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    const palette = [
      new THREE.Color('#ffd6a1'),
      new THREE.Color('#ff9cc4'),
      new THREE.Color('#c5a6ff'),
      new THREE.Color('#fff0d9'),
    ];
    for (let i = 0; i < count; i++) {
      seeds[i] = random();
      radii[i] = Math.pow(random(), 0.65);
      speeds[i] = (random() > 0.5 ? 1 : -1) * (0.035 + random() * 0.14);
      sizes[i] = 0.7 + random() * 1.7;
      const color = palette[(random() * palette.length) | 0];
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    this.moteMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBloom: { value: 0.8 },
        uPixelRatio: { value: this.pixelRatio },
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(geometry, this.moteMaterial);
    this.motes.frustumCulled = false;
    this.flowerGroup.add(this.motes);
  }

  buildAura() {
    const auraMaterial = new THREE.SpriteMaterial({
      map: this.haloTexture,
      color: new THREE.Color('#ff4f9a'),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.aura = new THREE.Sprite(auraMaterial);
    this.aura.scale.set(8.2, 6.6, 1);
    this.aura.position.set(0, 0, -1.2);
    this.aura.renderOrder = -2;
    this.flowerGroup.add(this.aura);

    const coreGlowMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: new THREE.Color('#ff9aad'),
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.coreGlow = new THREE.Sprite(coreGlowMaterial);
    this.coreGlow.scale.set(1.55, 1.55, 1);
    this.coreGlow.position.set(0, 0.04, 0.66);
    this.coreGlow.renderOrder = 3;
    this.flowerGroup.add(this.coreGlow);

    const hotMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: new THREE.Color('#fff0d3'),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.coreHot = new THREE.Sprite(hotMaterial);
    this.coreHot.scale.set(0.48, 0.48, 1);
    this.coreHot.position.set(0, 0.04, 0.74);
    this.coreHot.renderOrder = 4;
    this.flowerGroup.add(this.coreHot);
  }

  buildTipLights() {
    this.tipLights = [];
    for (let i = 0; i < 5; i++) {
      const material = new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: new THREE.Color(i === 0 ? '#ffd29c' : '#ff9dc9'),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(0.55);
      sprite.renderOrder = 8;
      sprite.position.set(99, 99, 0);
      this.scene.add(sprite);
      this.tipLights.push(sprite);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                       */
  /* ---------------------------------------------------------------- */

  setMode(mode) {
    this.mode = mode;
    this.handVisible = false;
    this.tipStrength = 0;
    this.targetTipStrength = 0;
    this.targetTiltX = 0;
    this.targetTiltY = 0;
    this.targetRoll = 0;
    if (mode !== 'live') {
      this.worldTips.forEach((tip) => tip.set(99, 99, 0));
    }
    if (mode === 'idle') {
      this.targetPosition.set(this.getIdleOffset(), 0.08, 0);
    } else {
      this.targetPosition.set(0, 0.05, 0);
    }
    this.demoHolding = false;
    this.demoPointer.active = false;
  }

  setBloomOverride(value) {
    this.bloomOverride = value === null || value === undefined ? null : clamp(Number(value) || 0, 0, 1);
    if (this.bloomOverride !== null) {
      this.currentBloom = this.bloomOverride;
      this.prevBloom = this.bloomOverride;
    }
  }

  setHand(hand) {
    if (!hand || !hand.visible) {
      this.handVisible = false;
      this.targetTipStrength = 0;
      this.targetBloom = 0.06;
      this.targetTiltX = 0;
      this.targetTiltY = 0;
      this.targetRoll = 0;
      return;
    }

    const center = this.mapNormalized(hand.palm.x, hand.palm.y, 0.05);
    this.targetPosition.set(
      clamp(center.x, -this.getMarginX(), this.getMarginX()),
      clamp(center.y + 0.16, -this.getMarginY(), this.getMarginY()),
      0
    );
    this.targetBloom = clamp(hand.bloom, 0, 1);

    // The palm becomes a joystick: lateral movement turns the flower toward
    // the hand, vertical movement tips it back, and a wrist roll spins it.
    const palmX = clamp((hand.palm.x - 0.5) * 1.4, -0.55, 0.55);
    const palmY = clamp((hand.palm.y - 0.5) * 1.0, -0.4, 0.4);
    this.targetTiltY = clamp(palmX + hand.roll * 0.42, -0.62, 0.62);
    this.targetTiltX = palmY * 0.9;
    this.targetRoll = clamp(-hand.roll * 0.72, -0.8, 0.8);
    this.targetTipStrength = 0.18 + hand.openness * 0.42;
    this.handVisible = true;
    this.lastHandTime = this.elapsed;
    this.smoothedFingers = hand.fingers;

    const z = 0.32;
    hand.tips.forEach((tip, i) => {
      const point = this.mapNormalized(tip.x, tip.y, z);
      point.x = clamp(point.x, -this.getMarginX() * 1.8, this.getMarginX() * 1.8);
      point.y = clamp(point.y, -this.getMarginY() * 1.85, this.getMarginY() * 1.85);
      this.worldTips[i].lerp(point, 0.75);
    });
  }

  setDemoPointer(nx, ny, active = true) {
    this.demoPointer.x = nx;
    this.demoPointer.y = ny;
    this.demoPointer.active = active;
    if (active) {
      const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
      const halfW = halfH * this.aspect;
      const x = clamp((nx - 0.5) * 2 * halfW * 0.56, -this.getMarginX(), this.getMarginX());
      const y = clamp((0.5 - ny) * 2 * halfH * 0.56, -this.getMarginY(), this.getMarginY());
      this.targetPosition.set(x, y + 0.18, 0);
      this.targetTiltY = clamp((nx - 0.5) * 1.25, -0.55, 0.55);
      this.targetTiltX = clamp((ny - 0.5) * 0.85, -0.4, 0.4);
      this.targetRoll = clamp((0.5 - nx) * 0.14, -0.1, 0.1);
      this.worldTips[0].set(x + 0.16, y + 0.44, 0.42);
      this.worldTips[1].set(99, 99, 0);
      this.worldTips[2].set(99, 99, 0);
      this.worldTips[3].set(99, 99, 0);
      this.worldTips[4].set(99, 99, 0);
    }
  }

  setDemoHolding(holding) {
    this.demoHolding = holding;
    this.targetBloom = holding ? 0.02 : 0.94;
    this.targetTipStrength = holding ? 0.14 : 0.45;
  }

  getIdleOffset() {
    if (this.aspect < 1.12) return 0;
    return Math.min(1.02, this.aspect * 0.52);
  }

  getMarginX() {
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
    return halfH * this.aspect * 0.39;
  }

  getMarginY() {
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
    return halfH * 0.3;
  }

  mapNormalized(nx, ny, z = 0) {
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
    const halfW = halfH * this.aspect;
    return new THREE.Vector3(
      (0.5 - nx) * 2 * halfW * 0.78,
      (0.5 - ny) * 2 * halfH * 0.78 + 0.12,
      z
    );
  }

  /* ---------------------------------------------------------------- */
  /* Resize & render                                                   */
  /* ---------------------------------------------------------------- */

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.aspect = width / height;
    this.isMobile = width <= 760;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.75 : 2);

    this.camera.aspect = this.aspect;
    this.camera.position.z = 7.6 + Math.max(0, 1.2 - this.aspect) * 2.45;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.bloomPass.strength = this.isMobile ? 0.36 : 0.44;
    this.flowerMaterial.uniforms.uPixelRatio.value = this.pixelRatio;
    this.moteMaterial.uniforms.uPixelRatio.value = this.pixelRatio;
    this.bursts.setPixelRatio(this.pixelRatio);

    const dist = this.camera.position.z + 12;
    const visibleH = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist;
    this.background.scale.set(visibleH * this.aspect * 1.18, visibleH * 1.18, 1);

    const live = this.mode === 'live' || this.mode === 'demo' || this.mode === 'loading';
    if (!live) {
      this.targetPosition.set(this.getIdleOffset(), 0.08, 0);
    }
  }

  render() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.render);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    this.update(dt, this.elapsed);
    this.composer.render();
    if (this.onUpdate) this.onUpdate(this.gesture);
  }

  update(dt, time) {
    this.mouse.lerp(this.targetMouse, 1 - Math.exp(-3 * dt));

    if (this.mode === 'idle') {
      const base = this.reducedMotion ? 0.88 : 0.86 + Math.sin(time * 0.47) * 0.09;
      this.targetBloom = base;
      this.targetPosition.x = this.getIdleOffset() + Math.sin(time * 0.22) * 0.08;
      this.targetPosition.y = (this.aspect < 1.12 ? -0.18 : 0.08) + Math.sin(time * 0.36) * 0.06;
      this.targetTiltX = 0.035;
      this.targetTiltY = 0.12 + Math.sin(time * 0.23) * 0.14;
      this.targetRoll = Math.sin(time * 0.18) * 0.035;
      this.targetTipStrength = 0.12;
    } else if (this.mode === 'loading') {
      this.targetBloom = 0.72 + Math.sin(time * 0.9) * 0.06;
      this.targetPosition.x = Math.sin(time * 0.4) * 0.06;
      this.targetTiltX = 0.02;
      this.targetTiltY = Math.sin(time * 0.35) * 0.12;
    } else if (this.mode === 'demo') {
      if (!this.demoPointer.active) {
        this.targetPosition.x = Math.sin(time * 0.35) * 0.45;
        this.targetPosition.y = 0.1 + Math.sin(time * 0.48) * 0.16;
        this.worldTips[0].set(this.targetPosition.x + 0.18, this.targetPosition.y + 0.5, 0.42);
        this.targetTiltX = 0.06;
        this.targetTiltY = Math.sin(time * 0.24) * 0.32;
        this.targetRoll = Math.sin(time * 0.3) * 0.04;
      }
      if (!this.demoHolding) this.targetBloom = this.demoPointer.active ? 0.9 : 0.86;
      this.targetTipStrength = this.demoHolding ? 0.14 : 0.45;
    } else if (this.mode === 'live') {
      if (!this.handVisible && time - this.lastHandTime > 0.55) {
        this.targetBloom = 0.06;
        this.targetTipStrength = 0;
        this.targetTiltX *= 0.98;
        this.targetTiltY *= 0.98;
        this.targetRoll *= 0.98;
      }
    }

    if (this.bloomOverride !== null) this.targetBloom = this.bloomOverride;

    const bloomLambda = this.mode === 'live' ? 8.2 : 5.2;
    this.currentBloom = damp(this.currentBloom, this.targetBloom, bloomLambda, dt);
    this.tipStrength = damp(this.tipStrength, this.targetTipStrength, 5.5, dt);
    this.roll = damp(this.roll, this.targetRoll, 3.6, dt);
    this.tiltX = damp(this.tiltX, this.targetTiltX, 3.2, dt);
    this.tiltY = damp(this.tiltY, this.targetTiltY, 2.9, dt);

    const posLambda = this.mode === 'live' ? 5.2 : 3.6;
    this.flowerGroup.position.x = damp(this.flowerGroup.position.x, this.targetPosition.x, posLambda, dt);
    this.flowerGroup.position.y = damp(this.flowerGroup.position.y, this.targetPosition.y, posLambda, dt);
    this.flowerGroup.position.z = damp(this.flowerGroup.position.z, 0, 3, dt);

    const driftX = Math.sin(time * 0.42) * 0.012;
    const driftY = Math.sin(time * 0.33) * 0.016;
    this.flowerGroup.rotation.x = this.tiltX + driftX - this.flowerGroup.position.y * 0.018;
    this.flowerGroup.rotation.y = this.tiltY + driftY + this.flowerGroup.position.x * 0.018;
    this.flowerGroup.rotation.z = this.roll;
    this.updateOrbit(dt, time);

    this.flowerMaterial.uniforms.uTime.value = time;
    this.flowerMaterial.uniforms.uBloom.value = this.currentBloom;
    this.flowerMaterial.uniforms.uTipStrength.value = this.tipStrength;
    this.moteMaterial.uniforms.uTime.value = time;
    this.moteMaterial.uniforms.uBloom.value = this.currentBloom;
    this.backgroundMaterial.uniforms.uTime.value = time;

    const idleScale = this.aspect < 1.12 ? 0.76 : 0.88;
    const scale = this.getFlowerScale() * (this.mode === 'idle' ? idleScale : 1);
    this.flowerGroup.scale.setScalar(scale);

    this.updateTipLights(time);
    this.updateAura(time);
    this.updateBursts(dt, time);
    this.updateStars(time);

    const gesture = this.computeGesture();
    this.gesture = gesture;

    // A single generous burst when the flower crosses into full bloom.
    if (this.prevBloom < 0.53 && this.currentBloom >= 0.53) {
      const center = this.flowerGroup.position;
      this.bursts.spawn(center, this.isMobile ? 70 : 120, {
        power: 1.25,
        bias: { x: 0, y: 0.22 },
      });
      if (this.handVisible) {
        for (let i = 0; i < 5; i++) {
          if (this.worldTips[i].x < 90) {
            this.bursts.spawn(this.worldTips[i], 12, { power: 1.05, spread: 1.2 });
          }
        }
      }
    }
    this.prevBloom = this.currentBloom;
  }

  getFlowerScale() {
    if (this.aspect >= 1.45) return 1;
    if (this.aspect >= 1.1) return 0.92;
    return 0.82;
  }

  updateTipLights(time) {
    const visible = this.handVisible;
    for (let i = 0; i < 5; i++) {
      const sprite = this.tipLights[i];
      const tip = this.worldTips[i];
      const hasTip = visible && tip.x < 90;
      if (hasTip) {
        sprite.position.copy(tip);
        const pulse = 0.78 + Math.sin(time * 3.1 + i * 1.7) * 0.22;
        const size = (0.2 + this.currentBloom * 0.15) * pulse;
        sprite.scale.setScalar(size);
        sprite.material.opacity = hasTip
          ? (0.1 + this.currentBloom * 0.16) * (i === 0 ? 1 : 0.7)
          : 0;
        sprite.material.color.set(i === 0 ? '#ffd7a1' : '#ff9ec8');
      } else {
        sprite.material.opacity = 0;
      }
    }
  }

  updateAura(time) {
    const bloom = this.currentBloom;
    this.aura.material.opacity = 0.06 + bloom * 0.08;
    this.aura.scale.setScalar(6.4 + bloom * 1.2);
    this.aura.material.rotation = time * 0.012;
    this.coreGlow.material.opacity = 0.08 + bloom * 0.1;
    this.coreGlow.scale.setScalar(0.52 + bloom * 0.3 + Math.sin(time * 1.1) * 0.02);
    this.coreHot.material.opacity = 0.18 + bloom * 0.16;
    this.coreHot.scale.setScalar(0.15 + bloom * 0.07);
    for (const arc of this.arcs) {
      arc.rotation.z += arc.userData.speed * 0.016;
      arc.material.opacity = arc.userData.baseOpacity * (0.45 + bloom * 0.9);
    }
  }

  updateBursts(dt, time) {
    this.bursts.update(dt);

    const active = this.mode === 'live';
    if (!active || this.currentBloom < 0.38) return;
    let liveTips = 0;
    for (let i = 0; i < 5; i++) {
      if (this.worldTips[i].x < 90) liveTips++;
    }
    if (liveTips === 0) return;

    this.bursts.emitAccumulator += dt * (7 + this.currentBloom * 22);
    while (this.bursts.emitAccumulator >= 1) {
      const index = (this.emitCursor++) % 5;
      const tip = this.worldTips[index];
      if (tip.x < 90) {
        this.bursts.spawn(tip, 1, {
          power: 0.55 + this.currentBloom * 0.22,
          spread: 0.85,
          bias: { x: (tip.x - this.flowerGroup.position.x) * 0.18, y: 0.3 },
        });
      }
      this.bursts.emitAccumulator -= 1;
    }
  }

  updateStars(time) {
    const offsetX = (this.flowerGroup.position.x || 0) * 0.025;
    const offsetY = (this.flowerGroup.position.y || 0) * 0.025;
    this.starGroups.forEach((group, i) => {
      group.position.x = -offsetX * (i + 1);
      group.position.y = -offsetY * (i + 1) + Math.sin(time * 0.03 + i) * 0.05;
      group.rotation.z = time * 0.002 * (i === 0 ? 1 : -1);
    });
  }

  computeGesture() {
    let state = 'transition';
    let label = '正在舒展';
    const bloom = this.currentBloom;
    if (this.mode === 'idle') {
      return {
        state: 'idle',
        label: '自动演示',
        bloom,
        roll: this.roll,
        fingers: [true, true, true, true, true],
        visible: false,
      };
    }
    if (this.mode === 'live' && !this.handVisible) {
      return {
        state: 'none',
        label: '等待手掌',
        bloom,
        roll: this.roll,
        fingers: [false, false, false, false, false],
        visible: false,
      };
    }
    if (bloom < 0.28) {
      state = 'fist';
      label = '花苞 · 合拢';
    } else if (bloom > 0.64) {
      state = 'open';
      label = '绽放 · 盛开';
    }
    const fingers =
      this.mode === 'demo'
        ? bloom > 0.55
          ? [true, true, true, true, true]
          : [false, false, false, false, false]
        : this.smoothedFingers || [true, true, true, true, true];
    return { state, label, bloom, roll: this.roll, fingers, visible: this.handVisible || this.mode === 'demo' };
  }

  setPointerNormalized(nx, ny) {
    this.targetMouse.set(nx * 2 - 1, -(ny * 2 - 1));
    this.mouse.x = this.targetMouse.x;
    this.mouse.y = this.targetMouse.y;
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.composer.dispose();
  }
}
