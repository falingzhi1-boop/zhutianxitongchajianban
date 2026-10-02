// 1.0 统一错误提示：发生了什么 · 账本有没有改动 · 下一步怎么做。
// Only says "账本没有改动" when the error comes from a check that runs BEFORE any write (or from a request whose fee is
// refunded on failure); a failed read-back says the ledger may have changed and points to the rollback; anything
// unknown gets no ledger claim at all.
const RULES = [
    // read-back / partial write — the one case where the ledger may have changed
    { re: /读回不一致|写入状态不明|已冻结/, ledger: '可能已经写入', next: '打开 设置 → 旧存档迁移 / 账本回滚，核对后需要的话回滚到上一份备份' },
    { re: /只读|结构版本/, ledger: '没有改动（只读）', next: '更新插件到最新版' },
    { re: /聊天已经切换|取消写入|未写入|已停止发动/, ledger: '没有改动', next: '回到原来的聊天再试一次' },
    { re: /群聊暂不写入|请先打开单角色聊天|请先打开/, ledger: '没有改动', next: '打开一个单角色聊天后再试' },
    { re: /Web Locks/, ledger: '没有改动', next: '换用较新的浏览器（Chrome / Edge / Safari 16+）' },
    { re: /已有操作正在进行|正在生成|扩展已停用/, ledger: '没有改动', next: '等当前操作或 AI 回复结束后再试' },
    { re: /不足|只有 [\d,]+ ?点|余额/, ledger: '没有改动', next: '先攒够系统点，或选择更便宜的选项' },
    { re: /请填写|请选择|不能为空|格式不对|无法识别|不是有效/, ledger: '没有改动', next: '按提示补全或改正后再试' },
    { re: /超时|timeout|timed out/i, ledger: '没有改动（费用已退回）', next: '稍后重试；思考模型可以在 设置 → 连接 把超时调长' },
    { re: /HTTP ?(401|403)|unauthori[sz]ed|invalid api key|密钥/i, ledger: '没有改动', next: '在 设置 → AI 接口设置 检查 API 密钥' },
    { re: /HTTP ?(429)|rate limit|限流|too many/i, ledger: '没有改动', next: '请求太频繁，等一会儿再试' },
    { re: /HTTP ?5\d\d|Failed to fetch|NetworkError|网络|连接失败|ECONN|502|503|504/i, ledger: '没有改动（费用已退回）', next: '检查网络或中转站是否可用，稍后重试' },
    { re: /解析|没有按格式|格式错误|JSON/i, ledger: '没有改动（费用已退回）', next: '重试一次；经常出现时换一个更守格式的模型' },
    { re: /世界书/, ledger: '', next: '打开 设置 → 世界书安装 / 绑定 / 解绑 查看状态' },
];

/** {what, ledger, next} for an error (pure). `ledger` / `next` are '' when nothing reliable can be said. */
export function explain(err) {
    const what = String(err?.message ?? err ?? '未知错误').trim().replace(/\s+/g, ' ') || '未知错误';
    if (/账本[:：]|下一步[:：]/.test(what)) return { what, ledger: '', next: '' };     // already in the 1.0 format
    const r = RULES.find(x => x.re.test(what));
    return { what, ledger: r?.ledger || '', next: r?.next || '' };
}
/** One line: 「发生了什么。账本：…。下一步：…」 (pure). */
export function errorLine(err) {
    const { what, ledger, next } = explain(err);
    const head = /[。！？.!?）)]$/.test(what) ? what : what + '。';
    return head + (ledger ? ` 账本：${ledger}。` : '') + (next ? ` 下一步：${next}。` : '');
}
