# 真机验收清单（路线 A · Android 端）

> **更新到 A3-18（2026-11-05）**。几处早期说法已作废，照早期版本跑会浪费一整天：
>
> | 早期说法 | 现在的事实 | 依据 |
> | --- | --- | --- |
> | 跨网当前不可用 | 反向隧道 + 直连回落都在 | A3-6 |
> | 配对必须先在同一个 Wi-Fi | 有跨网配对串，redeem 可走隧道 | **A3-18** |
> | SSE 不走隧道，必然回退 | 事件流也走隧道，中途进度照出 | **R-A3-5b** |
> | APK 不用重打 | **必须重打** —— A3-17 / A3-18 改了 Android | **A3-17 / A3-18** |
> | 改配置要重启桌面 app | 观察器 ≤2s 热生效 | A3-11 |
> | 中转凭证不走 OS 钥匙串 | 桌面两份 vault 都接了 protector | **R-A3-6h** |
>
> 这张表的每一行都由 `scripts/prove_checklist_freshness.js` 盯着：正文里只要再次
> 出现「没做 / 不走 / 必须重启」这类**否定断言**，而代码里其实已经有了，门就转红。
> 历史注记请写进 `>` 引用块或用 `~~删除线~~`，那是被豁免的区域（见该脚本注释）。
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

## 1. 配对的两条路：同网，或者用配对串跨网

`DesktopPairing.redeemCode()` 走 `POST http://<局域网 IP>:18765/v1/pair/redeem` 这条局域网路
**依然在**，也依然是最省事的一条。但它不再是唯一一条 —— A3-18 加了跨网配对串。

### 路 A · 同网配对（快，但测不到 A3-18）

```
① 手机连桌面同一个 Wi-Fi
② 桌面「生成配对码」→ 手机配对成功
③ 回执里的 relay 四栏落进手机 prefs
④ 手机关 Wi-Fi、切蜂窝（或离开这个 Wi-Fi）
⑤ 再发消息 → 直连失败 → 自动回落中转      ← 这一步才是跨网主链路
```

### 路 B · 配对串跨网（能测 A3-18，验收请走这条）

```
① 桌面「跨网中转」卡片 →「生成跨网配对串」
   得到 bitbot-relay://v1?h=<host>&p=<port>&b=<box_id>&t=<client_token>
② 手机装上重打的 APK → 配对页底部粘贴这串 → 点「用配对串配对」
③ 手机要一次 6 位配对码（桌面照常生成），redeem 走 relay 隧道回来
④ 全程手机可以一直挂在蜂窝网上，不需要连桌面的 Wi-Fi
```

- 配对串里**只有 `client_token`**；桌面自己那把 `box_token` 绝不进串。串被截图发出去，
  对方最多能当一台 client 用，拿不到桌面的登记权。
- 串是一次性便利，不是新信任模型：真正的信任仍然是那把 6 位码 + 设备公钥登记。
- **验收要两条路都跑**：路 A 证明没把老路走坏，路 B 证明跨网这条路真的通。
  只跑路 A，A3-18 等于没验。

> 早期版本把路 A 写成「铁律」，是因为在那时结构上确实没有路 B（配对只在局域网可 POST，
> 而中转四栏只在配对成功后才下发，死锁）。A3-18 解的就是这个死锁。

---

## 2. 部署（以下都在桌面 / relay 机器上，命令可直接复制）

### 2.0 先把桌面端启动好

```bash
bash scripts/start-desktop.sh
# 受限环境（沙箱 / 无 GPU 权限）：BITBOT_DESKTOP_SAFE=1 bash scripts/start-desktop.sh
```

这条命令会：剔除 shell 里常驻的 `ELECTRON_RUN_AS_NODE`（不剔 Electron 会退化成纯 Node）、
按 `path.txt` 找到正确平台的二进制、必要时降级 sandbox/GPU，然后**判活**
（等 `cn-inbound listening=true` 并真打 `/v1/pair/discover` 要 200）。看到
`[desktop] ready: … → 200` 才算起来好了；只看到进程不等于能用。

