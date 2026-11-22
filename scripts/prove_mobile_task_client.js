#!/usr/bin/env node
"use strict";

/**
 * prove_mobile_task_client —— 手机端「能指挥」的客户端,口径必须与服务端一致
 *
 * 现场:批 4 把插话 / 改向 / 刹停 / 换人开成了 HTTP 路由(只认设备签名),
 * 手机第一次够得着那台机器上的团队。**但路由是手抄的** ——
 * Android 与 iOS 两份客户端各抄一遍端点、字段名与词表,手抄的东西天然会漂。
 * 漂了之后的症状特别难查:界面不报错,只是「点了没反应」或「界面上一片空白」。
 *
 * 所以这道门把两边的抄写**钉在服务端源码的字面量上**:
 *   1. 端点路径:客户端拼的必须与服务端 `hosts/shared/cn_inbound_server.js` +
 *      `hosts/shared/task_view.js` 里的路由一致;
 *   2. 字段名:客户端读的每一个字段,服务端响应里必须真的有(顶层 + 嵌套);
 *   3. 请求体:四个动作各自送哪些字段,必须与服务端那一段读的**逐条一致**;
 *   4. 决定词表:四个动作(steer/replan/cancel/swap)与四个桶
 *      (needs_you/working/waiting/closed)与服务端**逐字一致**;
 *   5. 错误码 → HTTP 状态:与服务端 `taskCommandStatus()` 同一套映射;
 *   6. 鉴权:只用**设备签名**(四个 `x-bitbot-*` 头),不许回落 bearer。
 *
 * ⚠️ 诚实的边界:
 *   - 沙箱里**没有 Swift/Kotlin 编译器**,所以本门不能证明原生代码能编译,
 *     更不能证明真机上点得通(那一条是批 5 的「诚实残留」,单列在报告里);
 *   - 本门是**纯源码断言**(不起进程、不联网)⇒ 它属于 L1(秒级、每次提交都跑);
 *     服务端那半边的**真 HTTP**由兄弟门 `prove_task_view_http.mjs`(批 3)与
 *     `prove_task_command_http.mjs`(批 4)守着 —— 本门不重复起服务。
 *
 * 反向对照(判据必须**有牙**):门自己会把端上的副本改坏
 * (端点路径抄错 / 词表抄错 / 状态映射抄错 / 读一个服务端没有的字段),
 * 跑一遍必须判红 —— 源文件一个字节都不动(副本在临时目录里)。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 400) : "")); };
const check = (cond, m, d) => { if (cond) ok(m); else bad(m, d); };

const REPO = path.resolve(__dirname, "..");
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const readIf = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

/* 本门声明的断言编号 —— 矩阵按这份清单**逐条**锚点。清单与实现漂了就红。
   ⚠️ 第一个元素是 "(head)":锚点覆盖尺(AC-02)是从「逗号 + 引号 + 编号」这个形状
   读门声明的编号的 ⇒ 第一个真实编号前面必须有一个逗号(兄弟门 prove_task_command_http.mjs
   同一个形状)。 */
const CLAIM_IDS = [
  "(head)", "MT-01", "MT-02", "MT-03", "MT-04", "MT-05", "MT-06",
  "MT-07", "MT-08", "MT-09", "MT-10", "MT-11", "MT-12", "MT-13",
];
const CLAIM_ID_SET = new Set(CLAIM_IDS.filter((x) => x !== "(head)"));
const usedIds = new Set();
const mt = (id, cond, m, d) => {
  usedIds.add(id);
  if (!CLAIM_ID_SET.has(id)) {
    bad("[" + id + "] 断言编号没登记在 CLAIM_IDS 里(清单与实现漂了) — " + m);
    return;
  }
  if (cond) ok("[" + id + "] " + m);
  else bad("[" + id + "] " + m, d);
};

/* ---------------------------------------------------------------------------
 * 剥掉注释行再抠字面量。
 *
 * 为什么必须:不剥的话,正则抠到了**注释里**的 `{host}/v1/tasks`
 * ⇒ 门禁被文档文字骗过去(源码里其实写的是另一个样子)。
 * 注释里的字面量**不算**代码里的字面量。
 * ------------------------------------------------------------------------- */
const codeOnly = (src) =>
  String(src || "")
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t.startsWith("//")) return false;
      if (t.startsWith("*")) return false;
      if (t.startsWith("/*") || t.startsWith("*/")) return false;
      return true;
    })
    .join("\n");

/** 路径规整:去掉前导斜杠(两端拼法不同)⇒ 比的是**规整后**的形状。 */
const normPath = (s) => String(s || "").replace(/^\/+/, "");

/* ---------------------------------------------------------------------------
 * 端上的源码目录(可被环境变量换掉 —— 反向对照要拿**副本**跑)。
 * ------------------------------------------------------------------------- */
const ANDROID_DIR =
  process.env.BITBOT_ANDROID_SRC_DIR ||
  path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host");
const IOS_DIR =
  process.env.BITBOT_IOS_SRC_DIR ||
  path.join(REPO, "hosts/ios/BitBotHost/Sources/BitBotHost");

