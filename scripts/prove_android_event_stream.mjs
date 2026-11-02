#!/usr/bin/env node

/**
 * prove_android_event_stream.mjs — A1-4: Android 事件流结构门（第二版）。
 *
 * 这一门是什么：只读 Kotlin 源码的**结构**断言。它不跑 Android 逻辑，
 * 真机验收仍然要在设备上做（残留 R-A1-4b 写着）。它存在的唯一理由是把
 * 「客户端写了但界面上碰不到」这类只有在真机才会暴露的东西，提前在 CI 照出来。
 *
 * 为什么重写（上一版这门是坏的，不是我不满意风格）：
 *   1) AE-07/AE-08 只查「某个词在文件里出现过」。方法定义了但**没有任何地方调用**，
 *      照样绿。实测：把 TurnCoordinator 里唯一的调用点
 *      `startEventStreamSubscription(machineKind)` 删掉、只留方法定义，
 *      上一版仍然输出 `prove_android_event_stream: PASS=12 FAIL=0`。
 *      —— 那正是「代码写了但用户碰不到」，也是这门本该拦住的第一个病。
 *   2) 三条「注入对照」是恒真的：它把源码里的字符串替换掉，然后检查
 *      「替换后的副本里没有那个字符串」。它从来没有拿**真正的判据**去跑那份副本。
 *      恒真的对照比没有对照更糟 —— 它让人以为判据有牙。
 *      （同类的恒真绿本轮在 GP-96 也抓到过一次：0 个 start + 0 个 done 也判「一一对应」。）
 *   3) 本版第一次跑（对着已经写对的产品代码）报了 4 红，其中两条是**门自己的错**，
 *      原文留在这里，免得下次又把门改松来哄自己：
 *        · AE-06 `{"dumpsJson":true}` —— 我判「不许出现 optString("row")」时没区分代码和
 *          注释，而那串只出现在我自己写的说明注释里（「之前这里写 optString("row")…」）。
 *          修法不是给判据加「忽略注释」的例外，而是**载入时统一剥掉注释**：
 *          过时的一句注释同样能把真 bug 撑绿，那比假红更危险。
 *        · AE-09 `{"onCreatePasses":false}` —— 判据把「传给界面」钉死在 onCreate 体内，
 *          实际代码在 `private fun HomeShell()` 里（onCreate 只有一句 setContent）。
 *          修法不能是「只要文件里有就行」—— 那正是上一版假绿的形状 —— 而是
 *          「谁调用 HomeScreen(，谁的函数体里就必须同时有数据源和那条传参」。
 *      两条改完都必须仍有牙：INJ-AE_06/09/09b 三把注入逐条能把它打回红（见下）。
 *
 * 本版口径（每条都是一个纯判据，输入是「文件集合」）：
 *   AE-01 订阅是只读 GET /v1/events，不许碰 /v1/turn
 *   AE-02 重连带 Last-Event-ID，游标同时写进 from_seq
 *   AE-03 按 seq 去重：只处理比 lastSeq 大的帧
 *   AE-04 turn_ended 分支里真的关连接
 *   AE-05 四类回退提示三语齐全（zh-CN/zh-TW/en）
 *   AE-06 进度行按结构化字段取词（label_key/phase/计数），不许把 row 当 JSON 吐给用户
 *   AE-07 三语文案真的接上系统语言（上一版 currentLocale 从没被赋值，繁体/英文是死代码）
 *   AE-08 订阅真的被回合生命周期驱动：submitTurn 里调用、finally 里关
 *   AE-09 进度与回退真的被界面引用：读 TurnCoordinator 的那个渲染函数必须把
 *        progressLines 一路传到 ChatListView → ProgressRow/FallbackRow
 *   AE-10 回退分支可达且可见：onFallback 设 fallbackMessage，busy 期间渲染 FallbackRow
 *   AE-11 进出界面的连接边界：ON_STOP 关、ON_START 只在「这一轮还在路上」时续订
 *   AE-12 订阅带会话边界 ?session_id=（与服务端默认同规则），不带游标不重放历史
 *   AE-13 close() 不许拖住调用线程（真机上是界面线程；实测过 BufferedReader 读锁死锁）
 *   AE-14 SSE 解析器必须被单测真的执行到（不许再写「构造一个对象再断言它等于自己」）
 *   AE-15 /v1/turn 的请求形状未被触碰（只加可选订阅，不加字段）
 *   INJ-xx 注入对照：把某条改动从**副本**里拿掉，同一个判据必须翻红；
 *          翻不了红就说明那条判据是摆设，本门直接判它红。
 *
 * 退出码：任何一条红即 1。
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

const H = "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host";
const T = "hosts/android/BitBotHost/app/src/test/java/com/bitbot/host";

/** 本门要读的全部文件（注入对照也只复制这些，避免整仓拷贝）。 */
const FILES = {
  client: H + "/EventStreamClient.kt",
  messages: H + "/EventStreamMessages.kt",
  coordinator: H + "/TurnCoordinator.kt",
  activity: H + "/MainActivity.kt",
  home: H + "/ui/HomeScreen.kt",
  components: H + "/ui/Components.kt",
  bridge: H + "/TurnBridge.kt",
  clientTest: T + "/EventStreamClientTest.kt",
  messagesTest: T + "/EventStreamMessagesTest.kt",
};

