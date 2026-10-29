# T4-04 · QUIC 绑定选型 spike：napi 插件 vs Rust sidecar

> 回答开放问题 §9-1，产出 T4-04 要求的「一页对比结论（性能、崩溃隔离、打包体积）」。
> 标签约定：**[实测]** = 本仓库本机命令量得；**[引用]** = 文末来源；**[估]** = 未实测估算，附验证命令。

## 1. 结论先行

**推荐 B：独立 Rust sidecar 二进制（内嵌 iroh），Node 宿主经本机控制通道对话。**
决策规则：**station 是常驻进程（T1-07/T5），传输层的崩溃不得能杀死宿主进程 ⇒ 进程边界是唯一机制化的隔离手段 ⇒ sidecar。**
翻盘条件：Electron 升到的 Node ≥ v23.8 且官方 prebuilt 二进制**编译期**开启 QUIC、并能在其上补齐打洞+回落时，C（零原生件）整体胜出——见 §2C，这条 2026 年内大概率不成立。

## 2. 候选形态对比

| | A. napi-rs `.node` 插件 | B. Rust sidecar（推荐） | C. 纯 JS/无原生 |
|---|---|---|---|
| QUIC 栈 | quiche/neqo/s2n-quic/iroh 链接进插件 | 同左，但链进独立可执行件 | 只有 `node:quic`（实验）与 WebTransport |
| 崩溃语义 | 段错误 = 整个 Electron 主进程一起死（同地址空间，JS 层没有能接住它的机制）**[推断，未实测]** | 进程死，宿主 `exit` 回调感知后重启（同内核模式，AC-T1-2） | 同宿主 |
| ABI 绑定 | 绑 Electron 的 `NODE_MODULE_VERSION`（本机 [实测] Electron 33.4.11 → bundled node=20.18.3、abi=130），每次升 Electron 重编 [引用7] | 无 ABI 问题，产物即 `desktop_turn` 同管线件 | — |
| 与契约 | `send(command)`/`subscribe(from_seq)` 走 in-proc 回调 | 走 unix socket/localhost 行协议，**与内核 `--serve` 行协议同构**（该协议本轮已实测：`scripts/prove_kernel_resident.mjs` KR-01..KR-10 全绿） | 走 JS 事件 |

**C  viability 一句话判定：今天不可行。** `node:quic` 于 Node v23.8.0 才出现且 Stability 1.0-Early development、需 `--experimental-quic` 且二进制须编译期开启 [引用2,3]；本机 `node -e "require('node:quic')"` 在 v22.23.1 直接 `ERR_UNKNOWN_BUILTIN_MODULE`、`node --experimental-quic -e 1` 报 `bad option` **[实测]**，而 Electron 33.4.11 打包的 Node 是 **20.18.3 / abi 130 [实测]**（`Electron -e process.versions`）。WebTransport 是浏览器 user-agent API、2026-03 才 Baseline newly available [引用8]，主进程用不了，也没有维护中的纯 JS QUIC+打洞实现。结论：**原生 Rust 路线 A/B 二选一，没有第三条路**——这本身就是需求要的一条发现。

## 3. 三条评价轴

### 3.1 性能
- A：QUIC 状态机跑在插件内的 tokio/工作线程（napi-rs 支持 libuv 线程池或自建线程 [引用6]）；JS↔Rust 一次 napi 调用 ≈ 亚微秒级 **[估，未实测]**，验证命令：T4-05 里做 1k 消息 ping-pong 对拍。若滥用同步调用会阻塞主线程——这是 A 的真正风险项。
- B：多一跳本机 socket（unix domain 回环 RTT ≈ 数十微秒 **[估]**；验证：sidecar `bench` 子命令 + `sockperf`）。libuv 线程池（默认 4，`UV_THREADPOOL_SIZE` [引用10]）完全不参与。
- 定量的决定性事实是**负载本身**：Transport 契约按词表（§3.4）推 `delta/progress` 事件，人级会话 ≪ 1k msg/s，两跳开销 ≪ 公网 QUIC 一个 RTT（数十 ms）。**性能在本项目不构成 A/B 判别轴。**

