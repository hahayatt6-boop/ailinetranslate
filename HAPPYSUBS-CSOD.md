# HappySubs 的 CSOD 适配副本

当前版本可切换 Deepgram 和百炼，每家独立配置最多 5 个 Key，云端不可用时可回退原本地识别。设置及验证结果见 [DEEPGRAM.md](DEEPGRAM.md)。

用户已验证 HappySubs 2.2.2 在直接打开课程 MP4 时能显示英中双语字幕。本机语音识别模型也已通过 CPU 识别测试。原课件无法使用的原因是其视频位于同源 iframe，而 HappySubs 通用注入只检查顶层文档。

`scripts/build-happysubs-csod.cjs` 从本机已安装的 HappySubs 2.2.2 生成独立副本。它不修改 Chrome 内安装的版本，不复制浏览器设置或 API Key。

框架适配仅针对 `https://ready.csod.com/`：检测可访问的所有框架，优先选择正在播放或面积最大的含视频框架，也支持没有视频元素的 Storyline 旁白课件。在选中的框架注入脚本和样式，向该框架发送状态、启动、停止等弹窗消息。可选 Deepgram 或百炼，各保存最多 5 个 Key，保留原本地识别和翻译功能。副本名称为「HappySubs · CSOD 适配」，版本为 2.2.5.4。

## 加载验证

1. 在 Chrome 扩展管理页暂时关闭原 HappySubs，避免重复捕获音频。
2. 开启开发者模式，选择「加载已解压的扩展程序」，选中本仓库的 `artifacts/happysubs-csod` 文件夹。
3. 刷新原 CSOD 课件页面，在插件内选择云端厂商并保存对应 Key，再点击「开启实时听译」并播放课件；本地模式另需启动原 `happysubs-server`。

2.2.5.4 已在原始心理急救课件的 Welcome 英文旁白页验证 Deepgram 识别、中文译文显示和暂停保留。百炼已验证 API 协议及测试音频识别，其在浏览器内的完整课件流程仍待实测。非英语访谈不适合当前的英语识别配置。

## 重建及检查

```powershell
node scripts/build-happysubs-csod.cjs '本机 HappySubs 2.2.2 扩展目录'
node --check artifacts/happysubs-csod/popup.js
node --test tests/*.test.cjs
```

生成目录不加入 Git；保留原发行包的资源及许可文件。构建脚本只接受 2.2.2 的预期源码结构，结构不匹配时终止。

原项目：https://github.com/madebyhappy/happysubs
