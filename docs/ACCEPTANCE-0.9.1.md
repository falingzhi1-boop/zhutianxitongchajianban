# 0.9.1 真实宿主浏览器验收

## 环境

- SillyTavern 1.19.0（官方 tag 全新安装，commit `7e8663cd9c184a550b37238218bdd32c6efc68e9`），隔离数据目录，**没有安装酒馆助手**；
- Playwright Chromium（无头）：
  - 手机：390×844，`has_touch` + `is_mobile`，Android 14 / Chrome 129 的 UA，授予剪贴板读写权限；
  - 电脑：1400×900，鼠标；
- 模拟模型：5001 普通，5002 不发 CORS 头。

全程没有使用真实 API Key、真实聊天记录或 v1.1 原版导入文件。测试用的“密钥”是写死在 `tests/native_v091.py` 里的假字符串，测试结束后恢复原来的接口配置。

**本轮只测了 1.19。** 1.16 / 1.17 / 1.18 没有运行；0.9.1 没有改宿主接口。

## 真机结果

**待补。**用户的 Android 手机跑完「手机真机自检」并发回复制的结果后，填在这里：

| 手机 / 浏览器 | 酒馆打开方式 | 结果 | 备注 |
| --- | --- | --- | --- |
| （待回传）Android | | | |
| iPhone / Safari | — | **未测**（手边没有设备） | |

## 结果总览（1.19，Chromium 模拟）

| 套件 | 结果 |
| --- | --- |
| `native_v091.py`（0.9.1 新增，35 项） | 35/35 |
| `native_v090.py` | 24/24 |
| `native_v085.py` | 20/20 |
| `native_v084.py` | 29/29 |
| `native_v083.py` | 13/13 |
| `native_v082.py` | 24/24（跳过酒馆助手角色卡一段：本实例未装酒馆助手） |
| `native_v081.py` | 20/20 |
| `native_v080.py` | 33/33 |
| `native_group060.py` | 44/44 |
| `native_world070.py` | 40/40 |
| `native_terminal050.py` | 58/58 |
| `native_guards.py` | ✅ 无页面错误、无模型请求、生成期间拒绝发送（`docs/evidence/guards.json`，已重新生成为 0.9.1） |
| `native_replace040.py` | **未运行**（需要不上传的 v1.1 原版文件） |
| `npm run check` | ✅（检查范围新增 `diag-report.js`、`device-check.js`） |
| `npm test` | 180/180（0.9.0 为 164，新增 `v091.test.js` 与 `version.test.js`） |
| `npm run filelist:check` | ✅ |
| CRLF 检查 | ✅ 仓库里没有 CR 字符（`vendor/` 原本就是 LF，字节未变，`extract_original.py --check` 通过） |

GitHub Actions（`.github/workflows/ci.yml`）要推送到 GitHub 后才会第一次运行；上表是在本地执行同样的命令。

## native_v091.py 检查了什么

### 复制诊断信息（手机，安全上下文）

先用插件自己的 `saveConfigs()` 写入一个假接口：`https://api.example.com/v1`、假 Key、模型 `m-test-1`；再打出一条带着假 Key 和 `https://u:pw@relay.example/v1?key=zzz` 的 `[诸天]` 警告。然后调用「复制诊断信息」，从剪贴板读回：

| 项目 | 结果 |
| --- | --- |
| 开头 `【诸天终端诊断信息】`，插件 0.9.1、SillyTavern 1.19.0 | ✅ |
| 浏览器 UA（Android 14）、可见区域 390×844、手机布局 `port` | ✅ |
| 宿主接口逐项、插件设置（`"mobileLayout":"auto"`） | ✅ |
| AI 接口一行：`api.example.com · m-test-1` | ✅ |
| 最近报错里有这条警告：`[诸天] 测试报错，带着密钥 sk-*** 和 https://***@relay.example/v1?***` | ✅ |
| 整段文本里没有假 Key、没有 `pw@`、没有 `key=zzz` | ✅ |
| 还没自检时写「没有运行过」 | ✅ |

### 复制诊断信息（没有安全上下文）

把 `isSecureContext` 改成 `false`（等同手机用 `http://192.168.x.x` 打开酒馆）：走 `execCommand('copy')`，复制出的文本以 `【诸天终端诊断信息】` 开头 ✅。

### 手机真机自检（按用户的操作方式走一遍）

键盘：无头 Chromium 没有屏幕键盘，和 0.9.0 一样把 `visualViewport` 换成可控对象，点按输入框后把可见高度改为 470 px。