桌面日志里如果出现 `[relay-box] 登记失败：… errno=ECONNREFUSED`，那是 **relay 没起**，
按 §2.2 去起 relay；**别去查日志里 `endpoint=` 那个地址**（reverse 下它只是展示字段）。

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
- **18767 也要放通**（跟 18766 一样做端口映射 / 安全组）：`/diagnostics` 在同一个
  health 端口上，§5⑭ 和一键自证脚本都从它取数。开跑前先验一次：
  `curl http://<公网地址>:18767/diagnostics`，应看到 `schema:1` 与 `liveBridges` 等计数字段。
  只回 404 说明 relay 是旧版，§5⑭ 无法判，先升级 relay。
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
  之后设置界面（A3-14）和凭证进钥匙串（R-A3-6h）也都补上了，这条旧「注意」里说的两个缺口现在都不在了。
- ✅ **凭证加固（A3-12）**：`relay_secrets.js` 复用桌面已有的 secret vault
  （AES-256-GCM 加密、`vault.json` / `vault.key` 都是 0600），可以把两把 token 移出
  `relay.json`，只留 `box_token_ref` / `client_token_ref`；旧明文格式**继续兼容**。
  **上面那段示例是旧格式** —— 照抄写完仍是明文。要转成安全格式，在仓库根跑一次：

  ```bash
  node -e '
  const {writeRelayConfigSecure}=require("./hosts/shared/relay/relay_secrets");
  const {createSecretVault}=require("./hosts/desktop/secret_vault");
  const cfg=require("./data/desktop/relay.json");
  console.log(writeRelayConfigSecure({cfg, vault:createSecretVault(process.cwd())}));
  '
  ```

  看到 `{ ok: true }` 即可：此后 `relay.json` 查无明文、权限 0600，桌面照常读（读口会自动 resolve）。
  配置热生效（A3-11）照样工作，改完仍不用重启 app。
- ✅ **也可以直接在桌面里配（A3-14）**：账户 →「移动端远程控制」→「跨网中转」卡片 →
  点「配置中转」，在独立弹窗里填 host / port / box_id / mode 和两把凭证 →「保存并生效」。
  视图只显示掩码（`****后四位`），凭证框永远留空（留空即沿用已存的值）；
  保存后主进程立刻重新登记，A3-11 的观察器再兜一层。上面那段 JSON 和 `node -e`
  现在只是 CLI 备选，**不再需要手写文件**。
- ✅ **vault 密钥已上 OS 钥匙串（R-A3-6h）**：桌面有**两份** vault —— 一份存桌面自己的
  会话密钥，一份存中转的两把 token —— 现在**两份都传了 `protector`**，macOS 走
  `safeStorage` 钥匙串，落盘是 `vault.key.protected` 而不是明文 `vault.key`。
  旧机器首次启动会把明文 `vault.key` 迁进钥匙串、回读校验通过后删掉明文。
  - 现场核对（最直接的一眼）：`ls -l data/secrets/vault.key*`
    - 看到 `vault.key.protected`、**没有** `vault.key` → 已经上了钥匙串；
    - 只有 `vault.key` → 这台机器 `safeStorage.isEncryptionAvailable()` 为 false
      （Linux 无 keyring / 未登录桌面会话 / app ready 之前被问过），此时**故意回落明文**
      而不是让 vault 变砖 —— 这是设计，不是失败。
  - 代码侧探针是 `secret_vault.inspectKeyStorage()`：接了保护器时 `mode` 是 `"os-keychain"`、
    否则 `"file"`。**它只有传了 `protector` 才可能报 `os-keychain`**，所以别在纯 Node 里裸调
    （裸调恒为 `file`，会得出错误结论）；要判就看上面那个文件。
  - **验收要在三平台各看一眼这两个文件**：macOS / Windows 必须是 `.protected`；
    Linux 有 keyring 时 `.protected`、无 keyring 时保留明文且桌面照常能读配置。
  - ⚠️ 它防的是「`grep data/` 就看到密钥 / 同机其他用户读走」，**不防**「本机已被完全控制」——
    钥匙串解锁态下恶意进程照样能拿到。这条边界没变。

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

### 2.6 A3-15：一条命令接线（当前这台机器**已经跑好**）

上面的 2.1–2.5 是分散步骤，容易漏。现在有一条命令把桌面侧全部做完：

