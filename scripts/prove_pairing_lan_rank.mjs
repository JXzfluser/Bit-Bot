/* prove_pairing_lan_rank.mjs — 「手机配对」那一行给的到底是哪个地址（LR）
 *
 * 桌面把 os.networkInterfaces() 里非 internal 的 IPv4 原样按枚举顺序拿出来，
 * 第一个既显示在界面上、也是「复制地址」复制出去的东西。真实机器上这个顺序
 * 不由我们决定：装过 Docker 的机器第一个是 172.17.0.1（docker0），云机上是公网
 * 地址，没配上 DHCP 时是 169.254.*。手机敲这些一定失败，而用户看到的仍然是
 * 「一个很像配对地址的东西」—— 这正是「看起来修了」和「真走通」的差别。
 *
 * 修复前的红（用旧实现的枚举逻辑跑同一份 fixture 复现）：
 *   旧顺序 = 172.17.0.1, 172.18.0.1, 172.19.0.1, 192.168.1.23, 169.254.5.6
 *   → 界面显示并复制的是 172.17.0.1（docker0），真正能用的 192.168.1.23 排第 4
 *
 *   LR-01 实体局域网网卡排第一，虚拟/桥接口不许顶在前面
 *   LR-02 旧实现的枚举顺序确实会把 docker0 放到第一（负向对照：说明这条门禁有牙）
 *   LR-03 169.254.*（没 DHCP）排最后，并如实标 link_local
 *   LR-04 公网地址（云机）排在局域网地址之后，标 public
 *   LR-05 100.64/10（Tailscale 一类覆盖网）排在局域网之后、公网之前，标 cgnat
 *   LR-06 family 的两种写法（"IPv4" / 4）都要认，internal 一律剔除
 *   LR-07 负向对照：抹掉可辨认的网卡命名后，仍然按网段判出局域网地址优先
 *   LR-08 读不到网卡就返回空列表 —— 不编地址
 *   LR-09 真机自检：排序结果与列表一致、每个 ip 都真来自本机
 *   LR-10 同为局域网段时的内部优先级：192.168 > 10/8 > 172.16/12（容器段风险）
 *
 * 跑法：node scripts/prove_pairing_lan_rank.mjs（纯 Node）
 */
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const lan = require(path.join(REPO, "hosts/shared/lan_candidates.js"));

let PASS = 0,
  FAIL = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : ""));
};
const done = () => {
  console.log("prove_pairing_lan_rank: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
};

/** 一台装过 Docker、带 Wi-Fi、还有一个没配上 DHCP 的接口的真实形状。 */
const FIXTURE = {
  lo: [
    { address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true },
    { address: "::1", family: "IPv6", internal: true },
  ],
  docker0: [{ address: "172.17.0.1", netmask: "255.255.0.0", family: "IPv4", internal: false }],
  "br-9d3f2c1": [{ address: "172.18.0.1", netmask: "255.255.0.0", family: "IPv4", internal: false }],
  veth1a2b3c: [{ address: "172.19.0.1", netmask: "255.255.0.0", family: "IPv4", internal: false }],
  wlan0: [{ address: "192.168.1.23", netmask: "255.255.255.0", family: "IPv4", internal: false }],
  "utun3": [{ address: "169.254.5.6", netmask: "255.255.255.255", family: "IPv4", internal: false }],
};

/** 旧实现（main.js 改之前）就是照枚举顺序 push —— 用来证明这条门禁不是摆设。 */
function legacyOrder(ifaces) {
  const out = [];
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      const family = a && (a.family === "IPv4" || a.family === 4);
      if (family && a && !a.internal) out.push(String(a.address));
    }
  }
  return out;
}

/* LR-01 */
{
  const list = lan.lanIPv4List(FIXTURE);
  const rows = lan.rankLanIPv4(FIXTURE);
  if (list[0] !== "192.168.1.23") bad("LR-01 配对地址排第一的不是局域网网卡", JSON.stringify(list));
  else if (rows[0].name !== "wlan0" || rows[0].scope !== "private") bad("LR-01 第一名没如实带上网卡名与范围", JSON.stringify(rows[0]));
  else if (new Set(list).size !== list.length) bad("LR-01 列表里有重复地址", JSON.stringify(list));
  else ok("LR-01 局域网网卡排第一（" + list[0] + " ← " + rows[0].name + "），虚拟接口都在后面");
}

/* LR-02 负向对照 */
{
  const legacy = legacyOrder(FIXTURE);
  const now = lan.lanIPv4List(FIXTURE);
  if (legacy[0] === "172.17.0.1" && now[0] !== legacy[0]) {
    ok("LR-02 负向对照成立：旧顺序第一个是 " + legacy[0] + "（docker0），现在换成 " + now[0]);
  } else {
    bad("LR-02 负向对照没跑出来，这条门禁等于没牙", JSON.stringify({ legacy: legacy.slice(0, 3), now: now.slice(0, 3) }));
  }
}

/* LR-03 */
{
  const rows = lan.rankLanIPv4(FIXTURE);
  const ll = rows.find((r) => r.ip === "169.254.5.6");
  if (!ll) bad("LR-03 169.254 地址被吞了（不许吞，得标注）", JSON.stringify(rows.map((r) => r.ip)));
  else if (ll.scope !== "link_local") bad("LR-03 169.254 没标成 link_local", JSON.stringify(ll));
  else if (rows.indexOf(ll) !== rows.length - 1) bad("LR-03 没 DHCP 的地址不该排前面", JSON.stringify(rows.map((r) => r.ip)));
  else ok("LR-03 169.254.* 排最后并如实标注 link_local（手机敲它一定失败）");
}

