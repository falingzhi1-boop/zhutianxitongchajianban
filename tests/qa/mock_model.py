"""Local OpenAI-compatible MOCK model for the isolated acceptance runs (tests/native_replace040.py).

Never a real model, never a real key. Every request is appended to a JSONL log ({path, auth, body}) so the
suite can assert what actually reached the "model". Replies are routed by the ORIGINAL v1.1 prompt phrases,
so each status-bar / assistant feature gets a well-formed answer in the format the original parser expects.

Usage:  python3 tests/qa/mock_model.py [--port 5001] [--log /var/tmp/qa/mock.jsonl]
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse, json, re, time

ap = argparse.ArgumentParser()
ap.add_argument('--port', type=int, default=5001)
ap.add_argument('--host', default='127.0.0.1')
ap.add_argument('--log', default='/var/tmp/qa/mock.jsonl')
ap.add_argument('--no-cors', action='store_true', help='send no CORS headers (a provider that blocks browsers; only server-side relays work)')
args = ap.parse_args()

STORY = ('夜色压着城头，你握紧了掌心那枚刚兑换来的引气丹。\n\n'
         '莉莉丝：“宿主大人，丹药可不是糖豆，一次一颗哦～”\n\n'
         '莉莉丝（害羞）：“才、才不是担心你呢……只是契约规定要照顾好你。”\n\n'
         '远处传来钟声，第一缕灵气顺着经脉缓缓流转。\n\n'
         '<ZhuTianPanel>\n系统点: 1350\n子系统: 诸天猎艳\n绑定目标: 叶清寒\n目标标签: 冷面剑修\n好感度: 42/100\n'
         '当前任务: 引气入体\n任务内容: 服下引气丹完成第一次周天\n任务奖励: 150 系统点\n任务进度: 60\n'
         '当前货币: 灵石\n持有金额: 88\n系统播报: 宿主灵气亲和度提升\n</ZhuTianPanel>')

SHOP = ['凡品|引气丹|500|微幅提升修炼速度|普通|消耗品', '凡品|铁剑|300|普通铁剑|普通|武器', '凡品|布衣|120|朴素衣物|普通|服装',
        '凡品|灵草|80|炼丹素材|普通|素材', '灵品|青锋剑|20000|削铁如泥（每日限斩三次）|普通|武器', '灵品|聚灵阵盘|50000|聚集灵气（冷却一日）|普通|装备',
        '灵品|莉莉丝的羽毛|3000|轻轻搔弄（每日一次）|色情|装备', '仙品|九转金丹|2000000|脱胎换骨（仅限一次）|普通|消耗品']


def text_of(messages):
    out = []
    for m in messages or []:
        c = m.get('content', '')
        if isinstance(c, list): c = ''.join(x.get('text', '') for x in c if isinstance(x, dict))
        out.append(str(c))
    return '\n'.join(out)


def recorder_reply(allt):
    """Memory recorder: quote 4-60 chars of this turn's text verbatim, as the original validator requires."""
    body = allt
    m = re.search(r'"本轮原文"\s*:\s*"((?:[^"\\]|\\.)*)"', allt)
    if m:
        try: body = json.loads('"' + m.group(1) + '"')
        except Exception: body = m.group(1)
    body_part = body.split('正文：', 1)[-1]
    seg = next((s.strip() for s in re.split(r'[。\n]', body_part) if 4 <= len(s.strip()) <= 60 and '{{' not in s), '')
    ups = [{'key': '事件/引气入体', 'kind': '事件', 'status': 'active', 'text': '宿主服下引气丹，开始第一次周天。', 'evidence': seg}] if seg else []
    return json.dumps({'upserts': ups}, ensure_ascii=False)


GROUP_N = [0]
V114_COT = ('<think>\n先打个草稿：<ZhuTianPanel>\n系统点: 草稿\n莉莉丝：这句只是草稿\n</think>\n夜色渐深，灵气在经脉里缓缓流转。\n\n'
            '莉莉丝：“宿主大人，今天就到这里。”\n\n<ZhuTianPanel>\n系统点: 1400\n好感度: 45/100\n当前任务: 引气入体\n任务进度: 70\n系统播报: 思维链测试\n</ZhuTianPanel>')


