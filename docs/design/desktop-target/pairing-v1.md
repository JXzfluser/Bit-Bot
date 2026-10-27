# 配对 v1：局域网自动发现 + 6 位配对码（pairing-v1）

## 为什么要这一份

现状要求用户手抄两样东西：桌面配对地址（`http://192.168.x.x:18765`）和 64 位配对令牌。
真机反馈是：装完 App 第一屏是说明书，抄错一个字符就 401。这不是文案问题，是流程问题 ——
配对这件事本身应该像投屏/隔空投送那样：**在可信设备上点一下同意，另一台设备输一个短码**。

本文件是桌面端与手机端共同遵守的唯一线协议。两边都只许按此实现，不许各自发明字段。

## 不变的前提（不要动）

- ADR 0008：`POST /v1/turn` 仍要 `Authorization: Bearer <token>`；loopback 绑定仍是默认，
  放开局域网仍由「允许手机连接」/ `BITBOT_BIND_LAN=1` 决定。
- 配对令牌本身**不变**：仍是桌面已有的那一个 64 位 bearer。短码只是「把它交给这台手机」的
  引导流程，不引入第二套长期凭证。
- 现有 JSON 契约只加可选字段，不改语义、不删字段。
- 401 的流量不记在线证据（这条逻辑不变）。

## 安全口径（写清楚，别自欺）

- 局域网内 `/v1/turn` 的 bearer 本来就是明文 HTTP 传输 —— 能在 LAN 上嗅探的人今天就已经
  能看到令牌。因此「用短码换令牌」相对现状**不是**新的泄露面；但短码必须做到：
  1. 6 位数字，`crypto.randomInt` 生成（不许 `Math.random`）；
  2. 默认 TTL 5 分钟，过期即失效；
  3. 一次性：换过一次立刻作废（同一台手机重装要重新生成）；
  4. 每个码最多 5 次尝试，超了直接作废（防爆破；1e6 空间 × 5 次 ≈ 5e-6 蒙对概率）；
  5. 比较用常量时间（`crypto.timingSafeEqual`），失败原因不区分「不存在」与「已过期」，
     免得给攻击者当探针；
  6. 桌面 UI 上码可以被「立即作废」。
- `/v1/pair/discover` 只回答「这里有一台 Desktop、叫什么、在哪个端口」，**绝不**返回令牌、
  令牌掩码、或任何可推导令牌的东西。泄露面与已有的 `/health` 同级。

## 线协议

### 1) 发现（免鉴权，只读）

```
GET /v1/pair/discover
→ 200 {
  "ok": true,
  "service": "bitbot-desktop",
  "name": "ZFL-PC",            // os.hostname()，原样
  "version": 1,                // 本协议版本，将来只加字段
  "port": 18765,               // 实际绑定端口，不写死
  "pairing": {
    "code_active": true,       // 当前有没有有效的配对码
    "expires_in_ms": 214377    // code_active=false 时为 0
  }
}
```

- 不做任何鉴权，不要求 token；不记 presence。
- 未生成码时也要回答（`code_active:false`），否则手机没法告诉用户「桌面在，但还没点生成」。

### 2) 换令牌（免鉴权，但要短码；这是唯一的 bootstrap 面）

```
POST /v1/pair/redeem
{ "code": "482913", "device_name": "Pixel 7", "machine_kind": "android" }

→ 200 { "ok": true, "turn_token": "<64 位>", "base_url": "http://192.168.1.10:18765",
        "expires_in_ms": 0 }
→ 400 { "ok": false, "error": "invalid_code" }        // 码错/不存在/已过期/已用过，统一这个
→ 400 { "ok": false, "error": "attempts_exceeded" }   // 这个码尝试次数用满，已作废
→ 400 { "ok": false, "error": "bad_request" }         // 缺 code / JSON 不合法
→ 409 { "ok": false, "error": "pairing_not_open" }    // 桌面没放开局域网（LAN 未开）
```

- `machine_kind` 只允许 `android` / `ios`；其它值按 `bad_request` 处理（不新增机器身份）。
- 成功后该码立即作废，且**只能成功一次**。
- 失败也要计数（`attempts_exceeded` 之后连对的码也失效）。
- 成功应答额外带可选字段 `base_url_scope`：`private` / `cgnat` / `public` / `link_local` /
  `loopback`，说明这个 `base_url` 是从哪类网卡来的（真源 `hosts/shared/lan_candidates.js`，
  与桌面界面同一套排序 —— 桌面把 docker0 顶第一位是 bug，把 172.17.0.1 交给手机同样是 bug）。
  手机端**必须**读它：非 `private` 时配对成功也要如实提醒「手机大概率连不通」，
  不许静默保存一个连不通的地址当成功。