/* LR-04 / LR-05 */
{
  const MIXED = {
    eth0: [{ address: "25.4.112.106", family: "IPv4", internal: false }],
    "tailscale0": [{ address: "100.84.19.7", family: "IPv4", internal: false }],
    wlan0: [{ address: "192.168.50.12", family: "IPv4", internal: false }],
  };
  const list = lan.lanIPv4List(MIXED);
  const rows = lan.rankLanIPv4(MIXED);
  const i = (ip) => list.indexOf(ip);
  if (list[0] !== "192.168.50.12") bad("LR-04 公网地址抢在了局域网地址前面", JSON.stringify(list));
  else if (i("100.84.19.7") < 0 || i("25.4.112.106") < 0) bad("LR-04 候选地址少了", JSON.stringify(list));
  else if (!(i("192.168.50.12") < i("100.84.19.7") && i("100.84.19.7") < i("25.4.112.106"))) {
    bad("LR-05 覆盖网该排在局域网之后、公网之前", JSON.stringify(list));
  } else {
    const ts = rows.find((r) => r.ip === "100.84.19.7");
    const pub = rows.find((r) => r.ip === "25.4.112.106");
    if (!ts || ts.scope !== "cgnat") bad("LR-05 100.64/10 没标成 cgnat", JSON.stringify(ts));
    else if (!pub || pub.scope !== "public") bad("LR-04 公网地址没标成 public", JSON.stringify(pub));
    else ok("LR-04/05 顺序如实：局域网 → 覆盖网(cgnat) → 公网(public)");
  }
}

/* LR-06 */
{
  const NUMERIC = {
    enp5s0: [
      { address: "10.1.2.3", family: 4, internal: false },
      { address: "127.0.0.1", family: 4, internal: true },
      { address: "fe80::1", family: "IPv6", internal: false },
    ],
  };
  const list = lan.lanIPv4List(NUMERIC);
  if (list.length !== 1 || list[0] !== "10.1.2.3") bad("LR-06 family=4 / internal / IPv6 处理不对", JSON.stringify(list));
  else ok("LR-06 family 两种写法都认，internal 与 IPv6 一律剔除");
}

/* LR-07 负向对照：网卡命名完全看不出来 */
{
  const BLIND = {
    x1: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
    x2: [{ address: "192.168.1.9", family: "IPv4", internal: false }],
  };
  const list = lan.lanIPv4List(BLIND);
  if (list[0] !== "192.168.1.9") bad("LR-07 只看网段也该判出局域网地址", JSON.stringify(list));
  else ok("LR-07 抹掉网卡命名后仍按网段判出 192.168.1.9（不靠接口名赌运气）");
}

/* LR-08 */
{
  if (lan.lanIPv4List({}).length !== 0) bad("LR-08 没有网卡时该返回空");
  else if (lan.lanIPv4List(undefined).length !== 0) bad("LR-08 传 undefined 时该返回空而不是编地址");
  else if (lan.lanIPv4List({ lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] }).length !== 0) {
    bad("LR-08 只有回环时不许把 127.0.0.1 当配对地址", JSON.stringify(lan.lanIPv4List({ lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] })));
  } else ok("LR-08 读不到可用网卡就返回空 —— 不编地址、不把回环糊上去");
}

/* LR-09 真机自检 */
{
  const ifaces = os.networkInterfaces();
  const rows = lan.rankLanIPv4(ifaces);
  const list = lan.lanIPv4List(ifaces);
  const all = [];
  for (const n of Object.keys(ifaces)) for (const a of ifaces[n] || []) if (a && a.address) all.push(String(a.address));
  if (list.join(",") !== rows.map((r) => r.ip).join(",")) bad("LR-09 列表与排序结果不一致", JSON.stringify({ list, rows: rows.map((r) => r.ip) }));
  else if (rows.some((r) => all.indexOf(r.ip) < 0)) bad("LR-09 排序结果里出现本机没有的地址", JSON.stringify(rows.map((r) => r.ip)));
  else if (rows.some((r) => r.ip === "127.0.0.1" || r.ip.startsWith("::"))) bad("LR-09 本机结果里混进了回环/IPv6", JSON.stringify(rows.map((r) => r.ip)));
  else if (rows.length && !["private", "cgnat", "public", "link_local"].includes(rows[0].scope)) bad("LR-09 本机第一名没有如实的范围标注", JSON.stringify(rows[0]));
  else {
    ok(
      "LR-09 本机自检：" +
        (rows.length ? rows[0].ip + " ← " + rows[0].name + "（" + rows[0].scope + "）" : "本机没有可用非回环 IPv4（界面该如实说没有）") +
        "，共 " + rows.length + " 个候选",
    );
  }
}

/* LR-10 局域网段内部也要有优先级（容器段风险） */
{
  const PRIV = {
    x1: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
    x2: [{ address: "10.0.0.5", family: "IPv4", internal: false }],
    x3: [{ address: "192.168.1.9", family: "IPv4", internal: false }],
  };
  const list = lan.lanIPv4List(PRIV);
  if (list.join(",") !== "192.168.1.9,10.0.0.5,172.17.0.1") {
    bad("LR-10 局域网段内部排序不符合 192.168 > 10/8 > 172.16/12", JSON.stringify(list));
  } else {
    ok("LR-10 同为局域网段时：192.168（家里/办公）> 10/8 > 172.16/12（容器段风险）");
  }
}

done();