/* ------------------------------------------------------------------ 工具 */

const read = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

/** 载入一份「源码集合」：root 下的同一批相对路径。 */
function loadSources(root) {
  const out = {};
  for (const k of Object.keys(FILES)) out[k] = stripComments(read(path.join(root, FILES[k])));
  return out;
}

/**
 * 去掉注释，保留字符串原文（`"https://…"` 与 `"""…"""` 里的 `//` 不能被当成注释）。
 *
 * 为什么必须在**载入**这一步做，而不是在各判据里各自小心：
 *   本轮第一版跑出来 AE-06 是红的，报 `dumpsJson:true` —— 而我查的那行
 *   `optString("row")` 只存在于我自己写的说明注释里（「之前这里写 optString("row")，
 *   把整个对象当字符串塞进气泡」）。代码是对的、门是错的。
 *   但我没有把它「改成只查代码区」就算完：注释能骗判据两次 —— 一是让正确的代码显红，
 *   二是让**过时的注释**把错的代码撑绿（写一句「已经不用 optString 了」判据就过了）。
 *   所以判据一律只看代码，注释对本门完全不可见。
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '"' && src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      if (end < 0) { out += src.slice(i); break; }
      out += src.slice(i, end + 3);
      i = end + 3;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === '"') break;
        j++;
      }
      out += src.slice(i, Math.min(j + 1, src.length));
      i = j + 1;
      continue;
    }
    if (c === "/" && c2 === "/") {
      const nl = src.indexOf("\n", i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) break;
      out += " ";
      i = end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * 从声明往后取函数体（大括号配对，跳过字符串与字符字面量里的括号）。
 * `from` = 声明结束处的下标。返回 "" 表示取不到。
 */
function funBodyAt(src, from) {
  let i = from;
  let inStr = false;
  let inChr = false;
  let inLine = false;
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
      i++;
      continue;
    }
    if (c === "/" && c2 === "/") { inLine = true; i += 2; continue; }
    if (!inChr && c === '"') { inStr = !inStr; i++; continue; }
    if (inStr) { if (c === "\\") i++; i++; continue; }
    if (c === "'") inChr = !inChr;
    if (!inChr && c === "{") break;
    i++;
  }
  if (i >= src.length) return "";
  // 配对
  let depth = 0;
  let j = i;
  inStr = false;
  inChr = false;
  inLine = false;
  while (j < src.length) {
    const c = src[j];
    const c2 = src[j + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
      j++;
      continue;
    }
    if (c === "/" && c2 === "/") { inLine = true; j += 2; continue; }
    if (!inChr && c === '"') { inStr = !inStr; j++; continue; }
    if (inStr) { if (c === "\\") j++; j++; continue; }
    if (c === "'") inChr = !inChr;
    if (inChr) { j++; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(i + 1, j);
    }
    j++;
  }
  return src.slice(i + 1);
}

