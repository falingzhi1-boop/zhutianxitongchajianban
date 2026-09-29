# 0.1.0 阶段文件与交付范围（历史记录）

## 新增的原生扩展文件

- `manifest.json`：原生扩展声明、精确适配范围对应的最小客户端门槛、生命周期钩子。
- `index.js`：等待宿主的异步启动、快速启停防重、实例清理。
- `src/contracts.js`：身份、快照、意图规范化、能力矩阵。
- `src/host-adapter.js`：真实宿主适配、原变量只读、原回忆提示、明确确认后的玩家发送及服务器读回。
- `src/terminal.js`：六视图、原版立绘挂载、正文惰性标记、移动面板、交互草稿。
- `styles/host.css`、`styles/shell.css`：宿主入口、聊天标记、隔离终端的完整样式。
- `assets/original/lilith.webp`、`avatar.webp`：从原素材中提取。
- `assets/star-sea.jpg`：沿用前一轮星海概念背景。
- `vendor/original/runtime.js`：提取的原版模块私有封装。
- `vendor/original/provenance.json`：来源、基线及哈希。
- `tests/contracts.test.js`：15 项纯逻辑/来源测试。
- `tests/native_acceptance.py`、`native_guards.py`、`native_views.py`：真实隔离宿主验收，需明确隔离运行参数。
- `tools/extract_original.py`：可复现的原模块提取。
- `package.json`、`.gitignore`、`README.md`、本目录文档、原始验收 JSON、四张宿主截图。
- `FILELIST.sha256`：包内文件校验清单，不包含自身。

## 原五文件

`assistant-v1.1.js`、`statusbar-v3.1.css`、`statusbar-v3.1-part1.js`、`statusbar-v3.1-part2.js`、`statusbar-v3.1-part3.js`：完整同名保留于 `vendor/original/`，字节未改动；不是把零散补丁当作原文件交付。它们是迁移基线，不在此检查点中整体执行旧宿主脚本。

## 未发生的操作

- 未改写原 GitHub 仓库，未推送到任何新仓库，未发布。
- 未修改原状态栏匹配规则/正则加载 HTML，未改动或上传那两个本地导入 JSON。
- 未迁移、重置用户旧存档，未接入模型密钥，未进行模型计费请求。
- 未把隔离酒馆本体、其运行配置、测试账号目录、MCP 连接文件或任何依赖缓存打入扩展包。

## 另一个旧交付物

前一轮独立 HTML 概念样机的莉莉丝资源也已恢复原图。它仍是独立模拟样机，不计作本原生扩展的功能验收，也没有被混装进新扩展 ZIP。
