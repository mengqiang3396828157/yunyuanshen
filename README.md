# 指尖花间 · Fingertip Bloom

一朵由三万多颗粒子组成的花，跟着你的手掌移动、旋转。握拳，它收拢成一枚发光的花苞；张开手掌，花瓣与光点从掌心向外绽放。

- **Three.js** 粒子花朵、程序化背景、UnrealBloom 辉光
- **MediaPipe Tasks Vision** 21 点手部关键点，本地 WASM 推理
- 原生 HTML / CSS / JavaScript，无构建步骤
- 所有依赖与手势模型均已放在 `vendor/`，运行时不访问 CDN

## 运行

需要 Python 3.9+。在本目录执行：

```bash
python server.py
```

然后打开 <http://127.0.0.1:8080/>。如果 `python` 不在 PATH，可改用 `py -3 server.py`；也可以直接双击 `start.bat`，它会自动尝试 `python` / `py -3` 并打开浏览器。

如果 8080 端口被占用：

```bash
python server.py --port 8081
```

> 摄像头只能在 `localhost` / `127.0.0.1` 或 HTTPS 页面中使用。直接双击 `index.html`（`file://`）无法加载模型和摄像头。

## 手势

| 动作 | 效果 |
| --- | --- |
| 握拳 | 花朵折叠为花苞，光点收束 |
| 五指张开 | 花朵完全绽放，金色粒子从指尖溢出 |
| 移动手掌 | 花朵跟随手掌，指尖掠过花面时产生涟漪 |
| 转动手掌 | 花朵沿掌心的倾斜方向转向；腕部 roll 带动自转与轻微 Yaw，外围彗星同步绕行 |
| 半开手掌 | 花朵停在中间状态，可以慢慢“吹开” |

没有摄像头时，点击首页的 **“没有摄像头？先用鼠标看看”**：

- 移动鼠标：花朵跟随并轻微转向
- 按住鼠标 / 空格：花苞合拢
- 松开：重新绽放

## 目录

```
fingertip-bloom/
├─ index.html                 页面与 UI 结构
├─ css/style.css              暗色编辑风视觉、响应式与动效
├─ js/main.js                 应用状态、手势 HUD、摄像头与演示模式
├─ js/flower.js               Three.js 粒子花、花苞形变、辉光与粒子爆发
├─ js/handtracker.js          MediaPipe 手部追踪、手势计算、摄像头叠加层
├─ server.py                  本地 HTTP 服务（正确的 .mjs / .wasm MIME）
├─ start.bat                  Windows 一键启动
└─ vendor/
   ├─ three.module.js         Three.js r169
   ├─ addons/                 EffectComposer / UnrealBloom 等
   ├─ mediapipe/              Tasks Vision WASM 运行时
   └─ models/
      └─ hand_landmarker.task MediaPipe 手部关键点模型
```

## 实现要点

### 粒子花朵

`js/flower.js` 生成约 3.1 万颗粒子：三层交错花瓣（8 / 7 / 7 片），加一团暖金色花芯。每个粒子有三组关键数据：

- `position`：完全绽放时的位置（分层螺旋排列的花瓣）
- `aBud`：握拳时收拢到的位置（沿 Y 轴旋转的水滴形花苞）
- `aDelay`：逐粒子的开放延迟，外层花瓣先开

顶点着色器用 `ease(clamp((uBloom - aDelay) / 0.32, 0.0, 1.0))` 做缓动形变，让外层花瓣先开、内层后开，半开时仍读得出一朵花；同时叠加呼吸、旋涡、指尖高斯涟漪。片元着色器绘制柔边点精灵，配合加色混合与 Bloom 得到花瓣的通透感。

花体外围还有一层很细的轨道、30 段金紫拖尾和一枚光点。光点角度叠加腕部 `roll`，即使花瓣接近径向对称，转动手腕时也能看见一圈光在绕行。

`uBloom` 由 MediaPipe 的连续手势 openness 驱动，而不是简单的二值状态，所以手掌半开时花朵也会停在半开的位置。

### 手势判定

`js/handtracker.js` 对 21 个关键点做归一化与镜像，按以下信号计算 openness：

- 四指（食、中、无名、小指）的 `腕→指尖 / 腕→PIP` 伸展比例
- 拇指尖到食指根的距离 / 掌宽
- 指尖到掌心的平均展开距离

连续值经过指数平滑后传给花朵；同时绘制摄像头小窗内的骨架和指尖光点。GPU delegate 初始化失败时会自动回退到 CPU。

### 交互

- 手掌中心映射到 Three.js 世界坐标，花朵用阻尼跟随
- 掌心的横向/纵向位置映射为花朵的 Yaw / Pitch，腕部 `roll` 同时驱动少量 Yaw 与 Z 轴自转；三层角度都带阻尼，不会抖动
- 没有检测到手时，花朵会收拢成花苞等待；手重新进入画面后再随 openness 打开
- 5 个指尖是世界空间中的涟漪源，花瓣经过时被轻轻推开并泛金；金色花芯不受推挤，避免中心出现空洞
- 绽放跨过阈值时触发一次粒子爆发；检测到手部张开时，指尖持续溢出少量光尘
- 半开状态按“外环先开、内环后开”的节奏展开，不会散成一团雾
- 相机在竖屏时自动后撤，花朵在小屏幕上缩放，避免被 HUD 遮挡

## 调试参数

- `?demo=1`：直接进入鼠标体验
- `?demo=1&hold=1`：进入鼠标体验并保持花苞状态
- `?demo=1&bloom=0.5`：冻结在指定绽放进度（0–1），用于截图检查

控制台可用 `window.__bloomApp` 访问 `scene`、`state` 和 `startDemo()` / `startCamera()`。

## 隐私

摄像头画面只在浏览器内交给 MediaPipe WASM 处理，不上传、不录制、不写入磁盘。页面没有后端接口。

## 浏览器

推荐最新版 Chrome / Edge（桌面）。需要 WebGL2；没有 WebGL 时会显示降级提示。移动端可以使用鼠标体验模式，摄像头手势需要浏览器支持 `getUserMedia`。

## 第三方资源

- [Three.js](https://threejs.org/) r169 — MIT License
- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) 0.10.21 — Apache License 2.0
- `hand_landmarker.task` 来自 MediaPipe 官方模型仓库
