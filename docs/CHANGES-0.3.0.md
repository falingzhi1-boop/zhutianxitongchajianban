# 0.3.0 变更记录

基线：`main` @ `a7678dd`（0.2.0 开发检查点）。本版本在 SillyTavern **1.16.0 / 1.17.0 / 1.18.0 / 1.19.0** 四个隔离真实宿主上跑过浏览器验收，结果见 `docs/ACCEPTANCE-0.3.0.md`。
哪些功能已经迁移、哪些还没有，以 `docs/FEATURE_MATRIX.md` 为准；本文件只记录改了什么。

## 1. 版本兼容：1.19 独占 → 1.16–1.19

- `manifest.json`：`minimum_client_version` 1.19.0 → **1.16.0**。
- 新增 `src/compat.js`：版本解析与比较、支持级别（已验收 / 同版本线 / 新于验收范围 / 过旧）、按能力探测宿主接口；
  用动态 `import('/script.js')` 取宿主内部导出，某个导出缺失时只停用相关功能，不会让整个扩展加载失败。
- `index.js` 重写：1.17 起走 manifest `activate` 钩子；**1.16 没有扩展生命周期钩子**，此时自动自启动（`selfStart`），日志写“宿主无扩展生命周期钩子（<1.17），自动启动”。
- 去掉 0.2.0 的 `HOST_VERSION === '1.19.0'` 硬门槛；`contracts.js`、`host-adapter.js`、`ledger-service.js` 改为依据能力探测结果运行。
- 宏：1.17 起默认启用的新宏引擎走 `macros.register`；1.16 默认关闭新引擎，额外注册旧 `MacrosParser` 条目；在设置保存时重新检查，运行中切换开关宏也不会失效。
- `terminal.js`：徽标“原生开发版 · 0.2.0”改为读取 `VERSION`，页脚显示实际宿主版本，不再写死 “SILLYTAVERN 1.19.0”。

## 2. 未迁移功能迁移

- **原版状态栏 v3.1 原生运行**（`src/statusbar-host.js` + `src/th-bridge.js`）：原生扩展直接渲染 `<ZhuTianPanel>`，不需要正则脚本，也不需要酒馆助手。
  原版 8 个分页（基础、羁绊、任务、万象、商城、背包、外挂、神通）都在消息内的 iframe 里运行；它用到的 7 个酒馆助手接口
  （`getVariables`、`replaceVariables`、`updateVariablesWith`、`getLastMessageId`、`getCurrentMessageId`、`generateRaw`、`SillyTavern`）
  都由原生桥接实现，并写回同一位置 `chat_metadata.variables`。原文件经 `tools/extract_original.py` 生成，并做哈希校验。
- **原版莉莉丝助手原生运行**（`src/assistant-host.js`）：原 v1.1 助手（工作台、记忆档案、规则藏书、连接设置、运行状态、私聊、剧情语音框、账本助理）
  在原生桥接上运行，不需要酒馆助手；旧助手脚本里的 API、界面和私聊框配置会一次性只读导入。
- **外挂世界书**（`features.js`）：一键安装“诸天万界最强系统”世界书（35 条内置规则），可绑定为当前聊天的聊天世界书；已存在同名世界书时只绑定、不覆盖。不依赖角色卡 MVU。
- **新聊天初始化 / 旧存档迁移 / 账本回滚**：`/zt init`；迁移报告（账本、记忆、私聊、旧脚本配置、结算凭据）；账本自动备份，可回滚到任一份。
- **扩展设置抽屉**（`src/settings.js`）：总开关、状态栏模式、实时层数、HUD、快捷键、立绘模式等。

## 3. 真 Live2D 与 AI 差分立绘（`src/portrait.js`）

- 三种立绘模式：`rig`（原版分层参数动画）、`variants`（AI 差分立绘）、`live2d`（真 Live2D）。
- **真 Live2D**：PixiJS 6.5.10 + pixi-live2d-display 0.4.0（`vendor/live2d/`，MIT）。支持 Cubism 3/4/5 的 `.model3.json`。
  - Cubism Core 是专有软件，按许可证**不打包**：用户勾选同意 Live2D Proprietary Software License 后才会加载，地址可以是官方地址或 `user/files` 里的副本。
  - PixiJS 与其他扩展隔离：加载前后恢复其他扩展的全局 `PIXI`。
  - 模型按高度适配、底部对齐，上下不留空白；视线跟随鼠标；点触使用模型自己的 HitArea，播放 Tap 动作和原版莉莉丝的对白气泡。
  - 点触时完整播放原版表情时间线（例如 surprised → pout → neutral），不再只取最后一帧。
  - 口型同步：有 TTS 音频时按音量驱动，否则按正文长度做节奏包络，写入 `ParamMouthOpenY`。
  - Tap 动作会预加载；首次调用只预约不播放时自动重试一次。
  - 连续应用设置时用代次令牌保证只保留最新一次加载，不会叠出两个 Pixi 实例。
  - **表情映射表**：表情名无法自动识别的模型（例如 `f00…f07` 或其他语言命名），可逐个指定 8 种语气对应哪个表情，选中即在模型上预览，保存时不会重载模型。
