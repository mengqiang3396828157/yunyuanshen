import { FlowerScene } from './flower.js';
import { HandTracker } from './handtracker.js';

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const app = $('app');
const stage = $('stage');
const startCameraButton = $('startCamera');
const startDemoButton = $('startDemo');
const ctaProgressText = $('ctaProgressText');
const modeChipText = $('modeChipText');
const modeSwitch = $('modeSwitch');
const cameraPanel = $('cameraPanel');
const cameraToggle = $('cameraToggle');
const cameraEmpty = $('cameraEmpty');
const trackerState = $('trackerState');
const trackerFps = $('trackerFps');
const gestureLabel = $('gestureLabel');
const gestureOrb = $('gestureOrb');
const bloomValue = $('bloomValue');
const bloomFill = $('bloomFill');
const bloomHead = $('bloomHead');
const fingerDots = Array.from(document.querySelectorAll('.finger-dot'));
const hudTipText = $('hudTipText');
const helpButton = $('helpBtn');
const helpPanel = $('helpPanel');
const helpClose = $('helpClose');
const notice = $('notice');
const noticeTitle = $('noticeTitle');
const noticeText = $('noticeText');
const noticeClose = $('noticeClose');
const webglError = $('webglError');
const video = $('cam');
const overlay = $('camOverlay');

const params = new URLSearchParams(window.location.search);

const state = {
  uiMode: 'idle',
  live: false,
  demo: false,
  starting: false,
  holding: false,
  handPresent: false,
  trackerStatus: '',
  latestGesture: null,
  frames: 0,
  fpsStamp: performance.now(),
  lastHud: 0,
  lastTip: '',
  lastLabel: '',
};

let scene = null;
let tracker = null;
let noticeTimer = 0;

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

try {
  scene = new FlowerScene(stage);
} catch (error) {
  console.error('[bloom] WebGL initialisation failed', error);
  webglError.hidden = false;
}

if (scene) {
  scene.onUpdate = onSceneUpdate;
  stage.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showNotice('画面渲染中断', 'WebGL 上下文丢失，请刷新页面重新唤醒花园。', 0);
  });
  stage.addEventListener('webglcontextrestored', () => {
    hideNotice();
  });

  bindInterface();
  document.documentElement.dataset.appReady = '1';

  if (params.get('demo') === '1') {
    window.setTimeout(() => {
      startDemo();
      if (params.get('hold') === '1') {
        state.holding = true;
        scene.setDemoHolding(true);
      }
      if (params.has('bloom')) {
        scene.setBloomOverride(parseFloat(params.get('bloom')));
      }
    }, 420);
  }

  window.__bloomApp = {
    scene,
    state,
    startDemo,
    startCamera,
    setBloom: (value) => scene.setBloomOverride(value),
    clearBloomOverride: () => scene.setBloomOverride(null),
    showNotice,
  };
}

/* ------------------------------------------------------------------ */
/* Interface                                                           */
/* ------------------------------------------------------------------ */

function bindInterface() {
  startCameraButton.addEventListener('click', () => startCamera());
  startDemoButton.addEventListener('click', () => startDemo());
  modeSwitch.addEventListener('click', () => startCamera());

  cameraToggle.addEventListener('click', () => {
    const collapsed = cameraPanel.classList.toggle('is-collapsed');
    cameraToggle.setAttribute('aria-label', collapsed ? '展开摄像头画面' : '隐藏摄像头画面');
    cameraToggle.title = collapsed ? '展开画面' : '隐藏画面';
  });

  helpButton.addEventListener('click', openHelp);
  helpClose.addEventListener('click', closeHelp);
  helpPanel.addEventListener('click', (event) => {
    if (event.target === helpPanel) closeHelp();
  });

  noticeClose.addEventListener('click', hideNotice);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeHelp();
      releaseDemoHold();
    }
    if (event.code === 'Space' && state.demo && !event.repeat && !helpPanel.hidden) return;
    if (event.code === 'Space' && state.demo && !event.repeat) {
      const tag = document.activeElement?.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return;
      event.preventDefault();
      state.holding = true;
      scene.setDemoHolding(true);
      updateDemoHint();
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && state.demo && state.holding) {
      event.preventDefault();
      releaseDemoHold();
    }
  });

  window.addEventListener('pointermove', onDemoPointerMove, { passive: true });
  window.addEventListener('pointerdown', onDemoPointerDown, { passive: false });
  window.addEventListener('pointerup', releaseDemoHold);
  window.addEventListener('pointercancel', releaseDemoHold);
  window.addEventListener('blur', releaseDemoHold);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseDemoHold();
  });
}

function setUiMode(mode) {
  state.uiMode = mode;
  app.dataset.mode = mode;
}