/**
 * 取某个 Kotlin 函数/方法的**函数体**。返回 "" 表示没找到。
 * 判据据此区分「定义了」和「被调用了」—— 这正是上一版缺的那一课。
 */
function funBody(src, name) {
  if (!src) return "";
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("fun\\s+(`?" + esc + "`?)\\s*[<(]");
  const m = re.exec(src);
  if (!m) return "";
  return funBodyAt(src, m.index + m[0].length);
}

/**
 * 取**包含某个调用**的那个函数体（外层优先）。
 *
 * AE-09 上一版把「把进度行交给界面」钉死在 onCreate 的函数体里，结果判红：
 * 真实代码把它放在 `private fun HomeShell()` 这个 composable 里，
 * onCreate 只写了一句 `setContent { BitBotTheme { HomeShell() } }`。
 * 这同样是代码对、门错 —— 但门不许因此改成「文件里出现过就行」，
 * 那样又会退回上一版「定义了但没人调用」的假绿。折中的正确形状是：
 * **谁调 HomeScreen(，谁就必须先读 TurnCoordinator.progressLines 并把它传下去**。
 * 也就是「渲染点与数据源必须在同一个函数体里连上」，换了函数名照样成立，
 * 删掉传参照样翻红（INJ-AE_09 就是删这条传参）。
 */
function bodyCalling(src, needle) {
  if (!src) return "";
  const re = /\bfun\s+`?[A-Za-z_][\w]*`?\s*[<(]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = funBodyAt(src, m.index + m[0].length);
    if (body.includes(needle)) return body;
  }
  return "";
}

/** 判据统一返回 true / false + 一句「为什么不过」。 */
function need(cond, why) {
  return { pass: !!cond, why: cond ? "" : why };
}

/* ------------------------------------------------------- 判据（纯函数集） */