```bash
node scripts/setup_public_relay.js --host 14.155.111.69 --connect-host 127.0.0.1
bash scripts/start_public_relay.sh        # 另一个终端，保持运行
```

`--host` 是**下发给手机**的公网地址（脚本会拒绝 `127.0.0.1` / `10.x` / `192.168.x`，
免得把手机连不上的地址写进回执）；`--connect-host` 是**桌面自己**连 relay 用的地址 ——
relay 和桌面在同一台机器时填 `127.0.0.1`，因为桌面连自己的公网出口实测不通（NAT 回环）。
**若 relay 部署在另一台公网机器，`--connect-host` 要填那台机器的地址，不能留 127.0.0.1。**

脚本会：生成/复用 `data/desktop/relay-secret`(0600) → 签发两把角色不同的凭证 →
经已有的 secret vault 写**安全格式** `relay.json`（只留 `*_token_ref`、`mode: reverse`、
含 `connect_host`、mode 0600）→ 打印掩码视图。A3-11 的观察器 ≤2s 自动重新登记，**不用重启 app**。

当前本机的实测状态（2026-11-05）：

```
relay /healthz : {"ok":true,"boxes":1}
桌面日志       : [relay-box] reverse box=my-desktop -> 14.155.111.69:18766
真握手         : client AUTH → OK ; box AUTH/BIND → OK / BOUND my-desktop
四栏           : host=14.155.111.69, port=18766, box_id=my-desktop, client_token（不含 box_token）
端到端隧道     : TUNNEL reverse:my-desktop → GET /v1/pair/discover → HTTP/1.1 200 OK
审计           : connect → accept → attach → close（同一 streamId）
```

**唯一还差的、代码做不了的一步**：`14.155.111.69` 是本机**出口** IP，不在网卡上
（网卡是 `10.201.107.104`）。要手机蜂窝网够得到，需要三选一：

1. 路由器把 TCP **18766**（及可选 18767）映射到 `10.201.107.104`；
2. 或把 `data/desktop/relay-secret` + `start_public_relay.sh` 放到一台有公网 IP 的机器上跑，
   再用 `--host <那台地址> --connect-host <那台地址>` 重新接线；
3. 或装 Tailscale / 内网穿透把 18766 暴露出去（本机当前没装）。

**映射是否生效，用手机关 Wi-Fi、走蜂窝时测**：浏览器打开
`http://14.155.111.69:18767/healthz`，应看到 `{"ok":true,"boxes":1}`。
打不开就是入口没通，先解决它；这一步通了，后面的连接代码侧已经全部就绪。

⚠️ **配对这一步现在有两条路**（详见 §1）：同网配对照旧；也可以生成跨网配对串让手机在蜂窝网下直接配对。
两条都要跑一遍 —— 只跑同网，A3-18 等于没验。

## 3. 手机侧步骤

### 3.0 先装 APK（**必须重打**）

A3-17 / A3-18 改了 Android 侧（`LinkStatus.kt` / `RelayBootstrap.kt` / `ConnectionStats.kt`
是新增的，`EventStreamClient` / `DesktopPairing` / `MainActivity` / `Sheets` 也改了）。
拿旧包去跑，配对串输入框、探活结论、连接统计三块都看不到 —— 那不是 bug，是包不对。

```bash
cd hosts/android/BitBotHost                       # gradle 根在这层，不在 hosts/android
./gradlew :app:assembleDebug
# 产物：app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb install -r app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

装完先确认版本：`adb shell dumpsys package com.bitbot.host | grep versionName`，
和你刚构建的时间对得上再往下走。

### 路 A · 同网配对（证明老路没走坏）

1. 手机连桌面**同一个 Wi-Fi**。
2. 桌面生成 6 位配对码 → 手机配对成功。
3. 确认状态条显示「已配对」（此时还没走过消息，不显示延迟是正常的 —— `TransportStatus`
   在 `NONE` 时刻意回 `null`，不盖掉「已配对」）。
4. **关 Wi-Fi、切蜂窝**（最好也关掉手机上的 VPN / Tailscale / 代理，它们会改写路由）。

### 路 B · 配对串（跨网，能测 A3-18）

5. 桌面「跨网中转」卡片 →「生成跨网配对串」→ 复制 `bitbot-relay://v1?…`。
6. 手机**不连桌面的 Wi-Fi**（挂蜂窝即可），配对页底部粘贴配对串 → 点「用配对串配对」。
7. 输入桌面生成的 6 位码 → 应配对成功。失败时按提示分类：
   串缺栏（会直接点名缺 `h`/`p`/`b`/`t`）、不像配对串（没 `bitbot-relay://v1?` 前缀）、
   或隧道没通（桌面没登记 / relay 不可达）。**提示说人话是验收项**，见 §5 ⑫。