function setCtaLoading(loading, text = '唤 醒 中') {
  startCameraButton.classList.toggle('is-loading', loading);
  startCameraButton.disabled = loading;
  ctaProgressText.textContent = text;
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

async function startCamera() {
  if (!scene || state.starting || state.live) return;

  const previousMode = state.uiMode;
  state.starting = true;
  state.demo = false;
  releaseDemoHold();
  setUiMode('idle');
  scene.setMode('loading');
  setCtaLoading(true, '加载手势模型');
  hideNotice();

  tracker = new HandTracker({
    video,
    overlay,
    onHand: handleHand,
    onStatus: handleTrackerStatus,
    onError: handleTrackerRuntimeError,
  });

  try {
    await tracker.start();
    state.live = true;
    state.starting = false;
    state.handPresent = false;
    state.trackerStatus = 'ready';
    setCtaLoading(false);
    scene.setMode('live');
    setUiMode('live');
    trackerState.textContent = '寻找手部';
    cameraEmpty.classList.remove('is-hidden');
    trackerFps.textContent = '— FPS';
    updateHudTip('把手放进画面，转动掌心可以旋转花朵。');
  } catch (error) {
    console.error('[bloom] camera start failed', error);
    state.starting = false;
    state.live = false;
    setCtaLoading(false);
    if (tracker) {
      try {
        await tracker.stop();
      } catch (stopError) {
        console.warn('[bloom] tracker cleanup failed', stopError);
      }
      tracker = null;
    }
    const message = describeCameraError(error);
    showNotice(message.title, message.text, 11000);
    if (previousMode === 'demo') {
      startDemo();
    } else {
      setUiMode('idle');
      scene.setMode('idle');
    }
  }
}

function handleTrackerStatus(status) {
  state.trackerStatus = status;

  if (state.starting) {
    if (status === 'model') setCtaLoading(true, '加载手势模型');
    else if (status === 'camera') setCtaLoading(true, '等待摄像头授权');
    else if (status === 'ready') setCtaLoading(true, '识别已启动');
  }

  if (!state.live) return;

  if (status === 'tracking') {
    state.handPresent = true;
    cameraEmpty.classList.add('is-hidden');
    trackerState.textContent = '已捕捉 · 21 点';
  } else if (status === 'searching') {
    state.handPresent = false;
    cameraEmpty.classList.remove('is-hidden');
    trackerState.textContent = '寻找手部';
  } else if (status === 'ready' || status === 'camera') {
    trackerState.textContent = '寻找手部';
  }
}

function handleHand(hand) {
  if (!scene || !state.live) return;

  if (!hand) {
    state.handPresent = false;
    scene.setHand(null);
    cameraEmpty.classList.remove('is-hidden');
    trackerState.textContent = '寻找手部';
    return;
  }

  state.handPresent = true;
  scene.setHand(hand);
  cameraEmpty.classList.add('is-hidden');
  trackerState.textContent = '已捕捉 · 21 点';
}

function handleTrackerRuntimeError(error) {
  console.error('[bloom] tracker runtime error', error);
  if (!state.live) return;

  state.live = false;
  state.handPresent = false;
  setUiMode('idle');
  if (scene) scene.setMode('idle');
  showNotice('识别中断', '手势识别遇到问题，摄像头已关闭。请刷新页面后重试。', 0);

  if (tracker) {
    tracker.stop().catch((stopError) => console.warn('[bloom] tracker cleanup failed', stopError));
    tracker = null;
  }
}

function describeCameraError(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      title: '摄像头权限被拒绝',
      text: '请在地址栏的摄像头图标中允许访问，然后再试一次。你也可以先用鼠标体验。',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      title: '没有找到摄像头',
      text: '连接摄像头后刷新页面，或者先用鼠标看看花朵如何开放。',
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      title: '摄像头暂时不可用',
      text: '摄像头可能正被其他应用占用，关闭占用程序后再试。',
    };
  }
  if (name === 'OverconstrainedError') {
    return {
      title: '摄像头参数不支持',
      text: '请更换摄像头，或使用鼠标体验模式。',
    };
  }
  if (name === 'NotSupportedError') {
    return {
      title: '浏览器不支持摄像头',
      text: '请使用最新版 Chrome 或 Edge，并确保通过本地服务器打开页面。',
    };
  }
  return {
    title: '手势识别启动失败',
    text: '请确认本地手势模型文件完整，或刷新页面重试。鼠标体验仍然可用。',
  };
}

/* ------------------------------------------------------------------ */
/* Demo                                                               */
/* ------------------------------------------------------------------ */

function startDemo() {
  if (!scene || state.live || state.starting) return;
  state.demo = true;
  state.handPresent = false;
  setUiMode('demo');
  scene.setMode('demo');
  scene.setDemoHolding(false);
  modeChipText.textContent = '鼠标体验中';
  updateDemoHint();
}

