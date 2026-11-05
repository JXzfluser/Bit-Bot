# 真机验收清单（路线 A · Android 端）

> **更新到 A3-9（2026-11-04）**。旧版开头写「当前 APK 只支持同一局域网、跨网中继客户端
> 还没接进 Android（R-A3-3a）」、§3 写「跨网当前不可用，别浪费时间」—— 那是 **A3-4 之前**
> 的状态，已作废。照旧版跑会直接走错路。
>
> **现状**：A3-6 构建的 APK 已含 `RelayTunnel` / `TunnelHttp` / `ConnectionStrategy` /
> `TransportStatus`；配对回执可选下发 `relay: {host, port, box_id, client_token}` 四栏，
> 手机落 prefs、直连失败自动回落中转、状态条显示真实走过的路。
> **A3-7 / A3-8 / A3-9 只改桌面与 relay，没有一行 Android 代码 —— APK 不需要重打。**
>
> 本页把三件事分开：① 开跑前自检（§2.5）；② 局域网逐条打勾（§4，R-A2-1）；
> ③ **真公网 + 真 NAT 逐条打勾（§5，R-A3-8a）**。只有第 ③ 种能关掉 R-A3-8a。

---

## 0. 先判断：你这次要验的是哪一种

| 场景 | 拓扑 | 能证明什么 | 能不能关 `R-A3-8a` |
| --- | --- | --- | --- |
| A · 同一 Wi-Fi 直连 | 手机↔桌面同网段，无 relay | 配对 / 发消息 / 进度（§4） | ❌ |
| B · 同网 reverse | relay 与桌面**同一台机器 / 同一网络命名空间**，手机走蜂窝 | 反向隧道协议通、`BIND`/`ACCEPT`/`ATTACH` 跑通 | ❌ **这不是 NAT** |
| C · 真公网 + 真 NAT | relay 有**公网可达地址**，桌面在 NAT 后（家里/公司内网），手机走蜂窝 | relay 零主动拨、盒子只发起出站连接、跨网真的可用 | ✅ |

**别把 B 当成 C**：relay 和桌面都在同一台 Mac 上时，`127.0.0.1` 的最后一跳是本机回环，
NAT 从未出现。A3-9 的门禁用 `192.0.2.1:1` 不可达端点等价建模过「零主动拨」，
但那是**本机证据**，不能替代真环境。要关 R-A3-8a，必须让 relay 在公网、桌面在 NAT 后。

---

## 1. 铁律：配对必须先在同一个 Wi-Fi 完成

`DesktopPairing.redeemCode()` 目前仍是 `POST http://<局域网 IP>:18765/v1/pair/redeem`，
**配对本身不走 relay**。中继四栏是**配对成功回执里顺带下发**的，手机拿到才落 prefs。

所以顺序只能是：

```
① 手机连桌面同一个 Wi-Fi
② 桌面「生成配对码」→ 手机配对成功        ← 这一步必须同网
③ 回执里的 relay 四栏落进手机 prefs
④ 手机关 Wi-Fi、切蜂窝（或离开这个 Wi-Fi）
⑤ 再发消息 → 直连失败 → 自动回落中转      ← 这一步才是跨网验收
```

一上来就关 Wi-Fi，结果一定是「连不上桌面」，而那**不是产品坏了，是顺序错了**。
（把配对也搬到隧道上是 `R-A3-5b` / 手动填中转入口 `R-A3-6a` 的范围，当前没做。）

---

## 2. 部署（以下都在桌面 / relay 机器上，命令可直接复制）

### 2.1 生成两把钥匙 —— 两把不能混

`box_token`（role=box）只给桌面自己 `BIND` 用，**绝不下发**；
`client_token`（role=client）随配对回执给手机。用同一把会让手机拿到桌面的登记权。