const androidClient = read(path.join(ANDROID_DIR, "TaskCommandClient.kt"));
const androidSheet = read(path.join(ANDROID_DIR, "ui/TaskCommandSheet.kt"));
const androidMain = read(path.join(ANDROID_DIR, "MainActivity.kt"));
const androidSheets = read(path.join(ANDROID_DIR, "ui/Sheets.kt"));
const iosClient = read(path.join(IOS_DIR, "TaskCommandClient.swift"));
const iosSheet = read(path.join(IOS_DIR, "TaskCommandSheet.swift"));
const iosContent = read(path.join(IOS_DIR, "ContentView.swift"));

const server = read(path.join(REPO, "hosts/shared/cn_inbound_server.js"));
const taskView = read(path.join(REPO, "hosts/shared/task_view.js"));
const surface = read(path.join(REPO, "hosts/desktop/product_surface.js"));

console.log("prove_mobile_task_client（手机端「指挥」客户端口径）");

/* ════════════════════════════════════════════════════════════════════════════
 * A. 服务端真源:把契约从源码里**抠出来**(不手抄)
 * ════════════════════════════════════════════════════════════════════════════ */

/* A-1 清单端点:`GET /v1/tasks`。 */
const SERVER_LIST_PATH = (server.match(/p === "(\/v1\/tasks)"/) || [])[1] || "";

/* A-2 四条指挥路由:前缀 + 动作词表(真源在共享寻址契约里,不在路由表里)。 */
const routeLine = taskView.split("\n").find((l) => l.includes("TASK_SIG_ROUTE_RE")) || "";
const SERVER_COMMAND_PREFIX = (() => {
  // 路由源码形如 `\/v1\/tasks\/([^/]+)\/(steer|replan|cancel|swap)` ——
  // 前缀就是「sig 那一段之前」的那截(含结尾那个斜杠)。
  const m = routeLine.match(/\\\/(.+?)\\\/\(\[\^\/\]\+\)/);
  if (!m) return "";
  return "/" + m[1].replace(/\\\//g, "/") + "/";
})();
const SERVER_ACTIONS = (() => {
  const m = routeLine.match(/\(([a-z|]+)\)\s*\$/);
  if (!m) return [];
  return m[1].split("|").map((s) => s.trim()).filter(Boolean);
})();

/* A-3 桶词表(真源在共享聚合里)。 */
const SERVER_BUCKETS = Array.from(
  new Set(Array.from(taskView.matchAll(/\.bucket\s*=\s*"([a-z_]+)"/g)).map((m) => m[1])),
);

/* A-4 清单每一项的字段(顶层 + 嵌套):从 `toTaskListItem` 的返回对象里抠。 */
const objectKeysFrom = (src, braceAt) => {
  const keys = [];
  const lines = src.slice(braceAt).split("\n");
  let depth = 0;
  for (const line of lines) {
    // `key:` 与 `key,`(ES6 简写)都算一个键。
    const km = line.match(/^\s*([A-Za-z_$][\w$]*)\s*[:,]/);
    if (km && depth === 1) keys.push(km[1]);
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    depth += opens - closes;
    if (depth <= 0) break;
  }
  return keys;
};
/** `toTaskListItem` 的返回对象:顶层键 + 每一项自己的那一段。 */
const itemStruct = (() => {
  const fnAt = taskView.indexOf("function toTaskListItem(");
  if (fnAt < 0) return { top: [], regions: {} };
  const retAt = taskView.indexOf("return {", fnAt);
  if (retAt < 0) return { top: [], regions: {} };
  const braceAt = taskView.indexOf("{", retAt);
  const bodyLines = taskView.slice(braceAt).split("\n");
  // 逐行记下「进入这一行时」的深度。
  const rows = [];
  let depth = 0;
  for (const line of bodyLines) {
    rows.push({ line, depth });
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (depth <= 0 && rows.length > 1) break;
  }
  const top = [];
  const regions = {};
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].depth !== 1) continue;
    const km = rows[i].line.match(/^\s*([A-Za-z_$][\w$]*)\s*[:,]/);
    if (!km) continue;
    top.push(km[1]);
    let j = i + 1;
    while (j < rows.length && rows[j].depth !== 1) j++;
    regions[km[1]] = rows.slice(i, j).map((r) => r.line).join("\n");
  }
  return { top, regions };
})();
/** 一项里那个嵌套对象的键(有就抠,没有就是空)。 */
const nestedKeysOf = (region) => {
  if (!region) return [];
  const rAt = region.indexOf("return {");
  const bAt = region.indexOf(": {");
  let pick = -1;
  if (rAt >= 0 && (bAt < 0 || rAt < bAt)) pick = rAt;
  else if (bAt >= 0) pick = bAt;
  if (pick < 0) return [];
  return objectKeysFrom(region, region.indexOf("{", pick));
};
const itemFields = (() => {
  const nested = {};
  for (const key of itemStruct.top) nested[key] = nestedKeysOf(itemStruct.regions[key]);
  // needs_you 的内层对象不是就地写的(是先算好再挂上去)⇒ 单独抠。
  const needsAt = taskView.indexOf("needs = t.needs_you");
  if (needsAt >= 0) {
    const b = taskView.indexOf("{", needsAt);
    if (b >= 0) nested["needs_you"] = objectKeysFrom(taskView, b);
  }
  return { top: itemStruct.top, nested };
})();

