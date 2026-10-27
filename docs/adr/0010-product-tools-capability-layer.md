# ADR 0010 — 产品工具(能力层):场景不进代码,能力才进代码

- 状态：Accepted(第一批已落地:C-1)
- 日期：2026-10-26
- 决策者：Bit架构
- 关联：ADR 0002(WASM/Host 边界)、ADR 0005(回正 MoonBit 桌面)、`docs/agent-core/README.md`
- 实现：`cmd/desktop_turn/agent_loop_product_tools.mbt`、`cmd/desktop_turn/agent_loop_product_native.mbt`、`runtime/agent_loop.mbt`
- 门禁：`bash scripts/prove_product_tools.sh`

## 背景

内核处理用户输入是三层:

1. **英文命令层**（确定性,有限）—— `create routine id=… cron=… prompt=…`
2. **中文正则层**（手写场景分支,**无限**）—— `decode_cn_routine` / `decode_cn_group_chat` / `parse_cn_time` / `cn_read_int` …
3. **模型层**（已有 tool call 通路,但只暴露 3 个工具）—— `Read` / `Shell` / `TodoWrite`

第 2 层是**按场景增长**的:每来一个新说法就加一条正则分支。而内核本身有 **70 个结构化 `TurnIntent` 变体**(`cmd/desktop_turn/turn_json.mbt:50`),每一个都是一项能力。

**错配在这里:能力是有限集合,场景是无限集合;现在的架构把无限的那部分写进了代码。**

`docs/design/desktop-target/report.md` §8.13 已经把这个代价记在账上:用户说「我要组建团队来处理公众号从每天定时收集AI科技热点内容 发我邮箱」,今天的结果是 —— 中文组队意图不识别 → 整句掉进普通对话 → 内核只认出「建定时任务」→ 整句被当 prompt 存成 `cron=@daily, room_id=""` → **群没建**,回执还吐内部 id `routine-cn-518247`。录像里的症状至今成立。

而 §8.13.3–8.13.4 给出的修法(`TEAM_HEAD_RE` 放宽 + `TEAM_ROLE_PRESETS` + `askish` 先判 + `TEAM_SCHEDULE_RE` 挂群)**从未进代码** —— 全仓搜不到这三个常量。那是**又一个场景分支**,不是通用解法。

## 决策

**1. 模型产出结构化意图,内核只接收结构化参数。**

```
用户(任何语言) → 模型 → tool_call{name, arguments}
                             ↓
                内核: schema 校验 + 审批门 + 状态
                             ↓
                结构化 TurnIntent → effect → Host 执行
```

**语义这一半交给模型,确定性这一半留在内核,执行这一半交给 Host。**

**2. 新场景的代码成本为 0。** 只有**新能力**才需要加一个 effect + 一份 schema。能力是有限集合,可枚举、可一次做完、可测;场景不是。

**3. 产品工具由内核执行,不经 Host。**

`ProductFfiHost::exec_tool` 在进 FFI 之前拦截产品工具:内核自己做 MoonBit 侧的事(建队友、建定时、算 cron),产出的 effect 由 Host 在回合结束后镜像。理由:Host FFI 的工具执行是个硬编码 switch(`hosts/shared/agent_loop_product_wire.js:43`),只认 `Shell` / `Read`,其余一律 `"exec refused: <name>"` —— 而这些能力的状态本来就在内核侧(`@teammates.TeammateDirectory` / `@routines.RoutineStore`),Host 根本做不了。

**4. 时间表达式的确定性留在内核。**

模型不能可靠地算 cron(时区、`@daily`、工作日、相对日期全靠它猜)。所以:

- `describe_schedule` / `create_routine` 接受**中文说法**或**cron 表达式**
- 中文 → cron 由内核确定性解析(`decode_cn_schedule`)
- 解析不出来就**如实报错,不编一个时间出来**

`decode_cn_routine`(正则路径)与 `decode_cn_schedule`(工具路径)共用同一份实现,只差**动词闸**:

- 正则路径**要求**排程动词(提醒/收集/发到/发送…)—— 普通聊天里出现「每天」不能就建定时任务
- 工具路径**不要求**动词 —— 模型点名要排程,false positive 风险为零

这条差分由 `agent_loop_product_tools_wbtest.mbt` 的两条差分门禁锁住:带动词时两条路必须一致;不带动词时正则仍然拒绝。**正则路径的行为一个字都没变。**

**5. 工具分级,不 70 个全暴露。**