8. 配对成功后状态条应显示「已配对」+ 探活结论（见 §5 ⑪）。

### 3.3 收尾（两条路都要做）

9. 发一句话 → 状态条应变成「**中转 · Nms**」（`TransportStatus.record(RELAY, …)` 记的是
   **真实把回包带回来的那条路**，不是猜的）。
10. 收到回复 = 跨网主链路通。然后按 §5 逐条打勾。
11. 打开「凭证」页，**记下那行连接统计**（形如 `中转 a/b · 整体 c/d · 均 x ms`）。它带分母，
    §5 ⑨ 的成功率就从这行取数；点「清零」可以开始一轮干净的计数。

### 3.4 桌面/relay 侧交给一条命令（**别在真机窗口里手抄数字**）

§5 里 ③零主动拨 / ④盒子在线 / ⑤审计查无正文 / ⑬钥匙串落盘 / ⑭连接数回基线
这五条都在桌面或 relay 上，能自动判；手机侧那九条必须人肉，工具**不假装能判**。

**顺序很重要**：基线要在「发消息 / 断流实验」**之前**记，否则增量恒为 0，
工具会正确地把它判红（那不是 bug，是顺序错了）。

```bash
RELAY=http://<公网地址>:18767
AUDIT=/tmp/bitbot-relay-audit.jsonl          # relay 那台机器上的 BITBOT_RELAY_LOGFILE

# ① 手机开始 §5 之前（桌面这台机器上）
node scripts/verify_real_device_desktop_side.js baseline \
  --relay "$RELAY" --audit "$AUDIT"

# ② 手机做完 §5（含断网/恢复 ≥5 次）之后
node scripts/verify_real_device_desktop_side.js check \
  --relay "$RELAY" --audit "$AUDIT" --secrets data/secrets \
  --out /tmp/bitbot-evidence.txt
```

`--out` 落的是一份可直接粘进验收记录的文本：时间、relay 地址、每条判定的**真实数值**、
结论，以及「手机侧仍需人工」的清单。任一条红就是红 —— **取不到数一律记红**，
不会 SKIP 当绿，也不会把「没找到文件」当成「查无明文」。

自证（本机可跑，不依赖外网/真机）：
`node scripts/verify_real_device_desktop_side.js --self-test` → `PASS=13 FAIL=0`，
其中九组负向对照（真空绿 / 连接泄漏 / 缺基线 / 审计夹带 token / 明文密钥 /
盒子离线 / 旧 relay …）逐条转红，工具本身可信才拿去验真机。