/* A-5 清单响应体的顶层字段(ok / device_id / count / tasks)。 */
const SERVER_LIST_TOP = (() => {
  const at = server.indexOf('json(res, 200, {\n          ok: true,\n          device_id:');
  if (at < 0) return [];
  return objectKeysFrom(server, server.indexOf("{", at));
})();

/* A-6 四条路由那一段(参数校验 / 错误码 / 回执都在里面)。 */
const cmdBlock = (() => {
  const start = server.indexOf("const cmdRoute = taskView.matchTaskSigRoute(p);");
  const end = server.indexOf("// 配对落地页");
  if (start < 0) return "";
  return server.slice(start, end > start ? end : server.length);
})();

/* A-7 每个动作各送哪些 body 字段。 */
const SERVER_BODY_KEYS = (() => {
  const out = {};
  const firstAt = cmdBlock.indexOf('action === "');
  // 共用的:在分支之前就读掉的 body 字段(room_id 四个动作都要)。
  const common = new Set();
  if (firstAt > 0) {
    for (const m of cmdBlock.slice(0, firstAt).matchAll(/body\.([a-z_]+)/g)) common.add(m[1]);
  }
  for (const action of SERVER_ACTIONS) {
    const at = cmdBlock.indexOf('action === "' + action + '"');
    if (at < 0) { out[action] = []; continue; }
    const rest = cmdBlock.slice(at);
    const next = rest.indexOf('action === "', 1);
    const region = next > 0 ? rest.slice(0, next) : rest;
    const keys = new Set(common);
    for (const m of region.matchAll(/body\.([a-z_]+)/g)) keys.add(m[1]);
    out[action] = Array.from(keys).sort();
  }
  return out;
})();

/* A-8 错误码 → HTTP 状态:服务端 `taskCommandStatus()` 的规则 + 产品自己的码。 */
const statusFnBody = (server.match(/function taskCommandStatus\(code\)\s*\{[\s\S]*?\n\}/) || [])[0] || "";
const SERVER_NOT_FOUND_CODES = Array.from(
  new Set(Array.from(statusFnBody.matchAll(/c === "([a-z_]+)"/g)).map((m) => m[1])),
);
/** 产品那四个函数自己产的错误码(真源在 product_surface.js,不在路由层)。 */
const productErrorCodes = (() => {
  const fns = ["steerRoomTask", "replanRoomTask", "reassignRoomTask", "cancelRoomTask"];
  const out = new Set();
  for (const name of fns) {
    const at = surface.indexOf("function " + name + "(");
    if (at < 0) continue;
    const braceAt = surface.indexOf("{", at);
    if (braceAt < 0) continue;
    // 逐行扫到这一层的花括号收口为止,只取**这个函数**里的 error 码。
    const lines = surface.slice(braceAt).split("\n");
    let depth = 0;
    const body = [];
    for (const line of lines) {
      body.push(line);
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0 && body.length > 1) break;
    }
    for (const m of body.join("\n").matchAll(/error:\s*"([a-z_]+)"/g)) out.add(m[1]);
  }
  return Array.from(out);
})();
const SERVER_ERROR_STATUS = (() => {
  const map = {};
  const codes = new Set(productErrorCodes);
  // 路由层自己校验的那些参数缺失码。
  for (const m of cmdBlock.matchAll(/json\(res,\s*400,\s*\{[^}]*?error:\s*"([a-z_]+)"/g)) {
    codes.add(m[1]);
  }
  for (const code of codes) {
    if (/_required$/.test(code)) map[code] = 400;
    else if (SERVER_NOT_FOUND_CODES.indexOf(code) >= 0) map[code] = 404;
    else map[code] = 409;
  }
  return map;
})();

/* A-9 指挥回执的字段(成功那一份 + 失败那一份)。 */
const SERVER_COMMAND_FIELDS = (() => {
  const out = new Set();
  const replyAt = cmdBlock.indexOf("const reply = {");
  if (replyAt >= 0) {
    for (const k of objectKeysFrom(cmdBlock, cmdBlock.indexOf("{", replyAt))) out.add(k);
  }
  for (const m of cmdBlock.matchAll(/reply\.([a-z_]+)\s*=/g)) out.add(m[1]);
  for (const m of cmdBlock.matchAll(/json\(res,\s*taskCommandStatus\([^)]*\),\s*\{([^}]*)\}/g)) {
    for (const k of objectKeysFrom(cmdBlock, cmdBlock.indexOf("{", m.index))) out.add(k);
  }
  return Array.from(out);
})();

/* ════════════════════════════════════════════════════════════════════════════
 * B. 端上的抄写:从客户端源码里**抠出来**(同样不手抄)
 * ════════════════════════════════════════════════════════════════════════════ */