```bash
cd /Users/zfl/Downloads/bitbot          # 换成你的仓库路径
export BITBOT_RELAY_SECRET='<自己生成的一串随机值，例如 openssl rand -hex 32>'
node -e '
const { issueRelayCredential } = require("./hosts/shared/relay/relay_keys");
const s = process.env.BITBOT_RELAY_SECRET;
console.log("box_token="    + issueRelayCredential(s, "my-desktop", "box"));
console.log("client_token=" + issueRelayCredential(s, "my-phone",   "client"));
'
```

### 2.2 在公网机器上起 relay

```bash
export BITBOT_RELAY_SECRET='<和 2.1 完全相同的那串>'
BITBOT_RELAY_CONTROL_PORT=18766 \
BITBOT_RELAY_HEALTH_PORT=18767 \
BITBOT_RELAY_BIND=0.0.0.0 \
BITBOT_RELAY_LOGFILE=/tmp/bitbot-relay-audit.jsonl \
node hosts/shared/relay/relay_server.js
```

- `BITBOT_RELAY_BIND=0.0.0.0` 必须设（默认只绑 `127.0.0.1`，公网打不进来）。
- 安全组 / 端口映射要放通 **18766/TCP**（控制面）；数据面复用同一条连接，不用另开端口。
- `/healthz` 在 18767，可先 `curl http://<公网地址>:18767/healthz` 确认活着。
- 审计日志是**元数据**（bind / accept / attach / close / ping / liveness-timeout），
  按设计不含 token、不含请求正文、不含附件 —— 现场可拿它当证据。

### 2.3 桌面写 `data/desktop/relay.json`

```json
{
  "host": "<relay 公网 IP 或域名>",
  "port": 18766,
  "box_id": "my-desktop",
  "box_token": "<2.1 的 box_token>",
  "client_token": "<2.1 的 client_token>",
  "mode": "reverse"
}
```

- **`"mode": "reverse"` 必须显式写**。默认仍是 `dial`（relay 主动拨盒子），NAT 后拨不进来。
- `endpoint` 在 reverse 下**只作展示**，不要填、也不要照旧文档去改它。
- `local_endpoint` 一般不用填，缺省是 `127.0.0.1:<入站实际端口>`。
- 两个可选环境变量兜底：`BITBOT_RELAY_MODE=reverse`、`BITBOT_RELAY_LOCAL_ENDPOINT=...`。
- ✅ **配置热生效（A3-11）**：改完 `relay.json` **不用重启桌面 app**。回执四栏本来就是每次
  兑换现读，现在「盒子登记」也由观察器按 2s 轮询跟着变（改 mode / 换 token / 删配置 / 从无到有
  都会自动重新登记），日志会出现 `[relay-box] relay.json 变了 → 已按新配置重新登记`。
  最多等 2s；想调间隔用 `BITBOT_RELAY_CONFIG_POLL_MS`。
  **注意**：这只解决「登记不热」，没解决没有设置界面、也没解决凭证明文落盘 —— `R-A3-6h` 只是部分关闭。
- ⚠️ `box_token` 是明文落在本机 JSON 里的，当前没做钥匙串 / 0600（`R-A3-6h` 剩余部分）。

### 2.4 打开桌面 app

1. 打开 Bit Bot 桌面 app（**不能只开终端**——服务随 app 生命周期）。
2. 账户 → 移动端远程控制 → 点「**允许手机连接**」，状态点变 on（入站从 `127.0.0.1` 改绑 `0.0.0.0:18765`）。
3. 看终端/日志出现 `[relay-box] reverse box=my-desktop -> <host>:18766 …`；
   若出现 `[relay-box] WARN 登记的 … 是回环地址` 说明**没切到 reverse**，回去查 2.3。
4. `lsof -nP -i :18765` 应看到 Electron/node 在 `*:18765` 监听。

### 2.5 开跑前自检（本机，30 秒）

```bash
node scripts/verify_real_device_readiness.js
```