- **分层 PSD 导出**（`src/psd-export.js`）：把原版莉莉丝的分层素材导出成真正的分层 PSD（背景、左翼、右翼、尾巴、身体，外加 8 个隐藏的表情图层；RGB 8 位，图层名为 Unicode），
  可直接用 Cubism Editor 打开，切 ArtMesh、绑定参数后导出 `.moc3`。这是把原版立绘做成真正 Live2D 模型的路线；程序本身无法凭空生成 `.moc3`。
- **AI 差分立绘**（`assets/lilith/variants/`，来源见其中的 `PROVENANCE.md`）：
  - 7 张 AI 表情差分（微笑、害羞、嘟嘴、惊讶、眨眼、坏笑、委屈）加原图“平静”。只改脸部，经特征点对齐、色彩匹配和羽化后合成回原图，身体和背景像素与原图完全一致；表情之间用 1 秒交叉淡入。
  - 1 张 AI 姿势“比心”（哥特长裙，透明底），叠在原版去掉角色的静止背景 `plate` 上，背景不做任何动画。
  - “抱臂”“侧坐”两个姿势的素材尚未生成，设置里标为“素材待补”，选中时自动回落到标准站姿。

## 4. 新功能

- 输入栏上方的账本 **HUD**（系统点、世界、货币、任务），点击打开莉莉丝窗口。
- **快捷键**：Alt+Z 打开莉莉丝、Alt+X 打开契约终端、Alt+S 跳到最新状态栏。
- **斜杠命令** `/zt`（别名 `/zhutian`）：`open|terminal|status|init|world|backup|diag|points|live2d [off]`。
- **宏**：`{{zt_points}}`、`{{zt_world}}`、`{{zt_task}}`，可以在提示词、正文模板里直接引用账本。
- **兼容诊断面板**（`/zt diag`）：宿主版本、支持级别、逐项接口状态、状态栏模式、莉莉丝助手的真实运行状态（读取原版自己的状态行）、立绘模式。

## 5. 浏览器验收中发现并已修复的问题

1. **莉莉丝助手没有真正启动**：原版代码检查的是酒馆助手 iframe 里的 `SillyTavern`（它本身就是上下文对象），而桥接传入的是宿主顶层命名空间，
   导致原版报“当前脚本上下文缺少 SillyTavern 身份接口”并停在未启动状态（窗口能打开，但工作台、私聊、分层动画都没运行）。
   现在改为每次读取都获取最新 `getContext()` 的实时代理（`stContextProxy`）。验收脚本也改为检查原版状态行和分层舞台，不再只看窗口是否存在。
2. **扩展设置的嵌套修改会丢失**：`Settings.all` 每次读取都替换成新的克隆对象，`all[key] = merge(all[key], …)` 会写进已经被丢弃的对象。
   立绘模式、Live2D 全部设置都因此无法保存。现在改为原地补默认值，保持对象身份不变（有回归测试）。
3. **PSD 右翼缺失**：翅膀裁剪框是逻辑坐标（424×632），素材却是 636×948，右翼因此被裁空后丢掉。现在按比例缩放裁剪框，导出 13 个图层，并已用独立解析库 psd-tools 核对。
4. 立绘模块原先针对的是 1.7.1 的舞台结构；现在直接挂在原版分层舞台（`.zt-stage > .zt-media`）上，点触各部位时 AI 差分会跟着原版表情时间线切换。

## 6. 测试与工具

- `tests/native030.test.js`：版本门槛、设置持久化回归、SillyTavern 代理、Live2D 辅助函数、AI 差分清单、PSD 编码器、四处版本号一致性。
- `package.json` 的 `check` 覆盖全部新增源文件、两个原版运行时，并执行 `tools/extract_original.py --check`。
- `tools/lilith_variants_compose.py`、`tools/lilith_variants_key.py`：AI 差分的对齐合成脚本和抠像脚本，可重复生成。