/** 从一段源码里抠出 `const val NAME = "值"` / `static let name = "值"`。 */
const kotlinConst = (src, name) => {
  const m = src.match(new RegExp("const\\s+val\\s+" + name + "\\s*=\\s*\"([^\"]*)\""));
  return m ? m[1] : "";
};
const swiftConst = (src, name) => {
  const m = src.match(new RegExp("static\\s+let\\s+" + name + "\\s*=\\s*\"([^\"]*)\""));
  return m ? m[1] : "";
};
/** 从一段源码里抠出 `val NAME = listOf("a", "b")` / `static let name = ["a", "b"]`。 */
const kotlinList = (src, name) => {
  const m = src.match(new RegExp("val\\s+" + name + "\\s*(?::[^=]*)?=\\s*listOf\\(([^)]*)\\)"));
  if (!m) return [];
  return Array.from(m[1].matchAll(/"([^"]*)"/g)).map((x) => x[1]);
};
const swiftList = (src, name) => {
  const m = src.match(new RegExp("static\\s+let\\s+" + name + "\\s*(?::[^=]*)?=\\s*\\[([^\\]]*)\\]"));
  if (!m) return [];
  return Array.from(m[1].matchAll(/"([^"]*)"/g)).map((x) => x[1]);
};

/** 一个函数体(brace 配平)。 */
const functionBody = (src, marker) => {
  const at = src.indexOf(marker);
  if (at < 0) return "";
  const braceAt = src.indexOf("{", at);
  if (braceAt < 0) return "";
  let depth = 0;
  for (let i = braceAt; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(braceAt, i + 1);
    }
  }
  return src.slice(braceAt);
};

/** 端上读的 JSON 字段(Kotlin 的 opt 前缀 / get 前缀,与 Swift 的下标)。 */
const kotlinReadFields = (src) =>
  Array.from(
    new Set(
      Array.from(
        src.matchAll(/\.(?:opt|get)(?:String|Int|Long|Boolean|Double|Float|Num|JSONArray|JSONObject)\(\s*"([^"]+)"/g),
      ).map((m) => m[1]),
    ),
  );
const swiftReadFields = (src) =>
  Array.from(
    new Set(
      Array.from(
        src.matchAll(/\["([a-z_][a-z0-9_]*)"\](?=\s*(?:as\?|\?\?))/g),
      ).map((m) => m[1]),
    ),
  );