它会逐条查：配置齐不齐 / `mode` 是不是 reverse / 两把钥匙角色对不对且不同 /
`toHandoff` 是不是正好四栏且不含 `box_token` / relay 控制端口真连得上 /
用 `client_token` 真 `AUTH` 拿到 `OK` / 用 `box_token` 真 `BIND` 拿到 `BOUND` /
桌面入站是否在监听。**任何一条不过都会直接说缺什么**，别带着半套配置上真机。

> 这个脚本**不能挂进 CI 总闸**：它需要一台真实可达的 relay 和一个正在运行的桌面 app，
> CI 里没有。本机 `PASS` 只代表「可以开始」，不代表「跨网已可用」。

---

## 3. 手机侧步骤

1. 装 **A3-6 构建的 APK**（A3-7/8/9 没改 Android，不用重打、不用更新）。
2. **连桌面同一个 Wi-Fi** → 桌面生成 6 位配对码 → 手机配对成功。
3. 确认状态条显示「已配对」（此时还没走过消息，不显示延迟是正常的 —— `TransportStatus`
   在 `NONE` 时刻意回 `null`，不盖掉「已配对」）。
4. **关 Wi-Fi、切蜂窝**（最好也关掉手机上的 VPN / Tailscale / 代理，它们会改写路由）。
5. 发一句话 → 状态条应变成「**中转 · Nms**」（`TransportStatus.record(RELAY, …)` 记的是
   **真实把回包带回来的那条路**，不是猜的）。
6. 收到回复 = 跨网主链路通。然后按 §5 逐条打勾。

---

## 4. 局域网逐条打勾（R-A2-1，A3-6 之前就有效）

前提：§3 第 2 步已配对成功、能发消息。每条都要**亲眼看到**，看不到就记「不过」。

- [ ] **① 进度看得见**：发一条需要工具的消息，十几秒内界面至少 3 次进度更新，措辞和桌面一致。
- [ ] **② 锁屏重连**：发消息中途锁屏 30 秒再回来，进度接着出、**不重复**（ON_STOP/ON_START）。
- [ ] **③ 第二轮不串台**：第一轮结束后等 10 秒再发第二条，第二轮不得先出现第一轮的行。
- [ ] **④ 多语言**：系统语言切繁体/英文，进度行与回退提示跟着变。
- [ ] **⑤ 回退提示**：桌面关掉事件双写（或断网）后，手机显示「回退到整轮模式」，不是空屏。
- [ ] **⑥ 吊销生效**：桌面花名册吊销这台手机 → 手机下次请求被拒（≤30 秒）。

任一条不过，记现象（截图 + 时间），对应修订 `report.md` §8.63 的 R-A2-1 / R-A1-4b。

---

## 5. 跨网逐条打勾（R-A3-8a · **只有场景 C 才算**）

前提：§0 判断为 C、§2 全部就绪、§3 第 5 步已看到「中转 · Nms」。

| # | 检查项 | 判定标准（要留证据） | 结果 |
| --- | --- | --- | --- |
| ① | **配对同网完成、四栏落 prefs** | Wi-Fi 下配对成功；之后切蜂窝仍能发消息（不用重新配对） | ☐ |
| ② | **状态条显示真实路径** | 蜂窝下显示「中转 · Nms」，不是「直连」、不是空白 | ☐ |
| ③ | **relay 零主动拨** | relay 侧日志/诊断里 `dialAttempts` 全程不涨；桌面只发起**出站**连接 | ☐ |
| ④ | **盒子在线可见** | relay `/healthz` 或审计日志有 `bind`；桌面 app 开着时盒子在表里 | ☐ |
| ⑤ | **每条消息的数据面** | 审计出现成对的 `accept` / `attach` / `close`，且**查无请求正文与 token** | ☐ |
| ⑥ | **桌面 app 关掉 / 控制通道断** | 手机下一条明确失败（NOBOX 一类人话），**不卡在「连接中」** | ☐ |
| ⑦ | **半开自愈** | 让桌面网络抖动 / 停 app 再开，盒子自动重连回来，手机恢复可用（A3-9 `PING`/`PONG`） | ☐ |
| ⑧ | **relay 重启（端口不变）** | 重启 relay 后盒子自己回来，手机再发消息仍通（RR-03 注入实测过的那条） | ☐ |
| ⑨ | **成功率** | 连续 20 条消息，成功 ≥18 条（≥90%）；每条记时间戳与走的路径 | ☐ |
| ⑩ | **进度事件流** | ⚠️ 当前 **SSE 不走隧道**（`R-A3-5b`），应看到「回退到整轮模式」而非中途进度 | ☐ |