### 3.2 崩溃隔离（本题的判别轴）
- A：`.node` 与主进程同地址空间；段错误杀整个 app。Electron 官方对原生模块只有「重编/重装」告诫 [引用7]，无任何进程级兜底；重启插件 = 重启主进程 = 违反 T5「客户端关掉作业继续跑」与 station 常开前提。
- B：sidecar 死 → 宿主观察 `child.exit` 即重拉，在途回合按 I4 幂等重放；**仓库已有同构先例**：内核二进制就是子进程 + 行协议，AC-T1-2 明确 `kill -9` 恢复语义。
- still.fail 不能作为加分项：需求文档 §9-1 把它的 `native/mesh` 当作**原生插件**那一侧的例子，而 §8-1 只说它保留 launcher/runner/mesh 三个**预编译件**。「预编译分发」A 与 B 都做得到，它没有替我们区分这两种形态 [引用: docs/next-target-requirements.md §8-1/§9-1，未读其实现]。

### 3.3 打包体积与签名
- 全部分发物 ≈ **200.4 MB** [实测: `du -sh dist/mac-arm64/Bit Bot.app`]，其中 Electron Framework.framework **192.4 MB [实测 du]**、app.asar 4.1 MB、kernel 目录 1.6 MB——原生件占比历来 <1%。
- 门禁现状 [实测]：dmg **80.2 MB**、zip **83.6 MB**，棘轮上限 85 MB（`prove_pack_artifacts.mjs`），AC-T0-1 目标 70 MB。**zip 到棘轮只剩 1.4 MB**——A 或 B 任一新增 [估] 2–6 MB（iroh+quinn 静态件典型量级；验证：`cargo build --release && du -sh target/release/*`）都会顶破 85 MB，**必须同步调高 `BITBOT_PACK_MAX_MB` 或继续瘦身**（afterPack 已再砍 locale，勿重复计）。
- A 还要求 `.node` 落 asar 外（`asarUnpack`，现清单没有 [实测: package.json build.files]），B 直接复用 `extraResources` kernel 通道。
- 增量的实测标尺（T1-07 顺手量的一次真实发包）：asar 里加一个 15,943 B 的 `shared/kernel_server.js` ⇒ zip 87,633,787 → 87,647,557 B（+13.8 KB）、dmg 84,075,585 → 84,108,229 B（+32.6 KB）[实测: `BITBOT_PACK_TARGET=dist bash scripts/pack-desktop.sh` 前后 `ls -la dist/`]。文本按 ~0.86:1 进 zip，而**原生二进制本来就已压缩**，所以 [估] 那 2–6 MB 不会因为「反正压缩包会压一压」变小——1.4 MB 的棘轮余量要按面值吃。
- 量体积的坑（会影响上面这几个数怎么复现）：`du -sh` 不带 `-A` 在 APFS 上会把克隆（clone）块重复计一次——同一份 .app 实测 `du -sh`=209M、`du -sh -A`=200M，而 zip 中央目录的解包总量 210,045,065 B≈200.3 MiB 与后者一致 [实测: `unzip -l`]。本文所有「.app / framework」体积一律按 `du -sh -A` 口径。

## 4. 本项目打包管线的落点（实测）

sidecar 落位即「第二个 `desktop_turn`」，四处现成挂点：
1. **staging**：`scripts/pack-desktop.sh` 第 3 步模式照抄（`resources/kernel/bin/` → electron-builder `extraResources` → `Contents/Resources/kernel`），新增 `resources/mesh/bin/bitbot_mesh`；`paths.js` 同法解析。
2. **签名/公证**：本地产物现为 adhoc/linker-signed [实测: `codesign -dv`，app 与 kernel 皆 `Signature=adhoc`]。CI（`.github/workflows/desktop-macos.yml`）有 `MAC_CSC_LINK` 即签名、`APPLE_*` 触发 `build/notarize.js` 提交整个 .app——**嵌套 Mach-O 必须随包公证**，且 `hardenedRuntime + disable-library-validation=true` [实测: entitlements.mac.plist] 使异签名原生件可加载（注意该 entitlement 不可上 MAS）。CI 还会对包内 kernel 清 quarantine 并跑 `ListMachines` 自检——mesh sidecar 应加同款式子命令（如 `mesh ping`）进 PA-04。
3. **门禁**：`prove_pack_artifacts.mjs` PA-02 体积棘轮、PA-03 可执行位、PA-04 包内自检三条直接扩到 sidecar；T1-07 期间新加的 PA-08 是同一套模式的现成样板——它在**真启动的包内 .app** 跑完一轮，只读宿主自己记下的传输事实（`loop_trace.resident`/`kernel_pid`）断言「走的是常驻」，并数宿主退出后包内内核的残留。sidecar 版对应「包里的 app 真开机时连的是 mesh sidecar，且退出不留孤儿」。`prove_kernel_binary.sh` 的「moon run == 二进制」等价门有 sidecar 版的空间。
4. **回落中转**：sidecar 内做 iroh 直连 + relay 失败回落，与宿主控制通道协议无关，T4-05 的「打洞失败自动回落」验收不受形态影响。