/** 每个动作送出去的 body 字段。 */
const kotlinBodyKeys = (src, action) => {
  const body = functionBody(src, "fun " + action + "(");
  return Array.from(new Set(Array.from(body.matchAll(/\.put\(\s*"([^"]+)"/g)).map((m) => m[1]))).sort();
};
const swiftBodyKeys = (src, action) => {
  const body = functionBody(src, "func " + action + "Payload(");
  return Array.from(new Set(Array.from(body.matchAll(/"([^"]+)"\s*:/g)).map((m) => m[1]))).sort();
};

/** 从某个下标开始的**配平括号**区域(不含那对括号本身)。 */
const bracketRegion = (src, from, open) => {
  const close = open === "(" ? ")" : open === "[" ? "]" : "}";
  const start = src.indexOf(open, from);
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  return "";
};

/** 端上声明的「错误码 → 状态」表。 */
const kotlinStatusMap = (src) => {
  const consts = {};
  for (const m of src.matchAll(/const\s+val\s+([A-Z_]+)\s*=\s*(\d{3})/g)) consts[m[1]] = Number(m[2]);
  const at = src.indexOf("val BY_ERROR");
  if (at < 0) return {};
  const body = bracketRegion(src, at, "(");
  const out = {};
  for (const m of body.matchAll(/"([a-z_]+)"\s+to\s+([A-Z_]+)/g)) {
    const v = consts[m[2]];
    if (v === undefined) return out;
    out[m[1]] = v;
  }
  return out;
};
const swiftStatusMap = (src) => {
  const consts = {};
  for (const m of src.matchAll(/static\s+let\s+([a-zA-Z]+)\s*=\s*(\d{3})/g)) consts[m[1]] = Number(m[2]);
  const at = src.indexOf("static let byError");
  if (at < 0) return {};
  const eq = src.indexOf("= [", at);
  if (eq < 0) return {};
  const body = bracketRegion(src, eq + 2, "[");
  const out = {};
  for (const m of body.matchAll(/"([a-z_]+)"\s*:\s*([a-zA-Z]+)/g)) {
    const v = consts[m[2]];
    if (v === undefined) return out;
    out[m[1]] = v;
  }
  return out;
};

const androidClientCode = codeOnly(androidClient);
const iosClientCode = codeOnly(iosClient);

/* ════════════════════════════════════════════════════════════════════════════
 * C. 断言
 * ════════════════════════════════════════════════════════════════════════════ */

/* --- MT-01 文件在位 ------------------------------------------------------- */
mt("MT-01", androidClient.length > 0, "MT-01 Android 侧有 TaskCommandClient.kt");
mt("MT-01", androidSheet.length > 0, "MT-01 Android 侧有 ui/TaskCommandSheet.kt");
mt("MT-01", iosClient.length > 0, "MT-01 iOS 侧有 TaskCommandClient.swift");
mt("MT-01", iosSheet.length > 0, "MT-01 iOS 侧有 TaskCommandSheet.swift");
mt("MT-01", server.length > 0 && taskView.length > 0, "MT-01 服务端源码在");

/* --- MT-02 清单端点 ------------------------------------------------------- */
mt("MT-02", SERVER_LIST_PATH === "/v1/tasks",
  "MT-02 服务端有 GET /v1/tasks 这条路由", "抠出来:" + SERVER_LIST_PATH);
{
  const kt = kotlinConst(androidClientCode, "LIST_PATH");
  const sw = swiftConst(iosClientCode, "list");
  mt("MT-02", normPath(kt) === normPath(SERVER_LIST_PATH),
    "MT-02 Android 请求的是服务端那条清单路径", "Android=" + kt + " 服务端=" + SERVER_LIST_PATH);
  mt("MT-02", normPath(sw) === normPath(SERVER_LIST_PATH),
    "MT-02 iOS 请求的是服务端那条清单路径", "iOS=" + sw + " 服务端=" + SERVER_LIST_PATH);
  // 声明出来的常量必须**真的被用上**(不许是摆在那里的死字面量)。
  mt("MT-02", androidClientCode.split("LIST_PATH").length > 2,
    "MT-02 Android 的 LIST_PATH 被真的用上了(不是死字面量)");
  mt("MT-02", iosClientCode.split("TaskCommandRoute.list").length > 1,
    "MT-02 iOS 的 TaskCommandRoute.list 被真的用上了(不是死字面量)");
}

/* --- MT-03 四条路由的前缀 ------------------------------------------------- */
mt("MT-03", SERVER_COMMAND_PREFIX === "/v1/tasks/",
  "MT-03 服务端那四条路由的前缀是 /v1/tasks/", "抠出来:" + SERVER_COMMAND_PREFIX);
{
  const kt = kotlinConst(androidClientCode, "COMMAND_PREFIX");
  const sw = swiftConst(iosClientCode, "commandPrefix");
  mt("MT-03", normPath(kt) === normPath(SERVER_COMMAND_PREFIX),
    "MT-03 Android 拼的四条路由前缀与服务端一致", "Android=" + kt);
  mt("MT-03", normPath(sw) === normPath(SERVER_COMMAND_PREFIX),
    "MT-03 iOS 拼的四条路由前缀与服务端一致", "iOS=" + sw);
}

/* --- MT-04 决定词表(四个动作) --------------------------------------------- */
mt("MT-04", SERVER_ACTIONS.length === 4,
  "MT-04 服务端那四个动作抠出来了", JSON.stringify(SERVER_ACTIONS));
{
  const kt = kotlinList(androidClientCode, "ACTIONS");
  const sw = swiftList(iosClientCode, "actions");
  const sorted = (a) => a.slice().sort();
  mt("MT-04", sorted(kt).join(",") === sorted(SERVER_ACTIONS).join(","),
    "MT-04 Android 的动作词表与服务端逐字一致",
    "Android=" + JSON.stringify(kt) + " 服务端=" + JSON.stringify(SERVER_ACTIONS));
  mt("MT-04", sorted(sw).join(",") === sorted(SERVER_ACTIONS).join(","),
    "MT-04 iOS 的动作词表与服务端逐字一致",
    "iOS=" + JSON.stringify(sw) + " 服务端=" + JSON.stringify(SERVER_ACTIONS));
  // 词表里不许出现服务端不认的词(例如把 cancel 写成 stop)。
  for (const [name, list] of [["Android", kt], ["iOS", sw]]) {
    const unknown = list.filter((w) => SERVER_ACTIONS.indexOf(w) < 0);
    mt("MT-04", unknown.length === 0,
      "MT-04 " + name + " 的动作词表里没有服务端不认的词", JSON.stringify(unknown));
  }
  // 词表必须**被用上**(端上真的按这四个词去拼路径)。
  mt("MT-04", /ACTIONS\.contains\(action\)|action in ACTIONS/.test(androidClientCode),
    "MT-04 Android 拼路径前真的按词表校验过动作名");
  mt("MT-04", /TaskCommandRoute\.actions\.contains\(action\)/.test(iosClientCode),
    "MT-04 iOS 拼路径前真的按词表校验过动作名");
}

/* --- MT-05 桶词表 --------------------------------------------------------- */
mt("MT-05", SERVER_BUCKETS.length === 4,
  "MT-05 服务端那四个桶抠出来了", JSON.stringify(SERVER_BUCKETS));
{
  const kt = kotlinList(androidClientCode, "BUCKETS");
  const sw = swiftList(iosClientCode, "buckets");
  const sorted = (a) => a.slice().sort();
  mt("MT-05", sorted(kt).join(",") === sorted(SERVER_BUCKETS).join(","),
    "MT-05 Android 的桶词表与服务端逐字一致",
    "Android=" + JSON.stringify(kt) + " 服务端=" + JSON.stringify(SERVER_BUCKETS));
  mt("MT-05", sorted(sw).join(",") === sorted(SERVER_BUCKETS).join(","),
    "MT-05 iOS 的桶词表与服务端逐字一致",
    "iOS=" + JSON.stringify(sw) + " 服务端=" + JSON.stringify(SERVER_BUCKETS));
  for (const b of SERVER_BUCKETS) {
    mt("MT-05", androidSheet.indexOf('"' + b + '"') >= 0,
      "MT-05 Android 界面认得这个桶:" + b);
    mt("MT-05", iosSheet.indexOf('"' + b + '"') >= 0,
      "MT-05 iOS 界面认得这个桶:" + b);
  }
}

/* --- MT-06 清单字段 ------------------------------------------------------- */
{
  const universe = new Set();
  for (const k of itemFields.top) universe.add(k);
  for (const k of Object.keys(itemFields.nested)) {
    for (const n of itemFields.nested[k]) universe.add(n);
  }
  for (const k of SERVER_LIST_TOP) universe.add(k);
  for (const k of SERVER_COMMAND_FIELDS) universe.add(k);
  const required = new Set();
  for (const k of itemFields.top) required.add(k);
  for (const k of Object.keys(itemFields.nested)) {
    for (const n of itemFields.nested[k]) required.add(n);
  }
  for (const k of SERVER_LIST_TOP) required.add(k);

  for (const [name, src] of [["Android", androidClientCode], ["iOS", iosClientCode]]) {
    const read = name === "Android" ? kotlinReadFields(src) : swiftReadFields(src);
    const missing = Array.from(required).filter((k) => read.indexOf(k) < 0);
    mt("MT-06", missing.length === 0,
      "MT-06 " + name + " 读了服务端发的每一个字段", "缺:" + missing.join(","));
    const extra = read.filter((k) => !universe.has(k));
    mt("MT-06", extra.length === 0,
      "MT-06 " + name + " 没有读服务端根本不发的字段", "多:" + extra.join(","));
  }
  mt("MT-06", itemFields.top.length >= 15,
    "MT-06 服务端清单项的字段抠出来了(顶层 " + itemFields.top.length + " 个)",
    JSON.stringify(itemFields.top));
}

/* --- MT-07 请求体(四个动作逐条) ------------------------------------------- */
{
  for (const action of SERVER_ACTIONS) {
    const expect = (SERVER_BODY_KEYS[action] || []).slice().sort();
    const kt = kotlinBodyKeys(androidClientCode, action);
    const sw = swiftBodyKeys(iosClientCode, action);
    mt("MT-07", kt.join(",") === expect.join(","),
      "MT-07 Android 的 " + action + " 请求体字段与服务端一致",
      "Android=" + JSON.stringify(kt) + " 服务端=" + JSON.stringify(expect));
    mt("MT-07", sw.join(",") === expect.join(","),
      "MT-07 iOS 的 " + action + " 请求体字段与服务端一致",
      "iOS=" + JSON.stringify(sw) + " 服务端=" + JSON.stringify(expect));
  }
  mt("MT-07", SERVER_ACTIONS.length === 4, "MT-07 四个动作都抠到了请求体字段");
}

/* --- MT-08 错误码 → 状态 -------------------------------------------------- */
{
  const expect = SERVER_ERROR_STATUS;
  mt("MT-08", Object.keys(expect).length >= 8,
    "MT-08 服务端的错误码抠出来了", JSON.stringify(expect));
  mt("MT-08", /_required\$/.test(statusFnBody) && statusFnBody.indexOf("return 400") >= 0,
    "MT-08 服务端 taskCommandStatus 的 400 规则抠到了(参数缺失 ⇒ 400)");
  mt("MT-08", statusFnBody.indexOf("return 404") >= 0,
    "MT-08 服务端 taskCommandStatus 的 404 规则抠到了(找不到 ⇒ 404)");
  mt("MT-08", statusFnBody.indexOf("return 409") >= 0,
    "MT-08 服务端 taskCommandStatus 的 409 规则抠到了(业务失败 ⇒ 409)");
  const kt = kotlinStatusMap(androidClientCode);
  const sw = swiftStatusMap(iosClientCode);
  for (const [name, map] of [["Android", kt], ["iOS", sw]]) {
    const keys = Object.keys(map).sort();
    const expectKeys = Object.keys(expect).sort();
    mt("MT-08", keys.join(",") === expectKeys.join(","),
      "MT-08 " + name + " 的错误码集合与服务端一致",
      name + "=" + JSON.stringify(keys) + " 服务端=" + JSON.stringify(expectKeys));
    const wrong = keys.filter((k) => map[k] !== expect[k]);
    mt("MT-08", wrong.length === 0,
      "MT-08 " + name + " 的错误码 → 状态与服务端一致",
      JSON.stringify(wrong.map((k) => k + ":" + map[k] + "≠" + expect[k])));
  }
}

/* --- MT-09 设备签名 ------------------------------------------------------- */
{
  const headers = ["x-bitbot-device", "x-bitbot-timestamp", "x-bitbot-nonce", "x-bitbot-signature"];
  mt("MT-09", /DeviceIdentity\.requestHeaders\(/.test(androidClientCode),
    "MT-09 Android 用的是仓里既有的 DeviceIdentity.requestHeaders(不另起一套)");
  mt("MT-09", /identity\.requestHeaders\(body:/.test(iosClientCode),
    "MT-09 iOS 用的是仓里既有的 DeviceIdentity.requestHeaders(不另起一套)");
  // Android 侧与 ApprovalClient 同一形状:四个头**逐个**挂上去。
  for (const h of headers) {
    mt("MT-09", androidClientCode.indexOf(h) >= 0, "MT-09 Android 挂了设备签名头:" + h);
  }
  // iOS 侧走 DeviceIdentity 的 headerFields(与 ApprovalClient.swift 同一形状)——
  // 四个头的**名字**在 DeviceIdentity.swift 里(那是仓里既有的那一份)。
  mt("MT-09", iosClientCode.indexOf("headerFields") >= 0,
    "MT-09 iOS 把 DeviceIdentity 的签名头整组挂上(不自己拼头名)");
  const iosIdentity = read(path.join(IOS_DIR, "DeviceIdentity.swift"));
  for (const h of headers) {
    mt("MT-09", iosIdentity.indexOf(h) >= 0, "MT-09 iOS 的设备身份里带着这个头:" + h);
  }
  for (const [name, src] of [["Android", androidClientCode], ["iOS", iosClientCode]]) {
    mt("MT-09", !/Bearer|Authorization/i.test(src),
      "MT-09 " + name + " 没有回落 bearer(指挥面只认设备签名)");
  }
}

/* --- MT-10 不另起数据源 --------------------------------------------------- */
{
  for (const [name, src] of [["Android", androidClientCode], ["iOS", iosClientCode]]) {
    mt("MT-10", src.indexOf("tasks.json") < 0 && src.indexOf("rooms.json") < 0,
      "MT-10 " + name + " 没有自己去读 Task 实体 / 转录(清单只从 GET /v1/tasks 来)");
    mt("MT-10", /"can"|\["can"\]/.test(src),
      "MT-10 " + name + " 读的是服务端算的 can.*(能不能点不自己猜)");
    mt("MT-10", src.indexOf("bucket ==") < 0 && !/bucket\s*=\s*"/.test(src),
      "MT-10 " + name + " 没有端上重算桶(桶是服务端算的)");
  }
}

/* --- MT-11 界面接线 ------------------------------------------------------- */
{
  mt("MT-11", codeOnly(androidSheets).indexOf("onTaskCommand") >= 0,
    "MT-11 Android 菜单接了 onTaskCommand");
  mt("MT-11", codeOnly(androidSheets).indexOf('title = "指挥任务"') >= 0,
    "MT-11 Android 菜单有「指挥任务」这一行");
  mt("MT-11", codeOnly(androidMain).indexOf("showTaskCommand") >= 0,
    "MT-11 Android 有 showTaskCommand 状态");
  mt("MT-11", codeOnly(androidMain).indexOf("TaskCommandSheet(") >= 0,
    "MT-11 Android 面板真的被呈现");
  mt("MT-11", codeOnly(androidMain).indexOf("taskCommandClientNow") >= 0,
    "MT-11 Android 用的是 TaskCommandClient(不是另起一个客户端)");
  mt("MT-11", codeOnly(iosContent).indexOf('Button("指挥")') >= 0,
    "MT-11 iOS 工具栏有「指挥」入口");
  mt("MT-11", codeOnly(iosContent).indexOf("TaskCommandSheet()") >= 0,
    "MT-11 iOS 面板真的被呈现");
  mt("MT-11", codeOnly(iosContent).indexOf("showTaskCommand") >= 0,
    "MT-11 iOS 有 showTaskCommand 状态");
}

/* --- MT-12 三语文案 ------------------------------------------------------- */
{
  for (const [name, src] of [["Android", androidSheet], ["iOS", iosSheet]]) {
    mt("MT-12", src.indexOf('"zh-TW"') >= 0, "MT-12 " + name + " 有繁体那一档");
    mt("MT-12", src.indexOf('"zh-CN"') >= 0 || src.indexOf('"zh-TW"') >= 0,
      "MT-12 " + name + " 的 locale 归一到了那三档");
    mt("MT-12", /case "en"|"en" ->/.test(src), "MT-12 " + name + " 有英文那一档");
    mt("MT-12", src.indexOf("TaskCommandMessages") >= 0,
      "MT-12 " + name + " 的可见文案走统一的消息对象(不硬编码单语言)");
  }
  mt("MT-12", androidSheet.indexOf('"zh-TW"') >= 0 && iosSheet.indexOf('"zh-TW"') >= 0,
    "MT-12 两边的三语档位是对齐的");
}

/* --- MT-13 反向对照(源文件一个字节都不动) -------------------------------- */
if (process.argv.includes("--no-self-check")) {
  for (const id of CLAIM_ID_SET) {
    if (usedIds.has(id)) continue;
    // MT-13 的断言住在「反向对照」那一段里 —— 子进程模式**故意**跳过它
    // (否则就是无限递归 ⇒ 进程互改源文件)。所以这里不能把它算成悬空。
    if (id === "MT-13") continue;
    fail++;
    console.log("  ✗ CLAIM_IDS 里声明了 " + id + " 但门里没有任何一条断言用它(悬空锚点)");
  }
  console.log("\nprove_mobile_task_client: PASS=" + pass + " FAIL=" + fail + " SKIP=0");
  process.exit(fail ? 1 : 0);
} else {
  const runMutated = (dirs, label) => {
    let red = false;
    let out = "";
    try {
      execFileSync(
        process.execPath,
        [path.join(__dirname, "prove_mobile_task_client.js"), "--no-self-check"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: Object.assign({}, process.env, dirs),
        },
      );
    } catch (e) {
      red = true;
      out = String(e.stdout || "") + String(e.stderr || "");
    }
    const ids = Array.from(new Set(Array.from(out.matchAll(/✗ \[([A-Z]+-\d+)\]/g)).map((m) => m[1])));
    console.log("    · " + label + " ⇒ rc=" + (red ? "红" : "绿") +
      " 红断言:" + (ids.length ? ids.join(",") : "（无 —— 判据没牙！）"));
    return { red, out, ids };
  };

  const copyDir = (src) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-mobtask-"));
    fs.cpSync(src, tmp, { recursive: true });
    return tmp;
  };
  const mutate = (file, from, to) => {
    const src = fs.readFileSync(file, "utf8");
    if (src.indexOf(from) < 0) return false;
    fs.writeFileSync(file, src.replace(from, to), "utf8");
    return true;
  };

  /* ① 端点路径抄错(Android: /v1/tasks ⇒ /v1/task)。 */
  {
    const tmp = copyDir(ANDROID_DIR);
    const okMutate = mutate(
      path.join(tmp, "TaskCommandClient.kt"),
      'const val LIST_PATH = "/v1/tasks"',
      'const val LIST_PATH = "/v1/task"',
    );
    mt("MT-13", okMutate, "MT-13 变异①打上了(Android 端点路径抄错)");
    if (okMutate) {
      const r = runMutated({ BITBOT_ANDROID_SRC_DIR: tmp }, "① Android 端点路径抄错");
      mt("MT-13", r.red, "MT-13 变异①:门必须判红", "rc 绿了");
      mt("MT-13", r.ids.indexOf("MT-02") >= 0,
        "MT-13 变异①:红的正是端点那条(MT-02)", r.ids.join(","));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ② 决定词表抄错(iOS: cancel ⇒ stop)。 */
  {
    const tmp = copyDir(IOS_DIR);
    const okMutate = mutate(
      path.join(tmp, "TaskCommandClient.swift"),
      'static let actions = ["steer", "replan", "cancel", "swap"]',
      'static let actions = ["steer", "replan", "stop", "swap"]',
    );
    mt("MT-13", okMutate, "MT-13 变异②打上了(iOS 动作词表抄错:stop)");
    if (okMutate) {
      const r = runMutated({ BITBOT_IOS_SRC_DIR: tmp }, "② iOS 动作词表抄错(cancel→stop)");
      mt("MT-13", r.red, "MT-13 变异②:门必须判红", "rc 绿了");
      mt("MT-13", r.ids.indexOf("MT-04") >= 0,
        "MT-13 变异②:红的正是词表那条(MT-04)", r.ids.join(","));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ③ 状态映射抄错(Android: no_running_task ⇒ 400)。 */
  {
    const tmp = copyDir(ANDROID_DIR);
    const okMutate = mutate(
      path.join(tmp, "TaskCommandClient.kt"),
      '"no_running_task" to CONFLICT',
      '"no_running_task" to BAD_REQUEST',
    );
    mt("MT-13", okMutate, "MT-13 变异③打上了(Android 错误码状态抄错)");
    if (okMutate) {
      const r = runMutated({ BITBOT_ANDROID_SRC_DIR: tmp }, "③ Android no_running_task ⇒ 400");
      mt("MT-13", r.red, "MT-13 变异③:门必须判红", "rc 绿了");
      mt("MT-13", r.ids.indexOf("MT-08") >= 0,
        "MT-13 变异③:红的正是状态映射那条(MT-08)", r.ids.join(","));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ④ 读一个服务端根本不发的字段(iOS: bucket ⇒ bucket_name)。 */
  {
    const tmp = copyDir(IOS_DIR);
    const okMutate = mutate(
      path.join(tmp, "TaskCommandClient.swift"),
      'bucket: String(row["bucket"] ?? "")',
      'bucket: String(row["bucket_name"] ?? "")',
    );
    mt("MT-13", okMutate, "MT-13 变异④打上了(iOS 读了一个服务端没有的字段)");
    if (okMutate) {
      const r = runMutated({ BITBOT_IOS_SRC_DIR: tmp }, "④ iOS 读服务端没有的字段(bucket_name)");
      mt("MT-13", r.red, "MT-13 变异④:门必须判红", "rc 绿了");
      mt("MT-13", r.ids.indexOf("MT-06") >= 0,
        "MT-13 变异④:红的正是字段那条(MT-06)", r.ids.join(","));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* --- 编号清单不许有悬空项 -------------------------------------------------- */
for (const id of CLAIM_ID_SET) {
  if (!usedIds.has(id)) {
    fail++;
    console.log("  ✗ CLAIM_IDS 里声明了 " + id + " 但门里没有任何一条断言用它(悬空锚点)");
  }
}

console.log("\nprove_mobile_task_client: PASS=" + pass + " FAIL=" + fail + " SKIP=0");
process.exit(fail ? 1 : 0);
