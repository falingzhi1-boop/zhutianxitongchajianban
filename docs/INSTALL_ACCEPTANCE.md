# 新仓库 Git 安装验收 · 已通过

> **历史记录（0.2.0 检查点）。** 本文记录的是 2026-09-29 用酒馆原生接口从 Git 安装 0.2.0 的过程，下方「限制」描述的也是当时的状态（例如当时 AI 进货/抽卡/工作台尚未迁移，这些在 0.4.0 起已迁移并在四个宿主版本上验收）。
> 当前版本的验收见 [ACCEPTANCE-0.8.0](ACCEPTANCE-0.8.0.md)：1.16 与 1.19 上 `native_v080` 33/33、`native_world070` 40/40；1.19 上 `native_terminal050` 58/58、`native_group060` 44/44、`native_guards` 通过；纯逻辑测试 92/92；1.17 / 1.18 与 `native_replace040`（需要 v1.1 原版文件）本轮未运行。安装方式没有变化，仍是扩展面板「Install extension」填仓库地址。

日期：2026-09-29

仓库：https://github.com/falingzhi1-boop/zhutianxitongchajianban

本次功能源码 commit：`a7678ddd8ea527c5b749239c06a70e27409b95c1`

## 真实执行记录

1. 在与旧工程分开的新仓库目录中导入经过哈希核对的 Git bundle；未将旧工程的本地导入 JSON、密钥或宿主数据放进新仓库。
2. 使用本机已有 Git 认证执行 `git push --dry-run origin main`，成功后正常 `git push -u origin main`，退出码 0；未使用 force push。
3. 从另一环境独立查询 `git ls-remote`，确认远端 main 是上述 commit。
4. **先移除隔离酒馆中的旧手动扩展副本**，再由 SillyTavern 原生安装接口提交：
   ```json
   {"url":"https://github.com/falingzhi1-boop/zhutianxitongchajianban","global":false}
   ```
5. `/api/extensions/install` 返回 **HTTP 200**，实际安装位置：
   ```text
   data/default-user/extensions/zhutianxitongchajianban
   ```
   返回 manifest 版本 **0.2.0**、正确文件夹名。实际 Git HEAD 与远端源码 commit 相同。
6. 刷新酒馆后，只有一个原生入口；本次不再依靠旧目录的文件。安装过程 0 pageerror。
7. 针对这个 **Git 克隆得到的实际扩展**，依次重新通过：
   - `native_acceptance.py`：原版分层渲染、正文玩家消息、重载及生命周期。
   - `native_guards.py`：发送防重、附件、历史变化与保存核验故障。
   - `native_views.py`：七个手机视图、静态回退、快速启停与聚焦草稿切换。
   - `native_ledger.py`：17组真实账本、交易、正文凭据和故障测试。
   - `native_ledger_guards.py`：同源标签锁、过期预览和保存响应期间切换角色。

五组浏览器脚本均通过，**0 pageerror**。原始结果和截图在 `docs/evidence/`。

这验证的是原生接口驱动的 Git 安装（与扩展安装界面使用同一后端），不是用复制文件夹代替 Git 安装，也不是假宿主。

后续提交仅更新验收文档、截图/结果及测试报告字段，功能运行文件仍与上述测试源码一致；没有据此宣称原版全功能完成。

## 限制

- 仅 SillyTavern 1.19.0、默认账号的按用户安装路径已验收。
- 未验证全部其他版本、所有多账号权限组合或实体手机性能。
- 不曾调用真实模型。AI进货/抽卡/工作台/自动记忆等能力仍按功能矩阵列为待迁移。
- 该检查点不是全功能正式发行版；没有创建宣称稳定版的 GitHub Release。