def group_reply(allt):
    """诸天聊天群: answer as the listed members; the host's test phrases ask for a red packet / a gift / an over-grade item."""
    names = re.findall(r'(?m)^- ([^（\n]+)（', allt)
    names = [n for n in names if '禁言中' not in allt.split(f'- {n}（', 1)[1].split('\n', 1)[0]] or ['无名']
    said = allt.rsplit('【宿主刚发】', 1)[-1] if '【宿主刚发】' in allt else ''
    a, b = names[0], names[1 % len(names)]
    # 1.1.4: numbered answers (重roll must show a NEW one) and a reply cut off by the output limit
    if '【1.1.4' in said:
        GROUP_N[0] += 1
        if '【1.1.4截断】' in said: return f'@{a}: 第{GROUP_N[0]}次·完整的一句。\n@{b}: 说到一半就被'
        return f'@{a}: 第{GROUP_N[0]}次回复。\n@{b}: 收到。'
    out = [f'@{a}: 群主好！今天{("你那边" if said else "")}的剧情挺热闹啊。']
    if '发红包' in said: out.append(f'@{a}: [红包] 系统点 3000 3 | 见者有份')
    elif '【测试】贪心' in allt: out.append(f'@{a}: [红包] 系统点 500 3 | 又来发红包啦')   # ignores the rhythm rule on purpose
    if '物品红包' in said: out.append(f'@{b}: [红包] 物品 青丘桃花酿/仙品/消耗品/饮后心神安宁 3 | 尝尝我们青丘的酒')
    if '送礼' in said: out.append(f'@{b}: [赠礼] 太虚剑谱残卷/神品/功法/记载太虚剑意的前三式 | 这个你用得上')
    if len(names) > 1: out.append(f'@{b}: 我在呢，有事说事。')
    out.append('@不在群里的人: 这行必须被忽略')
    return '\n'.join(out)


def route(allt):
    if '你是诸天万界聊天群的招募系统。' in allt:
        if '青丘' in allt: return '白浅|青丘|4|清冷护短|青丘桃花酿'
        avoid = allt.split('【不要选】', 1)[1].split('（', 1)[0] if '【不要选】' in allt else allt.split('已有群员：', 1)[-1].split('（', 1)[0]
        if '刚刚出现过或已在群里' in allt: return '陆千帆|天机阁|2|心思缜密|天机算筹'   # second try after a rejected repeat: the model listened
        for card in ('叶清寒|问剑宗|2|冷面剑修|问剑宗剑穗', '苏小蛮|东海渔村|1|活泼话多|东海咸鱼干', '林小禾|青石镇|1|憨厚老实|青石镇米糕'):
            if card.split('|', 1)[0] not in avoid: return card
        return '叶清寒|问剑宗|2|冷面剑修|问剑宗剑穗'
    if '你是诸天万界聊天群的召唤系统' in allt:                                                 # 1.1.5 从世界书召唤
        m = re.search(r'【条目】([^（\n]+)', allt); n = (m.group(1).strip() if m else '无名')[:12]
        return f'{n}|世界书来客|1|沉稳寡言|故乡的石子'
    if allt.lstrip().startswith('你是系统') and '私聊' in allt and 'ZhuTianPanel' not in allt:     # 1.1.5 人设私聊
        return 'PERSONA_OK：检测到宿主呼叫，系统在线。'
    if '你是诸天万界聊天群的任务发布系统。' in allt: return '寻找失落剑谱|前往问剑宗后山寻回《太虚剑谱》残卷|5000 系统点'
    if '你是诸天万界聊天群的群直播。' in allt: return '问剑宗山门前，数百弟子列阵练剑。\n剑光汇成一条银河，直冲云霄。\n掌门立于峰顶，目光望向镜头。'
    if '你是诸天万界聊天群的群员私聊' in allt: return '（剑穗轻晃）群主找我何事？若是切磋，随时奉陪。'
    if '你是诸天万界聊天群。' in allt: return group_reply(allt)
    if '回复两个字：成功' in allt: return '成功'
    if '你是诸天系统外挂世界书的事实记录员' in allt: return recorder_reply(allt)
    if '只返回JSON {"answer"' in allt or '只返回JSON{"answer"' in allt:
        return json.dumps({'answer': '根据记录：宿主正在完成“引气入体”。', 'checks': []}, ensure_ascii=False)
    if '你是诸天系统的品阶鉴定官' in allt: return '仙品|大陆级剑意，远超凡俗武学'                 # 1.0 品阶鉴定
    if '严格执行格式要求，只输出一行' in allt: return '5|剧情推进稳定，按中档结算'              # 神通 · AI 评估实力档
    if '严格只输出一行' in allt: return '九转凝元丹|消耗品|服用后灵力恢复三成（每日限用一次）'     # 外挂 · 万物熔炉
    if '你是背包整理助手' in allt:                                                            # 背包 · AI 整理
        names = re.findall(r'(?m)^\d+\.\s*([^|\n]+)\|', allt) or ['引气丹']
        return '\n'.join(f'{n}|凡品|消耗品|恢复少量灵气' for n in names[:40])
    if '你是诸天万界的招募官。' in allt: return '叶清寒|问剑宗|B+|80|剑意凌厉'                   # 外挂 · 召唤
    if '你是诸天系统的奖励生成器' in allt:                                                    # 商城 · 抽卡
        cnt = {k: int(v) for k, v in re.findall(r'(神品|仙品|灵品|凡品)(\d+)个', allt)}
        lines = [f'{g}|{g}秘宝{i + 1}|提升修为（冷却一日）|装备' for g in ['神品', '仙品', '灵品', '凡品'] for i in range(cnt.get(g, 0))]
        return '\n'.join(lines or ['凡品|回气散|恢复体力|消耗品'])
    if '用户许愿：' in allt: return '灵品|20000|参照价5000×长期4=20000（能量守恒）'              # 商城 · 许愿报价
    if '只输出规定的格式列表' in allt: return '\n'.join(SHOP)                                  # 商城 · AI 进货
    if '莉莉丝' in allt and ('私聊' in allt or 'LILITH_CHAT' in allt or '契约恶魔' in allt) and 'ZhuTianPanel' not in allt:
        return '哼，宿主大人终于想起莉莉丝了？修炼再累，也要记得来找我说说话哦。'
    return STORY


