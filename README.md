# 诸天 · 莉莉丝契约终端

**0.3.0 原生 SillyTavern 扩展｜支持 SillyTavern 1.16–1.19｜需要模型的原版功能尚未完成模型验收**

原版状态栏 v3.1、原版莉莉丝助手、沉浸终端、真实正文互动和原版结算内核，都直接跑在原生扩展里，**不需要酒馆助手，也不需要正则脚本**；另外提供真 Live2D 和 AI 差分立绘。不使用概念样机的虚构经济规则。

> 本版本新增已有账本的结算写入能力，**默认关闭**。先在隔离副本中验收并备份，再停用旧状态栏和旧助手。不得同时启用两个结算引擎。此版本尚不能替换原版全套功能。

![隔离酒馆中的原生万界交易界面](docs/evidence/commerce-desktop.png)

*截图使用明确标记的隔离测试账本，不是为新用户自动生成的余额。*

## Git 安装

在 SillyTavern 的“扩展 → 安装扩展”中粘贴：

```text
https://github.com/falingzhi1-boop/zhutianxitongchajianban
```

支持并在隔离真实宿主上验证过 **SillyTavern 1.16.0、1.17.0、1.18.0、1.19.0**；低于 1.16 拒绝加载，高于 1.19 按接口能力探测运行。安装后刷新页面，打开单角色聊天，点击左下方原版莉莉丝头像（或按 Alt+Z）。支持 HTTPS 或 localhost 安全上下文；交易写入要求浏览器提供 Web Locks。

- 仓库根目录直接包含 `manifest.json`，没有额外套一层目录。
- 前端运行不需要 `npm install`，也不需要酒馆助手。如果仍然开着旧的状态栏正则或旧的莉莉丝助手脚本，本扩展会自动让位或提示停用，避免重复渲染和重复计费。
- 请勿同时安装旧的 `zhutian-covenant-terminal` 手动副本和这个 Git 仓库副本。
- **“扩展可以安装”不等于“全部原版功能已经迁完”。** Git 安装验收的具体结果以 `docs/INSTALL_ACCEPTANCE.md` 为准。

## 0.3.0 新增

完整变更见 [CHANGES-0.3.0](docs/CHANGES-0.3.0.md)，验收结果见 [ACCEPTANCE-0.3.0](docs/ACCEPTANCE-0.3.0.md)。

- **1.16–1.19 兼容**：1.17 起用扩展钩子，1.16 自动自启动；接口按能力探测，缺哪个接口就只停用对应功能。
- **原版状态栏原生运行**：8 个分页（基础、羁绊、任务、万象、商城、背包、外挂、神通）都在消息内运行，数据写回原位置。
- **原版莉莉丝助手原生运行**：工作台、记忆档案、规则藏书、连接设置、运行状态、私聊、剧情语音框。
- **外挂世界书**一键安装并绑定到当前聊天（35 条内置规则，已存在时不覆盖，不依赖角色卡 MVU）；新聊天初始化 `/zt init`；旧存档迁移报告；账本备份和回滚。
- **真 Live2D**：加载任意 Cubism 3/4/5 模型，支持表情映射、Tap 动作、HitArea 点触气泡、口型同步和视线跟随。Cubism Core 不打包，同意许可后才加载，见 [vendor/live2d/LICENSES.md](vendor/live2d/LICENSES.md)。
- **莉莉丝分层 PSD 导出**：可以直接在 Cubism Editor 里绑定，做成莉莉丝本人的 Live2D 模型。
- **AI 差分立绘**：8 种表情（只替换脸部，身体和背景像素不变），外加“比心”姿势（静止背景）。来源见 [PROVENANCE](assets/lilith/variants/PROVENANCE.md)。
- **HUD、快捷键 Alt+Z/X/S、`/zt` 命令、`{{zt_points}}`、`{{zt_world}}`、`{{zt_task}}` 宏、兼容诊断面板、扩展设置抽屉。**

## 0.2.0 新增

### 万界交易

- 从原始 `statusbar-v3.1-part2.js` 提取 **52 个原函数**，保留原面板、任务、功法/资源派生及估值规则。
- 最新角色回复中的 `ZhuTianPanel`：**预览 → 明确确认 → 结算**，不自动扫描旧历史发奖。
- 任务实物奖励沿用原助手的**事前承诺、正文证据、品级/数量与稳定凭据校验**。奖励消耗后不会再补发。
- 已有商城库存购买：沿用名望折扣、向上取整、单件入包和售出标记。
- 背包单件使用、单件回收：消耗品扣一件，非消耗品保留；回收采用原估值规则。
- **系统结算记录直接保存在正常聊天正文**，清晰区分于玩家行动和模型回复。

### 写入与失败处理

预览绑定整个聊天与元数据快照；同源标签使用 Web Locks；提交前核对服务器存档，保存时捕获固定角色/聊天目标，不在 await 后重新推断目标。