**第 ⑩ 条是诚实边界，不是失败项**：它现在必然是「回退」，写进表里是为了免得现场把它
误判成 bug。要它变成「进度也走隧道」，得先做 `R-A3-5b`。

判定口径：**不过就是不过**，别拿「本机门禁绿」「同网能通」抵账。
每条都要留：时间、手机截图、relay 审计片段、当时的 `BITBOT_RELAY_*` 配置（**凭证打码**）。

---

## 6. 观测点（现场别只盯手机）

| 在哪看 | 看什么 | 正常长相 |
| --- | --- | --- |
| 手机状态条 | `TransportStatus.labelOrNull` | 「中转 · Nms」；`NONE` 时不显示延迟 |
| relay 审计 `/tmp/bitbot-relay-audit.jsonl` | `event` | `auth` / `bind` / `ping` / `accept` / `attach` / `close`；半开时 `liveness-timeout` |
| relay `/healthz`（18767） | `boxes` | 桌面在线时 ≥1，桌面关掉后回落 |
| relay 诊断态 | `dialAttempts` / `reverseBoxes` / `livenessEvictions` | reverse 下 `dialAttempts` 不涨 |
| 桌面日志 | `[relay-box] reverse …` | 没有 `WARN … 回环地址`、没有 `denied` / `transport` |
| `lsof -nP -i :18765` | 入站监听 | `*:18765`；无输出 = 桌面 app 没在跑 |

**审计里绝对不该出现**：`box_token` / `client_token` 原文、HTTP 请求行、消息正文、附件。
出现任意一样就是 A3-2「内容不可见」被破坏，立刻停下来报，不要继续测。

---

## 7. 连不上先查这几条（按概率）

| 现象 | 真因 | 怎么办 |
| --- | --- | --- |
| 一上来就「连不上桌面」 | **没在同一 Wi-Fi 先配对**（§1） | 回同一 Wi-Fi 配对成功再切蜂窝 |
| 配对成功、切蜂窝后卡住 | `relay.json` 没写 `"mode": "reverse"`，仍是 dial | 补上配置并**重启桌面 app** |
| 日志出现 `WARN … 回环地址` | 同上，走了 dial 的告警分支 | 同上 |
| 手机 `NOBOX` / 一直连接中 | 桌面没登记上（配置半套、凭证错、relay 没起、app 没开） | 跑 §2.5 自检；看桌面日志 `denied`/`transport` |
| relay 端口连不上 | `BITBOT_RELAY_BIND` 没设 `0.0.0.0`，或安全组/端口映射没放 18766 | 见 §2.2 |
| 「有四栏却 NOBOX」 | 运行中改配置，登记没重跑（`R-A3-6h`） | 重启桌面 app 或切一次开关 |
| 手机开了 VPN / Tailscale / 代理 | 路由被改写 | 临时关掉再测 |
| 能连但发消息 401 | 设备公钥没登记上 | 看 App 的 `deviceTrustNotice`；重新配对 |

---

## 8. 一句话边界

- **现在能验**：局域网全链（§4）+ 真公网/真 NAT 下的反向隧道主链路（§5 ①–⑨）。
- **现在验不了 / 必然回退**：SSE 事件流走隧道（§5 ⑩，`R-A3-5b`）；≥90% 是目标不是已有结论。
- **A3-6 的 APK 仍是当前端上版本**，这一轮桌面/relay 的改动不需要重打。
- **场景 B（relay 与桌面同机）不能关 R-A3-8a** —— NAT 根本没出现。