| 类别 | 内容 | 处理 |
|---|---|---|
| A · 内核自主完成 | `describe_schedule` `create_teammate` `create_routine` | **已暴露**(C-1) |
| B · 需 Host 能力 | `web_search` `web_fetch` `send_mail` | **已暴露**(C-2)—— Host **同步**执行,模型拿到的是真结果 |
| B · 需 Host 能力(其余) | 发邮件以外的连接器、文件、MCP | Host 先实现再暴露;没实现的**先不暴露** |
| C · 用户私有 | 公众号草稿箱 / 热点源 | 走 `skills/user/` + MCP,**不进产品合同**(CM-2118 / CM-2135) |

**B 类的关键约束:Host 必须同步执行。** A 类的状态在内核,内核做完就完了;
B 类的状态在 Host(凭证、网络、投递),如果像 A 类那样"回合末再镜像",
模型拿到的观测就是一句**承诺**而不是**结果** —— 搜索没搜到、抓取被墙、
邮件没凭证,这些真失败会被藏起来。所以 B 类走 `host.exec_tool` 直通 Host,
观测是 Host 的真实返回。

**B 类的审批:** `send_mail` 是对外发送,`requires_approval: true`。
内核的审批闸先拒(工具根本不跑),Host 自己的 `executeHostEffects` 闸是第二道。
**批准只能来自 Host 自己的 `decideApproval`** —— 工具参数里的 `approved`
字段永远不被读(ADR 0008:参数铸不出审批)。

**6. 失败不留半个状态。** 解析不了 → 报错、**不产生 effect**。一个半成功的工具比没有这个工具更糟,因为 Host 会继续相信它做成了。B 类同理:搜索没配 key 就报 `search_key_not_configured`,**不返回空结果假装搜过了**;邮件没凭证就落成 sandbox eml 并如实标 `sent:false` / `live_mail_residual:true`,**不假装已发送**。

## 非目标

- 不把 70 个 `TurnIntent` 一次性全暴露(只做 A 类里内核能独立完成的那几个)。
- 不用模型替代确定性:定时触发、审批、权限、cron 解析**必须留在内核**。模型是语义层,不是裁判。
- 不删正则层 —— 它是「无模型可用」路径(定时触发、离线、脚本)的兜底,也是与工具路径的差分基准。
- 不在本 ADR 里做审批分级(K-2 内核侧另做)、不做编排下沉(K-7)、不做多端(Box 另做)。
- 不把任何 `CM-*` 从 U 升到 I。

## 后果

- **正面**:新场景零代码。用户的「组建团队 + 每天定时」这类自然语言,模型直接产出 `create_teammate` / `create_routine` tool call,不再需要一条新正则。
- **正面**:工具 schema 与执行器同源(`product_tool_registry()` 是唯一真源),模型看到的和内核能跑的不可能漂移。
- **代价**:多一次模型往返(多步编排天然多几轮)。
- **代价**:tool call 质量随 provider 而变 —— 所以保留正则兜底,PP1–PP4 live 门禁必须补跑。
- **代价**:工具数膨胀会抬高模型选错率 —— A 类控制在 ~12 个,按场景动态下发子集是后续项。
- **风险**:多步 tool call 可能中途出错(建群→建队友→建定时)。这正是 K-7 要解决的原子性问题,本 ADR 不假装已经解决。

## 验收

```bash
bash scripts/prove_product_tools.sh
```

该门禁跑**真 native 二进制**(打包后随 App 分发的那份),provider 是本地 stub:

**C-1(A 类,13 例)**

- **证到**:模型真的被提供了这三个工具(schema 进了 provider 请求)、内核真的 dispatch 了(不是 Host 回 `exec refused`)、effect 真的带正确载荷出来了(中文排程 → 正确 cron)、负例真的不留残状态(解析不了 → 无 effect + 如实报错)。
- **不证**:真实模型会不会选这些工具。provider 是 stub,它证明的是**工具通路**,不是模型的判断力。

**C-2(B 类,再 11 例)**

- `web_search` 真搜了(provider 走本地 stub 的 tavily 形状),**真来源**进了模型上下文。
- 没配搜索 key → 如实报 `search_key_not_configured`,**不返回空结果假装搜过了**。
- `web_fetch` 真读了页面,`body_prefix` 进了模型上下文。
- `send_mail` **没批准 → 被拒**,而且**邮件发送台账一个字没写**(内核的审批闸先拒,工具根本没跑)。
- `send_mail` **批准 → 真执行**,台账里有这一条,而且快照**明说**到底是不是真发出去(`sent` / `pretend_sent` / `live_mail_residual`)。

白盒测试:`cmd/desktop_turn/agent_loop_product_tools_wbtest.mbt`(14 例,含两条差分门禁)。