const CHECKS = {
  AE_01: (S) => {
    const c = S.client;
    return need(
      c.includes("/v1/events") && !/["']\/v1\/turn["']/.test(c) && /requestMethod\s*=\s*"GET"/.test(c),
      "订阅面必须是只读 GET /v1/events，且不许出现 /v1/turn",
    );
  },

  AE_02: (S) => {
    const c = S.client;
    return need(
      /setRequestProperty\(\s*"Last-Event-ID"/.test(c) && c.includes("from_seq=") && /lastSeq/.test(c),
      "重连必须同时带 Last-Event-ID 头与 from_seq 游标",
    );
  },

  AE_03: (S) => {
    const parse = funBody(S.client, "parseSseStream");
    return need(
      parse.includes("lastSeq.get()") && /event\.seq\s*>\s*lastSeq\.get\(\)/.test(parse) && parse.includes("lastSeq.set("),
      "解析循环里必须按 seq 去重（只处理比 lastSeq 大的帧）",
    );
  },

  AE_04: (S) => {
    const parse = funBody(S.client, "parseSseStream");
    const i = parse.indexOf('"turn_ended"');
    return need(
      i >= 0 && parse.slice(i, i + 220).includes("close()"),
      "turn_ended 分支必须真的关连接（close()），不许留着长连接",
    );
  },

  AE_05: (S) => {
    const m = S.messages;
    const kinds = ["eventStreamUnavailable", "eventStreamUnauthorized", "eventStreamHttpError", "eventStreamNetworkError"];
    for (const k of kinds) {
      const body = funBody(m, k);
      if (!body) return need(false, k + "() 不存在");
      if (!body.includes('"zh-TW"')) return need(false, k + "() 缺繁体分支");
      if (!body.includes('"en"')) return need(false, k + "() 缺英文分支");
      if (!/else\s*->/.test(body) && !/^\s*else/m.test(body)) {
        if (!body.includes("else ->")) return need(false, k + "() 缺简体兜底分支");
      }
    }
    return need(true, "");
  },

  /* 进度行必须是人话：按 label_key + phase + 计数取词。
   * 上一版是 optString("row") —— 服务端 row 是对象，于是界面吐 JSON。 */
  AE_06: (S) => {
    const upd = funBody(S.messages, "progressUpdate");
    const coord = funBody(S.coordinator, "startEventStreamSubscription");
    if (!upd) return need(false, "EventStreamMessages.progressUpdate() 不存在");
    const readsStructured = upd.includes('optString("label_key")') && upd.includes("progressLabel(");
    const hasCounter = /optInt\("total"\)/.test(upd) && /optInt\("index"\)/.test(upd);
    const readsRowObject = coord.includes('optJSONObject("row")');
    const dumpsJson = /progressUpdate\(\s*(val\s+)?row\s*:\s*String/.test(S.messages) || coord.includes('optString("row")');
    return need(
      readsStructured && hasCounter && readsRowObject && !dumpsJson,
      JSON.stringify({ readsStructured, hasCounter, readsRowObject, dumpsJson }),
    );
  },

  /* 三语文案要真的接上系统语言，否则 zh-TW/en 分支是死代码。 */
  AE_07: (S) => {
    const onCreate = funBody(S.activity, "onCreate");
    const lf = funBody(S.messages, "localeFrom");
    return need(
      onCreate.includes("EventStreamMessages.currentLocale =") && onCreate.includes("localeFrom(") && !!lf && lf.includes('"zh-TW"') && lf.includes('"en"'),
      "界面必须把系统 locale 喂给 EventStreamMessages.currentLocale（否则三语分支永远走不到）",
    );
  },

  /* 订阅要被回合生命周期真的驱动 —— 不是「有个方法就行」。 */
  AE_08: (S) => {
    const submit = funBody(S.coordinator, "submitTurn");
    const iFinally = submit.indexOf("finally");
    return need(
      /startEventStreamSubscription\(/.test(submit) &&
        iFinally >= 0 &&
        submit.slice(iFinally).includes("stopEventStreamSubscription(") &&
        submit.includes("inFlight++"),
      "submitTurn 的函数体里必须真的发起订阅，并在 finally 里关连接",
    );
  },

  /* 进度要走到屏幕上：读 TurnCoordinator → 传给 HomeScreen → ChatListView → ProgressRow。 */
  AE_09: (S) => {
    const shell = bodyCalling(S.activity, "HomeScreen(");
    const home = funBody(S.home, "HomeScreen");
    const chat = funBody(S.components, "ChatListView");
    const rows = funBody(S.components, "ProgressRow");
    const link =
      shell.includes("TurnCoordinator.progressLines") &&
      /progressLines\s*=\s*progressLines/.test(shell) &&
      home.includes("progressLines = progressLines") &&
      chat.includes("ProgressRow(");
    return need(
      link && !!rows && S.coordinator.includes("progressLines = progressLines + line"),
      JSON.stringify({
        renderFnReadsSource: shell.includes("TurnCoordinator.progressLines"),
        activityPasses: /progressLines\s*=\s*progressLines/.test(shell),
        homePasses: home.includes("progressLines = progressLines"),
        chatRenders: chat.includes("ProgressRow("),
        progressRowExists: !!rows,
        coordinatorAppends: S.coordinator.includes("progressLines = progressLines + line"),
      }),
    );
  },

  /* 回退分支必须可达、且真的显示出来。 */
  AE_10: (S) => {
    const start = funBody(S.coordinator, "startEventStreamSubscription");
    const fb = funBody(S.coordinator, "startEventStreamSubscription"); // 回调是内联匿名对象，都在这段里
    const chat = funBody(S.components, "ChatListView");
    const iBusy = chat.indexOf("if (busy)");
    const setsFallback = /onFallback[\s\S]{0,200}fallbackMessage = EventStreamMessages\.fallbackMessage\(/.test(fb);
    return need(
      setsFallback &&
        start.includes("stopEventStreamSubscription(") &&
        iBusy >= 0 &&
        chat.slice(iBusy).includes("FallbackRow(") &&
        !!funBody(S.components, "FallbackRow"),
      JSON.stringify({ setsFallback, closesOnFallback: start.includes("stopEventStreamSubscription("), rendersUnderBusy: iBusy >= 0 && chat.slice(iBusy).includes("FallbackRow(") }),
    );
  },

  /* 连接边界：看不见时关，回来时只在「这一轮还在路上」续订。 */
  AE_11: (S) => {
    const onCreate = funBody(S.activity, "onCreate");
    const resume = funBody(S.coordinator, "resumeEventStreamSubscription");
    return need(
      onCreate.includes("ON_STOP") &&
        onCreate.includes("stopEventStreamSubscription()") &&
        onCreate.includes("ON_START") &&
        onCreate.includes("resumeEventStreamSubscription()") &&
        !!resume &&
        resume.includes("inFlight <= 0") &&
        funBody(S.coordinator, "stopEventStreamSubscription").includes("lastStreamSeq"),
      "ON_STOP 关连接、ON_START 带游标续订，三处缺一不算闭",
    );
  },

  /* 会话边界：订自己的 session，不带游标时不重放历史（服务端默认档已改）。 */
  AE_12: (S) => {
    const connect = funBody(S.client, "connectAndRead");
    const start = funBody(S.coordinator, "startEventStreamSubscription");
    return need(
      connect.includes("session_id=") && connect.includes("URLEncoder.encode(") && start.includes('"mobile-"') && start.includes("machineKind"),
      "订阅必须带 ?session_id=，且会话名要与服务端默认 mobile-<machineKind> 同规则",
    );
  },

  /* close() 不许在调用线程上拆 socket —— 实测过界面线程卡在 BufferedReader 读锁。 */
  AE_13: (S) => {
    const close = funBody(S.client, "close");
    if (!close) return need(false, "Subscription.close() 不存在");
    const onCaller = /^\s*(try\s*\{\s*)?(reader|rdr)\?\.close\(\)/m.test(close) || close.includes("reader?.close()");
    const handedOff = /Thread\s*\{/.test(close) && close.includes("isDaemon = true");
    return need(
      !onCaller && handedOff && close.includes("closed.getAndSet(true)"),
      "socket/流拆解必须交给守护线程：调用线程（界面线程）上直接 close 会与阻塞中的 read 抢读锁",
    );
  },

  /* 解析器要真的被单测执行到（上一版的「解析测试」是自己造对象再断言它等于自己）。 */
  AE_14: (S) => {
    const decl = /internal fun parseSseStream\(/.test(S.client);
    const calls = (S.clientTest.match(/\.parseSseStream\(/g) || []).length;
    return need(
      decl && calls >= 3 && S.clientTest.includes("java.net.ServerSocket"),
      "parseSseStream 必须可测（internal）且被真实驱动：至少 3 处调用 + 一条真 socket 的关闭不阻塞用例",
    );
  },

  /* 铁律：不碰既有 /v1/turn 的形状。 */
  AE_15: (S) => {
    const b = S.bridge;
    return need(
      b.includes("runTurnHttp") && /POST/.test(b) && b.includes("turnEndpoint") && !b.includes("/v1/events"),
      "TurnBridge 必须还是那条 POST /v1/turn 的老路，订阅不许长在它身上",
    );
  },
};

/* -------------------------------------------------- 注入对照（真跑判据） */

/**
 * 每一把注入都是：把这批文件复制到临时 root → 改坏一处 → 用**同一个判据**跑那份副本。
 * 判据必须翻红，否则这条断言是摆设 —— 那是本门的红，不是被注入代码的红。
 */
const INJECTIONS = [
  {
    id: "INJ-AE_02",
    check: "AE_02",
    what: "删掉 Last-Event-ID 请求头",
    mutate: (F) => { F.client = F.client.replace(/setRequestProperty\(\s*"Last-Event-ID"[\s\S]*?\n/, "// removed\n"); },
  },
  {
    id: "INJ-AE_03",
    check: "AE_03",
    what: "把 seq 去重的比较翻成恒真",
    mutate: (F) => { F.client = F.client.replace("event.seq > lastSeq.get()", "event.seq >= 0"); },
  },
  {
    id: "INJ-AE_04",
    check: "AE_04",
    what: "删掉 turn_ended 分支里的 close()",
    mutate: (F) => { F.client = F.client.replace('if (event.kind == "turn_ended") {\n                  close()', 'if (event.kind == "turn_ended") {\n                  // removed'); },
  },
  {
    id: "INJ-AE_06",
    check: "AE_06",
    what: "退回上一版：把 row 当字符串塞进文案（真机上就是吐 JSON）",
    mutate: (F) => {
      F.coordinator = F.coordinator.replace('EventStreamMessages.progressUpdate(event.payload?.optJSONObject("row"))', 'EventStreamMessages.progressUpdateRowRaw(event.payload?.optString("row"))');
    },
  },
  {
    id: "INJ-AE_07",
    check: "AE_07",
    what: "删掉 locale 赋值（三语文案就变回死代码）",
    mutate: (F) => { F.activity = F.activity.replace(/EventStreamMessages\.currentLocale =\s*\n?\s*EventStreamMessages\.localeFrom\([^)]*\)\)?\n?/, ""); },
  },
  {
    id: "INJ-AE_08",
    check: "AE_08",
    what: "删掉 submitTurn 里唯一的订阅发起点（方法定义仍留着）",
    mutate: (F) => { F.coordinator = F.coordinator.replace("startEventStreamSubscription(machineKind, 0L)\n", ""); },
  },
  {
    id: "INJ-AE_09",
    check: "AE_09",
    what: "删掉 MainActivity 往 HomeScreen 传进度行的那条参数（数据源与渲染点断链）",
    mutate: (F) => { F.activity = F.activity.replace("progressLines = progressLines,\n", ""); },
  },
  {
    id: "INJ-AE_09b",
    check: "AE_09",
    what: "删掉 ChatListView 里的 ProgressRow 渲染（传到了也不显示）",
    mutate: (F) => { F.components = F.components.replace(/ProgressRow\(progressLines\)/, "// removed"); },
  },
  {
    id: "INJ-AE_10",
    check: "AE_10",
    what: "删掉 busy 分支里的 FallbackRow 渲染",
    mutate: (F) => { F.components = F.components.replace(/FallbackRow\(fallbackMessage\)/, "// removed"); },
  },
  {
    id: "INJ-AE_11",
    check: "AE_11",
    what: "删掉 ON_STOP 关连接（长连接挂在后台）",
    mutate: (F) => { F.activity = F.activity.replace("if (event == Lifecycle.Event.ON_STOP) TurnCoordinator.stopEventStreamSubscription()", ""); },
  },
  {
    id: "INJ-AE_12",
    check: "AE_12",
    what: "订阅不带 session_id（会看见别会话的帧）",
    mutate: (F) => { F.client = F.client.replace(/qs\.add\("session_id=" \+ URLEncoder\.encode\(it, "UTF-8"\)\)/, "// removed"); },
  },
  {
    id: "INJ-AE_13",
    check: "AE_13",
    what: "回到在调用线程上直接关 reader（实测会把界面线程锁死）",
    mutate: (F) => {
      F.client = F.client.replace(
        /Thread \{[\s\S]*?\}\.apply \{ isDaemon = true \}\.start\(\)/,
        "reader?.close()\n      connection?.disconnect()",
      );
    },
  },
];

/* --------------------------------------------------------------- 执行器 */

function runChecks(S, only) {
  const res = {};
  for (const key of Object.keys(CHECKS)) {
    if (only && !only.includes(key)) continue;
    let r;
    try {
      r = CHECKS[key](S);
    } catch (err) {
      r = { pass: false, why: "判据执行异常：" + String((err && err.message) || err) };
    }
    res[key] = r;
  }
  return res;
}

/** 把 FILES 复制到临时 root，交给 mutate 改坏，返回该 root。 */
function makeMutatedCopy(inj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prove-android-sse-inj-"));
  const F = loadSources(REPO);
  for (const k of Object.keys(FILES)) {
    if (!(k in F)) throw new Error("文件集合不完整: " + k);
  }
  inj.mutate(F);
  for (const k of Object.keys(FILES)) {
    const dst = path.join(dir, FILES[k]);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, F[k]);
  }
  return dir;
}

const TITLE = {
  AE_01: "订阅面只读 GET /v1/events，没碰 /v1/turn",
  AE_02: "重连带 Last-Event-ID 与 from_seq 游标",
  AE_03: "客户端按 seq 去重",
  AE_04: "turn_ended 分支真的关连接",
  AE_05: "四类回退提示三语齐全（zh-CN/zh-TW/en）",
  AE_06: "进度行按 label_key/phase/计数取词，不把 row 当 JSON 吐给用户",
  AE_07: "三语文案真的接上系统 locale",
  AE_08: "订阅被回合生命周期驱动（submitTurn 发起、finally 关）",
  AE_09: "进度真的走到界面（渲染函数读 TurnCoordinator → 传 HomeScreen → ChatListView → ProgressRow）",
  AE_10: "回退可达且可见（onFallback 设文案、busy 下渲染 FallbackRow）",
  AE_11: "ON_STOP 关连接、ON_START 带游标续订",
  AE_12: "订阅带 ?session_id=，会话名与服务端默认同规则",
  AE_13: "close() 不在调用线程上拆 socket（界面线程不许被读锁拖住）",
  AE_14: "SSE 解析器被单测真的执行（含真 socket 关闭不阻塞用例）",
  AE_15: "/v1/turn 请求形状未被触碰",
};

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 400) : "")); };

const LABEL = (k) => k.replace("_", "-");

(function main() {
  const S = loadSources(REPO);
  for (const key of Object.keys(FILES)) {
    if (!S[key]) bad(LABEL(key) + " 前置：读不到源文件", FILES[key]);
  }

  const results = runChecks(S);
  for (const key of Object.keys(CHECKS)) {
    const r = results[key];
    if (r.pass) ok(LABEL(key) + " " + TITLE[key]);
    else bad(LABEL(key) + " " + TITLE[key] + " —— 判据不过", r.why);
  }

  /* 注入对照：同一判据在改坏的副本上必须翻红 */
  for (const inj of INJECTIONS) {
    let dir = null;
    try {
      dir = makeMutatedCopy(inj);
      const before = results[inj.check];
      if (!before || !before.pass) {
        bad(inj.id + " 无法对照：原判据 " + LABEL(inj.check) + " 本就是红的");
        continue;
      }
      const after = runChecks(loadSources(dir), [inj.check])[inj.check];
      if (!after.pass) ok(inj.id + " 注入对照有牙：" + inj.what + " → " + LABEL(inj.check) + " 翻红");
      else bad(inj.id + " 注入对照失效：", inj.what + " 之后 " + LABEL(inj.check) + " 仍然绿 —— 这条断言是摆设");
    } catch (err) {
      bad(inj.id + " 注入对照执行异常", String((err && err.stack) || err));
    } finally {
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
    }
  }

  console.log("\nprove_android_event_stream: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
})();
