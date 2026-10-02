# 0.9.1 变更（真机自检、复制诊断信息、工程化）

0.9.1 是 [ROADMAP-1.0](ROADMAP-1.0.md) 里排在 0.9.0 之后的一版。验收结果见 [ACCEPTANCE-0.9.1](ACCEPTANCE-0.9.1.md)。

- 账本字段、世界书条目、存储键都没有变化，**不需要重新导入世界书**。新增的设置只有一项 `deviceCheck`，用来保存上次真机自检的结果。
- 原版 v1.1 代码（`vendor/original`）没有修改。
- **真机结果还没有拿到。**0.9.1 把 0.9.0 的手机验收做成了酒馆里的「手机真机自检」，但要等用户在自己的 Android 手机上跑一遍、把结果发回来，才能写进 ACCEPTANCE。在那之前，手机端仍然只有 Chromium 触摸模拟的结论。

## 一、手机真机自检

入口：设置 → 兼容与维护 →「手机真机自检…」，或 兼容诊断 弹窗里的「手机真机自检」，或斜杠命令 `/zt selftest`。

屏幕顶部会出现一张小卡片，一步步带着做，大约 2 分钟。自检**不写账本、不发聊天、不调用模型**。

| 步骤 | 自动 / 需要操作 | 检查什么 |
| --- | --- | --- |
| 1 环境 | 自动 | 触摸屏、窗口与可见区域、像素比、刘海 / 手势条安全区 |
| 2 全屏 | 自动 | 终端是否铺满可见区域；内容区高度 |
| 3 各页面 | 自动 | 逐页打开终端的全部页面，测量：有没有东西超出屏幕、页面能不能左右滚动、导航 / 标签 / 发送按钮是否 ≥ 36 px、输入框是否 ≥ 16 px（含引擎页） |
| 4 聊天群 + 键盘 | **点一下输入框** | 键盘弹出后终端是否变矮、账本条是否让开、输入框是否露在键盘上方 |
| 5 私聊 | 自动打开 + **点一下输入框** | 私聊是否全屏；键盘弹出后输入框是否可见 |
| 6 悬浮莉莉丝 | 自动 | 终端打开时是否停在下角，不挡内容 |
| 7 横屏 | **把手机横过来，再转回来** | 左侧导航宽度、内容区高度 |
| 8 返回键 | **按一次返回键 / 侧滑返回** | 返回键是否只关闭终端，酒馆页面还在 |

- 需要操作的步骤最多等 25 秒，超时记为「⚠ 没等到」；每一步都可以「跳过这一步」，也可以随时「结束自检」。
- 结束后列出 ✅ / ⚠ / ❌，下面是带原始数字的文本，「复制结果」一键复制。结果保存在设置里，之后「复制诊断信息」也会带上。
- 步骤卡片的位置在最上层，点它不会被当成“点了终端外面”而关闭终端（`data-zt-keep-hub`）。

实现：`src/device-check.js`（`DeviceCheck`；纯函数 `measurePage`、`fillsView`、`summarize`）。

## 二、复制诊断信息

入口：设置 → 兼容与维护 →「复制诊断信息」，或 兼容诊断 弹窗里的按钮，或 `/zt copydiag`。

复制的是一段纯文本，反馈问题时直接粘贴：

- 插件版本、SillyTavern 版本与兼容结论；
- 浏览器 UA、语言、窗口 / 屏幕 / 可见区域、像素比、触摸屏、安全区、是否 HTTPS、是否“添加到主屏幕”运行、当前手机布局与键盘方式；
- 宿主接口逐项 ✅ / ❌；状态栏模式、最新楼层渲染状态、终端 / 莉莉丝助手 / 悬浮莉莉丝是否在运行；
- AI 接口：**只写主机名和模型名**（如 `api.example.com · gpt-x`），或「酒馆主 API」「未设置」；
- 插件设置（白名单方式：脚本变量、接管记录、浮窗位置等不导出，列表只写条数）；
- 上次真机自检结果；
- 最近 30 条插件报错：`[诸天…]` 开头的 `console.error / console.warn`，以及来自插件文件的页面错误和未处理的 Promise 错误（`ErrorLog`，在设置加载之前就开始记录，启动阶段的报错也能抓到）。

**不会出现**：API Key、脚本变量、聊天内容、账本数值、角色名。整段文本离开前再过一遍 `redact()`：`sk-… / AIza… / Bearer … / key=… / token=…`、URL 里的账号密码和查询参数、40 位以上的长串都会被遮住（报错信息里带的也一样）。

剪贴板：

- HTTPS 或本机地址：`navigator.clipboard`；
- 手机用局域网地址（`http://192.168.x.x:8000`）打开酒馆时没有安全上下文，`navigator.clipboard` 不可用，改用 `document.execCommand('copy')`；
- 两者都失败时弹出一个文本框，全选后手动复制。

实现：`src/diag-report.js`（`redact`、`settingsSnapshot`、`endpointText`、`ErrorLog`、`environment`、`buildReport`、`copyText`）。

## 三、手机端修正

- **会把整页变矮的键盘**：部分 Android WebView / 套壳浏览器弹出键盘时不缩小 `visualViewport`，而是直接把整个页面（`innerHeight`）变矮。0.9.0 只认前一种。0.9.1 在输入框获得焦点、且页面高度比原来矮 120 px 以上时，也按“键盘已弹出”处理（`keyboardState()`，`kbMode = 'resize'`）。旋转屏幕不会被误判：没有输入框获得焦点时不算键盘。

## 四、工程化

- **换行符**：仓库原有的 25 个 CRLF 文本文件全部改为 LF；新增 `.gitattributes`（`* text=auto eol=lf`，`vendor/**` 不做换行转换、保持字节不变，图片 / 字体 / 压缩包标为二进制）。之后在 Windows 上编辑也不会再出现整文件 diff。
  - 注意：这次换行符变化会让这 25 个文件在 GitHub 上显示为整文件改动，这是一次性的。
- **CI**：新增 `.github/workflows/ci.yml`（GitHub Actions）。每次 push / PR 跑 `npm ci`、`npm run check`、`npm test`、`FILELIST.sha256` 是否最新、有没有 CRLF、有没有像密钥的字符串（不含测试目录）。浏览器套件仍需隔离的酒馆，保持手动。
- **`FILELIST.sha256` 由脚本生成**：`npm run filelist` 重新生成，`npm run filelist:check` 检查（CI 里跑）。`tools/filelist.py` 遍历仓库目录，跳过 `.git`、`node_modules` 和 `FILELIST.sha256` 本身。
- **版本断言收敛**：`tests/version.test.js` 统一检查 manifest / package.json / package-lock / contracts / README / FEATURE_MATRIX / CHANGES / ACCEPTANCE 的版本一致。旧版本的测试改为“≥ 该版本”，以后升级只需改 `version.test.js` 和最新一版的测试。
- `npm run check` 的检查范围加入 `diag-report.js`、`device-check.js`。

## 五、没有做的（留在路线图里）

- `docs/evidence/` 8 MB 证据文件移出主分支：按用户决定，本版不动。
- ESLint / `tsc --checkJs`、LICENSE：留到 0.9.4。
- iPhone 真机：用户手边没有，未测。