function releaseDemoHold() {
  if (!state.holding) return;
  state.holding = false;
  if (scene && state.demo) scene.setDemoHolding(false);
  updateDemoHint();
}

function onDemoPointerMove(event) {
  if (!state.demo || state.live) return;
  const nx = clamp(event.clientX / window.innerWidth, 0, 1);
  const ny = clamp(event.clientY / window.innerHeight, 0, 1);
  scene.setDemoPointer(nx, ny, true);
}

function onDemoPointerDown(event) {
  if (!state.demo || state.live) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const target = event.target instanceof Element ? event.target.closest('button, a, input, textarea') : null;
  if (target) return;
  if (helpPanel && !helpPanel.hidden) return;

  state.holding = true;
  scene.setDemoHolding(true);
  updateDemoHint();
  const nx = clamp(event.clientX / window.innerWidth, 0, 1);
  const ny = clamp(event.clientY / window.innerHeight, 0, 1);
  scene.setDemoPointer(nx, ny, true);
}

function updateDemoHint() {
  if (!state.demo) return;
  updateHudTip(
    state.holding
      ? '保持按住，花会收拢成一颗花苞；松开，看它再次盛开。'
      : '移动鼠标转动花朵；按住画面或空格，让花收拢。'
  );
}

/* ------------------------------------------------------------------ */
/* HUD                                                                */
/* ------------------------------------------------------------------ */

function onSceneUpdate(gesture) {
  if (!scene) return;
  state.latestGesture = gesture;
  state.frames += 1;

  const now = performance.now();
  if (now - state.fpsStamp > 800) {
    const fps = Math.round((state.frames * 1000) / (now - state.fpsStamp));
    if (state.live) trackerFps.textContent = `${fps} FPS`;
    state.frames = 0;
    state.fpsStamp = now;
  }

  if (state.uiMode !== 'live' && state.uiMode !== 'demo') return;
  if (now - state.lastHud < 55) return;
  state.lastHud = now;
  updateHud(gesture);
}

function updateHud(gesture) {
  const percent = Math.round(gesture.bloom * 100);
  bloomValue.textContent = String(percent);
  bloomFill.style.width = `${percent}%`;
  bloomHead.style.left = `${percent}%`;

  let label = gesture.label;
  if (state.live && !state.handPresent) {
    label = '请把手放进画面';
  } else if (state.demo && state.holding && gesture.bloom > 0.18) {
    label = '正在收拢';
  }

  if (label !== state.lastLabel) {
    state.lastLabel = label;
    gestureLabel.textContent = label;
  }

  const orbState = state.live && !state.handPresent ? 'none' : gesture.state;
  if (gestureOrb.dataset.state !== orbState) gestureOrb.dataset.state = orbState;

  const fingers = state.live && !state.handPresent
    ? [false, false, false, false, false]
    : gesture.fingers;
  fingerDots.forEach((dot, index) => {
    dot.classList.toggle('is-active', Boolean(fingers[index]));
  });

  let tip;
  if (state.uiMode === 'demo') {
    tip = state.holding
      ? '保持按住，花会收拢成一颗花苞；松开，看它再次盛开。'
      : '移动鼠标转动花朵；按住画面或空格，让花收拢。';
  } else if (!state.handPresent) {
    tip = '把手放进画面，掌心朝向镜头，距离 40–70 cm。';
  } else if (gesture.state === 'fist') {
    tip = '保持握拳，让花在掌心里安静一会儿。';
  } else if (gesture.state === 'open' && Math.abs(gesture.roll) > 0.18) {
    tip = '掌心转动，花也会跟着旋转。';
  } else if (gesture.state === 'open') {
    tip = '移动指尖，花朵会追随你的手，泛起微光。';
  } else {
    tip = '再张开一点，花瓣正在醒来。';
  }
  updateHudTip(tip);
}

function updateHudTip(text) {
  if (!text || text === state.lastTip) return;
  state.lastTip = text;
  hudTipText.textContent = text;
}

/* ------------------------------------------------------------------ */
/* Help & notice                                                       */
/* ------------------------------------------------------------------ */

function openHelp() {
  releaseDemoHold();
  helpPanel.hidden = false;
  helpClose.focus({ preventScroll: true });
}

function closeHelp() {
  if (helpPanel.hidden) return;
  helpPanel.hidden = true;
  helpButton.focus({ preventScroll: true });
}

function showNotice(title, text, timeout = 9000) {
  window.clearTimeout(noticeTimer);
  noticeTitle.textContent = title;
  noticeText.textContent = text;
  notice.hidden = false;
  if (timeout > 0) {
    noticeTimer = window.setTimeout(() => {
      notice.hidden = true;
    }, timeout);
  }
}

function hideNotice() {
  window.clearTimeout(noticeTimer);
  notice.hidden = true;
}