| 步骤 | 测试里怎么做 | 结果（原始数字） |
| --- | --- | --- |
| 环境 | 自动 | ✅ 触摸屏，窗口 390×844 |
| 全屏 | 自动 | ✅ 铺满可见区域，内容区 646 px |
| 各页面 | 自动 | ✅ 20 页都没有超出屏幕、横向滚动、过小按钮或小字号输入框 |
| 聊天群 + 键盘 | 触摸点按群输入框 → 可见高度 470 | ✅ 终端高 470 px，输入框在 416–460，账本条隐藏 |
| 私聊 · 全屏 | 自动打开 | ✅ 铺满可见区域 |
| 私聊 · 键盘 | 触摸点按私聊输入框 → 可见高度 470 | ✅ 输入框在 362–422，键盘上方 |
| 悬浮莉莉丝 | 自动 | ✅ 停在下角（top 697） |
| 横屏 | 视口改为 844×390，再改回 390×844 | ✅ 左侧导航 77 px，内容区 250 px |
| 返回键 | 浏览器后退 | ✅ 终端关闭，酒馆页面还在，扩展仍在运行 |

另外：

| 项目 | 结果 |
| --- | --- |
| 结果第一行 `诸天 0.9.1 真机自检：✅ 9 · ⚠ 0 · ❌ 0 · 跳过 0`，保存在 `settings.deviceCheck` | ✅ |
| 「复制结果」后剪贴板就是这段结果 | ✅ |
| 「关闭」移除卡片 | ✅ |
| 之后「复制诊断信息」带上「上次真机自检」 | ✅ |
| 在第一个需要操作的步骤点「结束自检」：结果写「已手动结束」，没有 ❌ | ✅ |
| 浮动窗口模式 +「点击终端外部时关闭 = 总是」：点步骤卡片上的按钮，按钮生效、终端不关闭 | ✅ |
| 整页变矮的键盘：聚焦群输入框后视口 844→470（`visualViewport` 跟着变）→ `kbMode = 'resize'`，终端 470 px，账本条隐藏，输入框底部 460 | ✅ |
| 失去焦点、恢复 844 后 → 键盘状态清除，终端 844 px | ✅ |
| 手机两段都没有页面错误 | ✅ |

截图：`/var/tmp/qa/shots091/v091-selftest-step.png`（第 4 步卡片）、`v091-selftest-done.png`（结果）。人工看图：卡片在顶部、不挡输入框；结果列表、文本框和三个按钮在 390 宽内完整显示。截图未放进 `docs/evidence/`（按决定本版不动证据目录）。

### 电脑（1400×900，鼠标）

| 项目 | 结果 |
| --- | --- |
| 兼容诊断 弹窗有「复制诊断信息」「手机真机自检」两个按钮 | ✅ |
| 设置页有 `copy-diag`、`selftest` 两项 | ✅ |
| 无页面错误 | ✅ |

## 单元测试新增（`tests/v091.test.js`、`tests/version.test.js`）

- `redact`：`sk-`、`AIza`、`Bearer`、`"apiKey":… / token=`、URL 账号密码、查询参数被遮住；普通 URL、提交哈希、中文和数字原样保留；
- `settingsSnapshot`：不导出脚本变量、接管记录、浮窗位置，列表变成条数；
- `endpointText`：只有主机名 + 模型；酒馆主 API；未设置；无法解析；
- `ErrorLog`：只收 `[诸天` 开头的日志（其他日志照常输出到控制台）、超过上限丢最早的（默认 30，测试用 3）、报错里的 Key 被遮住、`dispose()` 后还原 `console`；
- `keyboardState`：`visualViewport` 缩小、整页变矮 + 聚焦、旋转（无聚焦）不算键盘；
- `buildReport`：各部分齐全、全文无 Key，某一部分读取失败时写「读取失败」而不是整段失败；
- `summarize`、`fillsView`；
- 设置页、兼容诊断、斜杠命令都接上了；`.gitattributes`、CI 工作流、`tools/filelist.py` 存在且内容正确；
- 版本：contracts / manifest / package.json / package-lock 两处 = 0.9.1；README 开头和小节、功能矩阵标题、CHANGES、ACCEPTANCE。

## 未验证

- **真实手机**：Android 结果待回传；iPhone、小屏 360 宽、套壳浏览器 / Termux 未测。
- 真实输入法（候选栏、第三方键盘、悬浮键盘）的高度变化。
- 真实手机浏览器在非 HTTPS 下的 `execCommand('copy')` 行为（各浏览器支持程度不同；失败时会弹出文本框手动复制）。
- 1.16 / 1.17 / 1.18。
- GitHub Actions 第一次在 GitHub 上运行。