- 端口不许写死：桌面端口可被 `BITBOT_CN_INBOUND_PORT` 改，所以手机端扫描要接受候选端口，
  并以 discover 应答里的 `port` 为准做后续 redeem；UI 要能改端口（默认 18765，存 prefs）。

### 3) 生成 / 作废（只在桌面本机，IPC，不走网络）

`bitbot:pairing:code`，入参 `{ action: "issue" | "revoke" }`
→ `{ ok:true, code:"482913", expires_in_ms:299988, attempts_left:5 }`
→ revoke：`{ ok:true, code:"" }`
`pairingState()` 增加可选字段：`pair_code`、`pair_code_expires_in_ms`、`pair_code_attempts_left`。

## 手机端流程（目标：两步，零抄写）

1. 首屏未配对时：对话区照常可用，中间一个「连接 Desktop」按钮（不再摆三段说明）。
2. 点下去 → 本机扫描：取手机自己的 Wi-Fi IPv4，枚举同 /24 的 1..254 打
   `GET /v1/pair/discover`（并发 32、单点超时 350ms），列出应答的桌面（名字 + IP）。
3. 点一台 → 输入 6 位码 → `POST /v1/pair/redeem` → 成功就把 `base_url` 与 `turn_token`
   写进 prefs，直接回到对话，可以开始说话。
4. 「凭证」里手填地址 + 令牌保留为高级兜底（不删），但不再是唯一入口。

失败必须说人话并区分：没搜到（「同一 Wi-Fi 里没找到 Desktop，桌面上点一下『生成配对码』」）、
码错（「配对码不对，还剩 N 次机会」）、码过期/用过（「配对码已失效，回桌面重新生成一个」）、
桌面没放开（「桌面那边还没点『允许手机连接』」）。

## 验收口径与已落地结果

| 证据 | 门禁 | 结果 |
| --- | --- | --- |
| 配对码生命周期（生成/TTL/一次性/次数用满/常量时间比较/revoke） | `scripts/prove_pairing_code.mjs` PC-01..08 | 全绿 |
| 真 HTTP：discover 形状与不含令牌、错码、对码、再用一次、次数用满、过期、非法入参 | 同上 PC-09..17 | 全绿 |
| **换到的令牌真能打通 `/v1/turn`** | 同上 PC-13 | 全绿 |
| base_url 走网卡排序，不给 docker0（PC-18）、LAN 未放开如实 409（PC-19） | 同上 | 全绿 |
| 桌面面板：生成配对码出 6 位数字 + 倒计时、可作废 | `scripts/e2e_android_roster.mjs` AR-16/17（真 Electron） | 20/0 |
| 手机端纯逻辑（/24 枚举、discover 解析、码校验、四种失败映射、scope 提醒） | `PairingDiscoveryTest`（23 条） | 全绿 |
| 手机端**真 HTTP 集成**（进程内 ServerSocket 起服务，走真 socket 校字段与映射） | `PairingIntegrationTest`（17 条，ephemeral 端口，无 skip 路径） | 全绿 |
| 门禁把上面几条钉成「真在跑」 | `prove_android_build.mjs` AB-09、AB-10（含负向对照） | 10/0 |

JVM 单测合计 66 用例 0 失败；内核回归 `moon test ./cmd/desktop_turn` 33/33、`moon test runtime` 54/54；
视觉 token 门禁 5/0 且行内字面字号基线未涨（新增文字一律走 class + token）。

## 残留（诚实）

- 手机端扫描与换令牌只到 JVM 进程内真 HTTP 集成，**没有真机 Wi-Fi 验证**（本机无 KVM，
  起不了 emulator）；`ConnectivityManager` 取本机 IPv4 的代码路径未在真机跑过。
- 多网卡 / 多 Desktop 的局域网里，手机可能列出同名或别人的机器 —— v1 只按 `name` 展示，
  没有指纹确认这一步。
- 桌面端口默认 18765 可改，手机侧要手动同步一次端口（v1 未做端口广播）。
- 公网 / 跨网段机器仍配不上（没有内网穿透产品路径），此时 discover 也扫不到。
- 未做二维码方案：桌面渲染 QR + 手机 CameraX 解码是 M 档改造，v1 先用 6 位码把
  「零抄写」这一步做到；QR 落地后短码仍应保留作为无摄像头兜底。
