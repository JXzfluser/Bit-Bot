"use strict";

/**
 * 「手机配对」到底该把哪个地址交给用户。
 *
 * 桌面以前的做法是：把 os.networkInterfaces() 里所有非 internal 的 IPv4 原样
 * 按枚举顺序列出来，界面显示第一个、复制也复制第一个。真实机器上这个顺序
 * 是「系统想给什么就给什么」：装过 Docker 的机器上是 172.17.0.1（docker0），
 * 云机上是公网地址，没有可用网卡时还会冒出 169.254.*（链路本地，根本连不通）。
 * 手机敲这些地址一定失败，而用户在桌面上看到的是「一个看起来很像配对地址的东西」——
 * 这就是「看起来修了」和「真走通」的差距。
 *
 * 这里只做排序和标注，不编造地址：读不到网卡就是没有，老实返回空列表。
 */

/** 一看就不是手机能走到的虚拟/桥接口（名字优先，因为 docker0 也是 172.16/12 段）。 */
const VIRTUAL_NAME = /^(docker|br-|veth|virbr|kube|cni|flannel|tunl|tap|nats|zt|wg-sc)/i;
/** 常见的实体网卡命名：以太网 / Wi-Fi / 系统直连。 */
const PHYSICAL_NAME = /^(en|eth|wlan|wi|ath|rcvri|ap)/i;

const SCOPE = {
  private: "private",
  cgnat: "cgnat",
  link_local: "link_local",
  public: "public",
};

/**
 * 网段判类：
 *   private    = RFC1918（家里/公司 Wi-Fi 大概率就是这个，手机能直接敲到）
 *   cgnat      = 100.64/10（Tailscale 一类覆盖网；是同一个人的网络，但不是局域网）
 *   link_local = 169.254/16（没配上 DHCP，基本连不通）
 *   public     = 其余（公网/云机地址，手机在 Wi-Fi 里通常走不到）
 */
function classifyScope(ip) {
  const parts = String(ip || "").split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return SCOPE.public;
  const [a, b] = parts;
  if (a === 10) return SCOPE.private;
  if (a === 172 && b >= 16 && b <= 31) return SCOPE.private;
  if (a === 192 && b === 168) return SCOPE.private;
  if (a === 100 && b >= 64 && b <= 127) return SCOPE.cgnat;
  if (a === 169 && b === 254) return SCOPE.link_local;
  return SCOPE.public;
}

function isIpv4(addr) {
  if (!addr) return false;
  const family = addr.family;
  return family === "IPv4" || family === 4 || (typeof family === "string" && family.toLowerCase() === "ipv4");
}

/**
 * 给一块网卡的地址打分：越小越该出现在配对地址那一行。
 * 局域网段内部还要再分层 —— 172.16/12 同时是 Docker / K8s 桥接最爱用的段，
 * 光看名字（docker0、br-）认不全，接口名被改成 x1/x2 或自定义名字时就靠网段兜住。
 * @returns {{score:number, scope:string, virtual:boolean, physical:boolean}}
 */
function scoreCandidate(name, addr) {
  const scope = classifyScope(addr && addr.address);
  const virtual = VIRTUAL_NAME.test(String(name || ""));
  const physical = PHYSICAL_NAME.test(String(name || ""));
  let score =
    scope === SCOPE.private
      ? privateTier(addr && addr.address)
      : scope === SCOPE.cgnat
        ? 30
        : scope === SCOPE.public
          ? 50
          : 70; // link_local 放最后
  if (virtual) score += 20;
  if (physical) score -= 5;
  return { score, scope, virtual, physical };
}

/** 局域网段内部优先级：192.168（家里/办公 Wi-Fi 最常见）> 10/8 > 172.16/12（容器段风险）。 */
function privateTier(ip) {
  const parts = String(ip || "").split(".").map((x) => Number(x));
  const [a, b] = parts;
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 3;
  if (a === 172 && b >= 16 && b <= 31) return 6;
  return 0;
}

/**
 * 排序后的候选地址。
 * @param {ReturnType<import("os").networkInterfaces>} ifaces
 * @returns {Array<{ip:string, name:string, scope:string, virtual:boolean, score:number}>}
 */
function rankLanIPv4(ifaces) {
  const rows = [];
  const seen = new Set();
  try {
    const table = ifaces || {};
    for (const name of Object.keys(table)) {
      for (const addr of table[name] || []) {
        if (!isIpv4(addr) || (addr && addr.internal)) continue;
        const ip = String((addr && addr.address) || "").trim();
        if (!ip || seen.has(ip)) continue;
        seen.add(ip);
        const scored = scoreCandidate(name, { address: ip });
        rows.push({
          ip,
          name: String(name),
          scope: scored.scope,
          virtual: scored.virtual,
          score: scored.score,
        });
      }
    }
  } catch (_e) {
    /* 读不到网卡就老实说没有，不编地址 */
    return [];
  }
  rows.sort((a, b) => (a.score === b.score ? String(a.name).localeCompare(String(b.name)) : a.score - b.score));
  return rows;
}

/** 只要地址列表，顺序 = 手机最可能敲得到的在最前（界面与复制都用它）。 */
function lanIPv4List(ifaces) {
  return rankLanIPv4(ifaces).map((r) => r.ip);
}

module.exports = {
  SCOPE,
  classifyScope,
  rankLanIPv4,
  lanIPv4List,
  scoreCandidate,
};
