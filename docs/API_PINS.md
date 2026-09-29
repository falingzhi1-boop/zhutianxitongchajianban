# 来源与宿主接口固定点

## 原版

- 仓库： https://github.com/falingzhi1-boop/zhutian-system-v1.1/tree/main/remote
- commit：`3ee2db2e1388f9843335962c370888f746228d94`
- 原五文件哈希：`vendor/original/provenance.json`
- 原模块采用闭包私有命名空间；注入平台 atob 供原动画权重解码。原模块正文不修改；旧 Tavern Helper adapter 不执行。
- 可运行 `python tools/extract_original.py` 从原文件重复生成完全一致的 runtime。

## SillyTavern

- 仓库： https://github.com/SillyTavern/SillyTavern
- 版本 1.19.0，commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`
- `public/scripts/extensions.js`：manifest hooks；activate 同步返回，异步初始化由扩展内部承接。
- `public/scripts/st-context.js`：getContext、chatMetadata、eventSource、saveChat、setExtensionPrompt 等。
- `public/script.js`：**内部导出** `sendMessageAsUser(messageText,messageBias,insertAt=null,compact=false,name=name1,avatar=user_avatar)`，以及 `is_send_press`。不能假定 sendMessageAsUser 位于 getContext。
- `saveChatConditional` 会捕获保存异常，因此其 Promise 完成不能独立证明写盘成功。本扩展额外读取 `/api/chats/get` 核对消息凭据。
- `src/endpoints/chats.js`：POST `/api/chats/get`，请求体 avatar_url、file_name，使用宿主 CSRF headers。
- `/version` 读取字段 `pkgVersion`；确切版本门槛是 1.19.0，不是“所有 1.19+”。
- `public/lib/eventemitter.js`、`public/scripts/events.js`：APP_READY 对后加入的订阅者自动触发；初始化等待 APP_READY，停用清理订阅。
- `public/scripts/chats.js`：附件输入 `file_form_input`；有待处理附件则拒绝本次发送。
- 正文展示选择器：`#chat .mes[mesid="i"] .mes_text`。只追加无执行行为的标记，不重写宿主正文。

## Tavern Helper：仅存储位置参考

- 仓库： https://github.com/N0VI028/JS-Slash-Runner
- commit `519599bc68247d8e759cc844a983f8f5252941a8`
- `src/function/variables.ts`：chat 类型变量储存在 `chat_metadata.variables`。
- 仅用于核实存储映射；没有把 Helper 装到验收宿主，也不是此检查点已实现功能的运行依赖。

## 接口边界

这是带明确版本固定点的内部接口适配器，不是通用稳定公共 API。未来宿主改版必须重新核对接口、DOM 和保存语义。代码里的意图快照和发送锁只覆盖本扩展；宿主或其他扩展仍可并发切换/改写聊天。本检查点能发现部分发送期间上下文变化并警告，但未实现跨扩展、跨浏览器标签的原子事务。

## 0.2.0 新增的固定接口

- `src/endpoints/chats.js`：POST `/api/chats/save` 接收 `avatar_url`、`file_name`、`chat` 数组；第一行为原 header/metadata，后续为消息。显式捕获目标；`force:false`；要求响应 `ok:true`，之后真实读回整个预期记录核对。
- `/api/chats/save` 的 integrity 不是每次递增的 CAS 版本，不宣称跨设备原子事务。
- `public/script.js`：`ensureSwipes` 不处理 `extra.isSmallSys` 消息。原生结算使用该标记，避免显示阶段增加未写入磁盘的 swipe 字段。
- `context.addOneMessage` 只在磁盘结果已核实且当前上下文未变化时用于显示已持久化系统消息，不调用生成接口。
- `src/endpoints/extensions.js`：安装入口 POST `/api/extensions/install`，JSON 参数 `url`、`global`、可选 `branch`。安装验收在隔离实例进行。
- 原内核：`vendor/original/ledger-kernel.js` 中52函数与常量逐段提取自原 part2；物品奖励规划和入包回调提取自原助手。范围与哈希见 `ledger-provenance.json`。
- 安全覆盖层明确增加 `任务实物凭据` 到原模型变量指令保护表；原五文件字节不改动。