⚠️ `--audit` 指的是 **relay 那台机器**上的文件。若桌面与 relay 不是同一台，
先把审计日志取回本机再给路径，或直接在 relay 机器上跑这条命令。

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
| ① | **配对（两条路各一次）、四栏落 prefs** | 路 A 同网配成功；**路 B 蜂窝下用配对串也配成功**；之后切网仍能发消息（不用重新配对） | ☐ |
| ② | **状态条显示真实路径** | 蜂窝下显示「中转 · Nms」，不是「直连」、不是空白 | ☐ |
| ③ | **relay 零主动拨** | relay 侧日志/诊断里 `dialAttempts` 全程不涨；桌面只发起**出站**连接 | ☐ |
| ④ | **盒子在线可见** | relay `/healthz` 或审计日志有 `bind`；桌面 app 开着时盒子在表里 | ☐ |
| ⑤ | **每条消息的数据面** | 审计出现成对的 `accept` / `attach` / `close`，且**查无请求正文与 token** | ☐ |
| ⑥ | **桌面 app 关掉 / 控制通道断** | 手机下一条明确失败（NOBOX 一类人话），**不卡在「连接中」** | ☐ |
| ⑦ | **半开自愈** | 让桌面网络抖动 / 停 app 再开，盒子自动重连回来，手机恢复可用（A3-9 `PING`/`PONG`） | ☐ |
| ⑧ | **relay 重启（端口不变）** | 重启 relay 后盒子自己回来，手机再发消息仍通（RR-03 注入实测过的那条） | ☐ |
| ⑨ | **成功率（带分母）** | 连发 20 条，成功 ≥18（≥90%）；凭证页那行统计的分子/分母要和你手记的对得上 | ☐ |
| ⑩ | **进度事件流走隧道** | 蜂窝下发一条需要工具的消息，**中途进度照常出新行**；若显示「回退到整轮模式」= 这一条不过 | ☐ |
| ⑪ | **探活 ≠ 凭证（A3-17）** | 两条独立的维度都要看到：桌面关掉 → 「桌面离线」；桌面开着但吊销这台手机 → 「桌面在线 · **凭证被拒**」，**不能报成离线** | ☐ |
| ⑫ | **错误提示说人话** | 故意粘一段残缺配对串 / 停掉 relay / 输错配对码，提示应分别指出缺哪栏、隧道不通、码不对；**不出现内部路径或堆栈** | ☐ |
| ⑬ | **钥匙串真的接上了（R-A3-6h）** | `ls -l data/secrets/vault.key*` 只看到 `vault.key.protected`；桌面重启后配置仍能读（说明迁移没把钥匙弄丢） | ☐ |
| ⑭ | **断流重连不留连接（R-A3-5b 残留）** | 蜂窝下反复断网/恢复 **5 次**（每次等进度断掉再恢复）。`curl http://<公网地址>:18767/diagnostics`：断流前先记一份基线，之后看 **`liveBridges` 回到基线**（挂着没关的转发连接数），同时 `streamsServed` / `bridgesOpened` / `bridgesClosed` 都涨了 ≥5（说明**真的重连过**，不是压根没连）。⚠️ **别看 `activeStreams`**：它只是「等 ATTACH 的窗口」，ATTACH 一到就清空、另有 2.5s 超时兜底，**挂住十条死连接它照样是 0**，拿它当证据是恒真对照 | ☐ |

**⑩ 这一条的判定方向在早期版本里是相反的**（R-A3-5b 之前，事件流只能靠直连，回退才是正常）。
现在正过来了：看到「回退到整轮模式」意味着隧道化失败，**这一条不过**，要去看
`EventStreamClient` 是不是退回了直连。

**⑪ 是最容易被误判成 bug 的一条**：401 证明桌面**在线**，只是不认这台手机的凭证。
把它显示成「离线」会让人跑去查网络，实际上要查的是花名册。

判定口径：**不过就是不过**，别拿「本机门禁绿」「同网能通」抵账。
每条都要留：时间、手机截图、relay 审计片段、当时的 `BITBOT_RELAY_*` 配置（**凭证打码**）。

---

## 6. 观测点（现场别只盯手机）

| 在哪看 | 看什么 | 正常长相 |
| --- | --- | --- |
| 手机状态条 | `TransportStatus.labelOrNull` | 「中转 · Nms」；`NONE` 时不显示延迟 |
| relay 审计 `/tmp/bitbot-relay-audit.jsonl` | `event` | `auth` / `bind` / `ping` / `accept` / `attach` / `close`；半开时 `liveness-timeout` |
| relay `/healthz`（18767） | `boxes` | 桌面在线时 ≥1，桌面关掉后回落 |
| relay **`/diagnostics`（18767）** | `dialAttempts` / `reverseBoxes` / `livenessEvictions` | `schema:1` 存在；reverse 下 `dialAttempts` 不涨 |
| relay `/diagnostics`（18767） | `liveBridges` / `bridgesOpened` / `bridgesClosed` / `streamsServed` | ⑭ 就看这一行：`liveBridges` 回基线且后三者各涨 ≥5。**`activeStreams` 不算证据**（等 ATTACH 的窗口，必然回基线） |