## 5. 残留 / T4-05 需假设

- 未实测：sidecar/napi 真实字节数、socket 往返开销、iroh Node FFI（iroh-ffi 有 Node 绑定但走共享库=回到 A 的崩溃语义 [引用5]，**不采用**，我们只取 iroh 的 Rust API）→ T4-05 第一周补 `cargo build --release` 体积与 ping-pong 基准。
- 未决：Windows/Linux 上 iroh 打洞成功率（AC-T4-5 ≥95% 只能实测）；node:quic 若升 Stability 并随 Electron 出货，重启本选型（翻盘条件 §1）。
- T4-05 假设：sidecar 单二进制、argv+行协议控制通道、随包公证、体积棘轮临时上调至 ~90 MB 并另开瘦身任务（70 MB 目标已被 Electron 地板阻塞 [实测注: prove_pack_artifacts.mjs 注释]）。

> **复核说明**：下面标 [实测] 的六个数由第二个人用同样的命令重跑过一遍，结果一致 —
> kernel 1.6M / .app 200M / Electron Framework 192M / dmg 84,075,585 B（80.2 MiB）/
> zip 87,633,787 B（83.6 MiB）/ `codesign -dv` = `Signature=adhoc, flags=0x20002(adhoc,linker-signed)`；
> `node -v` = v22.23.1 且 `require('node:quic')` = `ERR_UNKNOWN_BUILTIN_MODULE`；
> Electron 33.4.11 bundled `node=20.18.3 abi=130`；`asarUnpack` 在 `hosts/desktop/package.json` 里确实没有；
> 棘轮 85 MB / 目标 70 MB / 「Electron 地板 ~77 MB」出自 `scripts/prove_pack_artifacts.mjs` 注释。
> 标 [估] 与 [推断] 的没有重跑，因为本机没有对应产物。

## 6. 来源

1. 本仓库实测命令与产物：`du -sh _build/native/release/build/cmd/desktop_turn/desktop_turn.exe`（1.6M）、`hosts/desktop/dist/*`、`codesign -dv`、`electron -e process.versions`、`node -e "require('node:quic')"`。
2. [nodejs/node doc/api/quic.md (main)](https://raw.githubusercontent.com/nodejs/node/main/doc/api/quic.md) — added v23.8.0，Stability 1.0，`--experimental-quic`。
3. [QUIC and HTTP/3 Come To Node.js — James M Snell](https://jasnell.me/posts/quic-comes-to-node) — 编译期开启方式。
4. [Node.js Interactive 2026 Recap](https://nodejs.org/blog/events/nodejs-interactive-2026) — 运行时 flag 不能给未编译件补 QUIC。
5. [n0-computer/iroh](https://github.com/n0-computer/iroh) / [iroh-ffi](https://github.com/n0-computer/iroh-ffi) — QUIC+NAT 打洞、公钥拨号、FFI 为共享库。
6. [napi-rs](https://github.com/napi-rs/napi-rs) — `.node` 产物、tokio/libuv 线程模型、按平台分发。
7. [Electron: Using Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) — ABI 重编要求。
8. [MDN WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport) — 浏览器 API、HTTP/3、Baseline 2026-03。
9. [cloudflare/quiche](https://github.com/cloudflare/quiche)、[mozilla/neqo](https://github.com/mozilla/neqo)、[aws/s2n-quic](https://github.com/aws/s2n-quic) — Rust QUIC 栈现状（quiche 自述示例「not intended to be used in production」）。
10. [Node CLI: UV_THREADPOOL_SIZE](https://nodejs.org/api/cli.html#uv_threadpool_sizename) — libuv 线程池默认 4。
