# 视频播放网页

一个打开即自动播放的简洁视频播放页面，部署在 Cloudflare Pages 上。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `index.html` | 播放页面，全屏铺满，打开自动播放 |
| `yunyuanshen.mp4` | 视频文件（H.264 / 1920×1080 / 约 52 秒 / 6.94 MB） |

## 功能

- 打开网页自动开始播放（浏览器策略限制，默认静音）
- 点击画面暂停 / 继续
- 底部「🔊 点击开启声音」按钮可打开声音
- 加载失败时显示提示信息

## 本地预览

不要直接双击 `index.html` 打开（`file://` 协议下浏览器会拒绝加载本地视频）。
请在此目录下启动一个本地服务器：

```powershell
python -m http.server 8000
```

然后访问 <http://localhost:8000/index.html>

## 部署到 Cloudflare Pages

详见下方步骤，或参考 [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)。