`/diagnostics` 只吐计数，查无 token / 正文 / endpoint / memberId；端点带 `schema:1`，
看到别的版本号说明这台 relay 太旧、撑不起 §5⑭。旧版只有 `/healthz`（`{ok, boxes}`），
**那里没有诊断态** —— 以前清单写「看 relay 诊断态」但没给端点，现场根本读不到。
| 桌面日志 | `[relay-box] reverse …` | 没有 `WARN … 回环地址`、没有 `denied` / `transport` |
| `lsof -nP -i :18765` | 入站监听 | `*:18765`；无输出 = 桌面 app 没在跑 |

**审计里绝对不该出现**：`box_token` / `client_token` 原文、HTTP 请求行、消息正文、附件。
出现任意一样就是 A3-2「内容不可见」被破坏，立刻停下来报，不要继续测。

---

## 7. 连不上先查这几条（按概率）

| 现象 | 真因 | 怎么办 |
| --- | --- | --- |
| 一上来就「连不上桌面」 | **没在同一 Wi-Fi 先配对**（§1） | 回同一 Wi-Fi 配对成功再切蜂窝 |
| 配对成功、切蜂窝后卡住 | `relay.json` 没写 `"mode": "reverse"`，仍是 dial | 补上配置，等 ≤2s 热生效；**不用重启 app** |
| 日志出现 `WARN … 回环地址` | 同上，走了 dial 的告警分支 | 同上 |
| 手机 `NOBOX` / 一直连接中 | 桌面没登记上（配置半套、凭证错、relay 没起、app 没开） | 跑 §2.5 自检；**读桌面启动日志的「登记失败」那一行**（见下） |
| 桌面日志 `登记失败：网络层没连通 · 目标 X · errno=ECONNREFUSED` | relay 进程没起 / 18766 没监听 | 去 relay 那台机器起服务、确认 `BITBOT_RELAY_BIND=0.0.0.0` 与端口映射 |
| 同一个 errno=ETIMEDOUT | 安全组 / 端口映射 / 路由没放通 | 按日志给的目标查 18766，**不要**去 ping 日志里 `endpoint=` 那个地址 |
| 日志两个地址不一样（启动行 `-> 192.168.1.5`，失败行 `目标 127.0.0.1`） | A3-15「连接地址与下发地址分离」，是设计 | 日志会打一行「注：下发给手机的是…本机实际连…」；照实际连接目标排查，别改配置 |
| relay 端口连不上 | `BITBOT_RELAY_BIND` 没设 `0.0.0.0`，或安全组/端口映射没放 18766 | 见 §2.2 |
| 「有四栏却 NOBOX」 | 注册确实没跟上（A3-11 观察器失效、或改的是 vault 里那层而没重登记） | 先看桌面日志有没有 `relay.json 变了`；没有才重启 app |
| 手机开了 VPN / Tailscale / 代理 | 路由被改写 | 临时关掉再测 |
| 能连但发消息 401 | 设备公钥没登记上 | 看 App 的 `deviceTrustNotice`；重新配对 |
| 状态条说「离线」但桌面明明开着 | 探活被当成掉线（A3-17 前的老毛病） | 观察是否其实写着「凭证被拒」；若真报离线，看 `/healthz` 是不是 404（那不是 Desktop 的端口） |
| 配对串粘贴后说「不像跨网配对串」 | 串被截断 / 少了 `bitbot-relay://v1?` 前缀 | 重新复制整串，别手工编辑 |
| 配对串报「还缺 h/p/b/t」 | 桌面生成时自检没过，串本来就是残的 | 回桌面看「跨网中转」卡片的红字，先修好地址 |

---

## 8. 一句话边界

- **现在能验**：局域网全链（§4）+ 真公网/真 NAT 下的反向隧道主链路与进度事件流（§5 ①–⑬）。
- **仍然只是目标、不是结论**：跨网成功率 ≥90%（§5 ⑨）—— 这条要等有人真跑完 20 条才有分母，
  在那之前任何「已达标」的说法都是猜的。
- **必须重打 APK**：A3-17 / A3-18 动了 Android 侧；旧包看不到配对串 / 探活 / 统计。
- **场景 B（relay 与桌面同机）不能关 R-A3-8a** —— NAT 根本没出现。
- **iOS 侧仍为零**：本页只覆盖 Android。