V111_POLLUTED = '（1.1.1 隔离测试）莉莉丝托腮看着你。\n\n<zhutianpanel>\n<think>先想一下数据块怎么写</think>\n他推开了洞府石门，寒气扑面而来。\n\n系统点: 1300\n好感度: 35/100\n当前任务: 引气入体\n任务进度: 40\n功法修炼: 领悟《太虚剑意》[仙品]\n系统播报: 宿主今天很努力\n\n石门在身后缓缓合拢。'
V111_MISSING = '（1.1.1 隔离测试）这一轮只有正文，你在山道上遇见了一位白衣剑客。'


def audit_reroll(last_user, msgs):
    """1.1.1 审计 #7: like a real model, the new 名望 = the value the prompt shows (+50) and 持有金额 = last block in history (+100)."""
    fame = int((re.search(r'名望(\d+)', last_user) or [0, 0])[1])
    hist = ''.join(text_of([m]) for m in msgs if m.get('role') == 'assistant')
    money = int((re.findall(r'持有金额:\s*(\d+)', hist) or ['500'])[-1])
    return (f'（审计重roll）你完成了一次委托，获得名望。{time.time_ns()}\n\n<ZhuTianPanel>\n系统点: 1200\n好感度: 30/100\n当前任务: 引气入体\n'
            f'任务进度: 30\n当前货币: 灵石\n持有金额: {money + 100}\n专属资源: 天命印记0｜血脉结晶0｜因果筹码0｜名望{fame + 50}｜岁月沉淀0\n'
            f'功法修炼: 无\n系统播报: 重roll测试\n</ZhuTianPanel>')

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send_header(self, k, v):
        if args.no_cors and k.lower().startswith('access-control-'): return
        super().send_header(k, v)

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b)))
        self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers(); self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in (('Access-Control-Allow-Origin', '*'), ('Access-Control-Allow-Headers', '*'), ('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')): self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip('/').endswith('/models'): return self._json({'object': 'list', 'data': [{'id': 'mock-zt', 'object': 'model'}, {'id': 'mock-zt-mini', 'object': 'model'}]})
        self._json({'ok': True, 'mock': True})

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        try: body = json.loads(self.rfile.read(n) or b'{}')
        except Exception: body = {}
        with open(args.log, 'a', encoding='utf8') as f:
            f.write(json.dumps({'t': time.time(), 'path': self.path, 'auth': self.headers.get('Authorization', ''), 'body': body}, ensure_ascii=False) + '\n')
        reply = route(text_of(body.get('messages')) or str(body.get('prompt', '')))
        # 1.1.1 数据块格式守卫: a polluted / missing data block, chosen by a marker in the LAST user message only
        last_user = next((text_of([m]) for m in reversed(body.get('messages') or []) if m.get('role') == 'user'), '')
        if '【1.1.1污染】' in last_user: reply = V111_POLLUTED
        elif '【1.1.1缺块】' in last_user: reply = V111_MISSING
        elif '【审计重roll】' in last_user: reply = audit_reroll(last_user, body.get('messages') or [])
        elif '【1.1.4思维链】' in last_user: reply = V114_COT
        finish = 'length' if '【1.1.4截断】' in last_user else 'stop'   # 1.1.4: the output limit was hit
        # 0.8.4 timeout check: a message containing 慢速测试 takes ~66 s (longer than the original fixed 60 s abort)
        slow = '慢速测试' in (text_of(body.get('messages')) or '')
        if slow: reply = '慢速回复：' + '流' * 10
        model = body.get('model') or 'mock-zt'
        if body.get('stream'):
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache')
            self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers()
            step = 2 if slow else 24
            for i in range(0, len(reply), step):
                chunk = {'id': 'mock', 'object': 'chat.completion.chunk', 'model': model, 'choices': [{'index': 0, 'delta': {'content': reply[i:i + step]}, 'finish_reason': None}]}
                self.wfile.write(('data: ' + json.dumps(chunk, ensure_ascii=False) + '\n\n').encode()); self.wfile.flush(); time.sleep(9 if slow else 0.01)
            end = {'id': 'mock', 'object': 'chat.completion.chunk', 'model': model, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish}]}
            self.wfile.write(('data: ' + json.dumps(end) + '\n\ndata: [DONE]\n\n').encode()); self.wfile.flush(); return
        if slow: time.sleep(66)
        self._json({'id': 'mock', 'object': 'chat.completion', 'model': model,
                    'choices': [{'index': 0, 'finish_reason': finish, 'message': {'role': 'assistant', 'content': reply}}],
                    'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}})


if __name__ == '__main__':
    print(f'mock model on http://{args.host}:{args.port}/v1  log={args.log}', flush=True)
    ThreadingHTTPServer((args.host, args.port), H).serve_forever()
