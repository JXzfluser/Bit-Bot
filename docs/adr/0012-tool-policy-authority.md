# ADR 0012 — 统一权限模型:策略由 Host 提供,由内核裁决

- 状态：Accepted(v1 已落地)
- 日期：2026-10-26
- 决策者：Bit架构
- 关联：ADR 0002(WASM/Host 边界)、ADR 0008(远程认证与审批不可伪造)、ADR 0010(能力层)、`docs/agent-core/README.md` AR-02 / AR-15
- 实现：`runtime/tool_policy.mbt`、`runtime/agent_loop.mbt`、`hosts/shared/tool_policy.js`、`hosts/shared/agent_loop_product_wire.js`
- 门禁：`bash scripts/prove_product_tools.sh`(PT12–PT14)

## 背景

工具能不能跑,此前只有两个地方说了算:

1. **工具 spec 的 `requires_approval`** —— 按工具名写死(`Shell` 必审,其余不必)
2. **Host 的审批 UI / 自动审批规则** —— `host_approval_gate.js` 的 `saved_rule`

问题有三个:

- **没有主体维度。** 同一个工具,Bot 用、房间用、用户直接用,是一个待遇。
- **没有作用域维度。** `Read` 能读仓库里任何路径 —— 内核侧没有任何路径约束。
- **没有设备维度。** 桌面点一下「允许」和手机远程发一条消息,后果完全一样。
  ADR 0008 把「远程入站的 `approved:true`」修掉了,但**没有**把「远程设备能用哪些工具」这件事本身建模。

还有一条更要紧的:**判定权放在 Host 侧,是可以绕过的。** 内核才是工具真正执行的地方;
任何绕过 Host 的调用方(CLI、daemon、未来的 Box)都能跳过 Host 的检查。
所以**裁决必须在内核**。

## 决策

**1. 四个维度:主体 × 设备信任 × 工具 × 作用域。**

| 维度 | 谁知道 | 怎么进内核 |
|---|---|---|
| 主体(subject) | Host(哪个 Bot / 房间) | 策略对象 |
| 设备信任(device_trust) | Host(桌面 / 手机 / 远程入站) | 策略对象 |
| 工具(tool) | 两边都知道 | 调用本身 |
| 作用域(scope) | **只有内核知道**(真实参数) | 内核从参数里取 |

**2. Host 提供策略,内核裁决。**

新增 FFI op `load_policy`:内核每回合问一次,Host 回一份 JSON 策略。
内核用 `ToolPolicy::parse` 读它,然后**自己**裁决。

三种判定:`Allow` / `NeedApproval` / `Deny`。
- **Deny 是最终的** —— 硬禁用优先于「需要审批」,没有审批能救回来。
- 判定顺序:硬禁用 → 设备降级 → 工具自身的审批要求 → 路径作用域。

**3. 设备信任是「降级」,不是「另一套规则」。**

`limited` 设备(手机 / 远程入站)只是**多了一批需要审批的工具**,
只读的工具照常用。远程入站那条路(`cn_inbound_product_on_turn.js`)
现在标 `deviceTrust: "limited"` —— 这正是 C-2 里我记下的那条
「`web_fetch` 无审批」边界的收口。

**4. 路径作用域是词法判断,不是唯一一道闸。**

`path_roots` 非空时,带路径参数的工具(`path` / `src` / `dest` / `file` / `dir`)
的路径必须在某个根下。**注意 `/workspace-other` 不算 `/workspace` 底下** ——
前缀相同不等于包含。

但这是**第一道闸**,不是唯一一道:Host 侧还有 canonical(解析符号链接后)的
`cwdAllowed`。两道都要过。**只做词法判断的话,一个符号链接就能越界** ——
所以词法判断放在内核只是为了「便宜的早拒」,不能当成完整防护。

**5. Shell 命令里的路径不猜。**

内核只从**显式的路径参数**取作用域。`{"command":"cat /etc/passwd"}` 里没有路径参数,
作用域就是空。**从 shell 字符串里猜路径等于谎报「我检查过了」** ——
shell 的路径由 Host 的 `cwdAllowed` + 最小环境沙箱管。

**6. 失败开放,但不失败放宽。**

Host 不认识 `load_policy`(旧 Host 配新内核)→ `unknown op` → 默认策略:
不额外收紧,也不放宽。**解析不出来的策略退回默认,不是退回「全放行」。**

## 非目标

- 不把用户设置的 UI 做出来(v1 的策略来自环境变量:`BITBOT_TOOL_DENY` /
  `BITBOT_TOOL_APPROVAL` / `BITBOT_TOOL_PATH_ROOTS`)。
- 不做 per-connector / per-room 的细粒度授权 —— 维度留了位置,数据没接。
- 不改 ADR 0008 的认证与审批不可伪造。
- 不把任何 `CM-*` 从 U 升到 I。

## 后果

- **正面**:判定权回到内核 —— 绕过 Host 的调用方也一样被拦。
- **正面**:设备信任有了模型。「手机远程发一条消息」和「桌面上点允许」
  不再是同一件事。
- **正面**:`web_fetch` 那条边界收口了(我自己在 C-2 里记的)。
- **代价**:每回合多一次 FFI 往返(问策略)。
- **代价**:路径作用域只覆盖有显式路径参数的工具;shell 命令里的路径仍靠 Host。
- **风险**:`path_roots` 依赖 Host 正确设置。默认空 = 不限制,与既有行为一致 ——
  也就是说**默认状态下路径限制并没有生效**。真要收紧,得由 Host 显式配置。
- **风险**:v1 的策略来自环境变量,用户改不了、也不可见。UI 是后续项。

## 验收

```bash
bash scripts/prove_product_tools.sh
```

PT12–PT14 三条:

- **PT12**:被策略硬禁用的工具**根本没跑**,而且模型收到「denied by policy」。
- **PT13**:**受限设备**调 `web_fetch` 必须先问人,没批准就不跑。
- **PT14**:**同一个工具**在受信设备上不用问就跑。

白盒测试:`runtime/tool_policy_test.mbt`(8 例:默认策略、硬禁用优先于审批、
设备降级、路径越界、包含判断不是前缀匹配、作用域只取显式路径参数、策略解析、
解析失败退回默认)。