一次保存同时包含账本、操作凭据和系统消息，随后读取服务器记录核对。网络状态不明时冻结交易、不自动重试、不偷偷退款；请停止操作该聊天，重载并人工核对。

**这不是跨所有客户端的服务端 CAS 事务。** 同源 Web Locks 不锁住其他浏览器、设备或不合作的扩展。请勿并发操作同一个聊天。

正文被编辑、删除或切换分支后，与既有结算来源不一致时会冻结交易，不擅自回滚已花费余额。需要在备份副本上人工核对。

## 已保留的 0.1 能力

- 原版莉莉丝立绘、表情、分层参数动画、注视与点触（默认的 `rig` 模式）。真 Live2D 是另一种模式，需要用户自己提供 `.model3.json` 模型。
- 原生常驻入口、全屏终端、手机角色面板，现在共七个视图。
- 莉莉丝及其他角色的**玩家行动**进入真实主聊天；逐字预览、勾选确认、保存回读，不覆盖主输入框草稿。
- 读取原任务、背包、角色名、35 条内置规则以及原记忆有效分支。
- 明确启用后使用原版回忆算法；不开启自动付费整理。
- WebGL 不可用回退原图，关闭终端和减少动态效果偏好可暂停动画。

## 尚未迁移

以下功能的原版界面和逻辑已经在原生桥接上运行，但都需要调用模型，而验收环境没有密钥、没有做真实模型调用，所以**尚未完成模型验收**：
AI 进货、抽卡、许愿、神通和外挂的支付类动作、背包 AI 整理、自动记忆整理与补读、独立 API 私聊、工作台的模型请求、流式回复。不会用预设对白冒充 AI 回答。

还没有完成的：莉莉丝本人的 Live2D 模型（需要用导出的 PSD 在 Cubism Editor 里人工绑定）、“抱臂”“侧坐”两个 AI 姿势的素材、移动端布局验收、群聊。

全新聊天不会填入模拟余额。`/zt init` 按原版初始结构创建账本，但 0.3.0 只在已有账本的聊天上验证过它的幂等性，没有在全新空聊天上做浏览器验收。

见 [功能矩阵](docs/FEATURE_MATRIX.md)、[验收报告](docs/ACCEPTANCE.md)、[接口固定点](docs/API_PINS.md)。

## 数据位置

| 数据 | 位置 |
|---|---|
| 原账本 | `chatMetadata.variables.诸天系统` |
| 原记忆 | `chatMetadata.variables.诸天记忆助手_v1` |
| 本扩展开关与原生凭据 | `chatMetadata.zhutianCovenantTerminal` |
| 正文玩家互动 / 系统凭据标记 | `message.extra.zhutianCovenantTerminal` |
| 回忆提示命名空间 | `zhutian-covenant-terminal/memory` |

已发送的消息和已执行交易不会在停用时删除或自动回滚。停用清理的是入口、UI 装饰、事件、动画及本扩展提示。退回 0.1 或旧状态栏不能自动撤销 0.2 已写入的真实账本，请使用事先备份。

## 手动安装与开发

手动放置时，目录为 `public/scripts/extensions/third-party/zhutianxitongchajianban/`，其中直接包含 `manifest.json`。ZIP 是源码/目录安装包，不是声称酒馆支持上传 ZIP 安装。

```bash
npm ci                    # 仅开发与提取工具需要；前端运行不需要
npm run check
npm test
npm run extract:ledger    # 从保留的原五文件中重建两个原版内核
python tools/extract_original.py
```

浏览器验收需要 Python Playwright、Chromium，以及运行中的隔离 SillyTavern（0.3.0 的四版本验收过程和结果见 `docs/ACCEPTANCE-0.3.0.md`）。

**下列脚本会创建/重置“隔离验收”和“结算 QA”测试聊天，禁止指向生产酒馆；按顺序运行，不要并行。**

```bash
python tests/native_acceptance.py --isolated-test-only
python tests/native_guards.py --isolated-test-only
python tests/native_views.py --isolated-test-only
python tests/native_ledger.py --isolated-test-only
python tests/native_ledger_guards.py --isolated-test-only
```

默认宿主为 `http://127.0.0.1:8010`，支持 `--base-url`。前三个回归脚本可用 `--extension-folder` 指定安装文件夹名，默认是本仓库名。

## 来源与交付原则

原版来源：用户指定的 [zhutian-system-v1.1/main/remote](https://github.com/falingzhi1-boop/zhutian-system-v1.1/tree/main/remote)，本轮再核对仍为 `3ee2db2e1388f9843335962c370888f746228d94`。

五个原文件完整同名保留于 `vendor/original/`，不执行旧宿主适配器。提取范围和哈希见两个 provenance JSON。原源码与素材权利归原权利人；星海背景来自前一轮 AI 概念美术，莉莉丝使用原版资源。

**原项目的两个本地导入 JSON 不在本仓库，也不会上传。** 本轮未修改旧状态栏匹配规则或正则 HTML。宿主本体、隔离配置、账号数据、依赖目录和连接凭据均不随扩展交付。
