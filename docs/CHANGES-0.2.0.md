# 0.2.0 完整文件变更

新功能文件：
- `src/ledger-plan.js`：原规则克隆试算、强来源哈希、历史校验。
- `src/ledger-service.js`：显式预览、Web Locks、前置服务器对照、固定目标保存、回读及歧义冻结。
- `vendor/original/ledger-kernel.js`、`reward-kernel.js`、`ledger-provenance.json`：可追溯的原内核提取产物。
- `tools/extract-ledger.mjs`：基于 Acorn AST 选择函数，不运行旧 DOM 绑定器。
- `tests/ledger.test.js`、`native_ledger.py`、`native_ledger_guards.py`：纯逻辑、真实账本、故障、同源并发及聊天切换测试。

完整更新：
- `manifest.json`、`package.json`、新增 `package-lock.json`：0.2.0、实际仓库 URL、开发工具依赖。
- `src/host-adapter.js`、`src/terminal.js`、`src/contracts.js`：七视图、真实开关、操作确认、正文系统凭据、准确能力矩阵。
- `styles/host.css`、`styles/shell.css`：万界交易、原库存卡片、结算预览和正文凭据。
- 三个原生回归脚本：支持真实 Git 仓库安装后的目录名；手机覆盖七视图。
- README、功能矩阵、验收记录、来源说明和截图。

原五文件未改动，旧本地导入 JSON 未包含、未上传。原项目 Git 仓库未改写。新仓库与旧工程分开。
