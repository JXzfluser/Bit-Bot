/* prove_bot_manager.js — 机器人管理（渠道 + 扫码关联）的门。
 *
 * 这一版改的是信息架构，最怕两件事：
 *   ① 渠道又跑回配对弹窗里（用户会以为钉钉是连手机的另一种方式）；
 *   ② 二维码是画上去的 —— 扫了没反应，或者手机填完桌面不知道。
 * 所以这一门分两段：静态的 IA 断言 + **真起一个 cn_inbound 服务**跑一遍绑定流程。
 * 后者不接受「代码里有就走通」：必须先 GET 到那一页、表单字段对、提交成功、
 * token 一次性、过期拒绝、串渠道拒绝，逐条真打。
 *
 * 跑法：node scripts/prove_bot_manager.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const HTML = path.join(ROOT, "hosts", "desktop", "index.html");
const CSS = path.join(ROOT, "hosts", "desktop", "ui_chrome.css");
const { createChannelBindManager, CHANNELS } = require(path.join(
  ROOT, "hosts/shared/channel_bind.js"));
const { createCnInboundServer } = require(path.join(ROOT, "hosts/shared/cn_inbound_server.js"));

let PASS = 0;
let FAIL = 0;
const ok = (id, msg) => { PASS++; console.log("  ✓ " + id + " " + msg); };
const bad = (id, msg, detail) => {
  FAIL++;
  console.log("  ✗ " + id + " " + msg + (detail ? " :: " + JSON.stringify(detail) : ""));
};

/* 切片：按 <div id="x" 到下一个同级 <div id="y" 之间。避免「全文里找得到」这种恒真断言。 */
function blockOf(html, id, endId) {
  const start = html.indexOf('<div id="' + id + '"');
  if (start < 0) return "";
  const end = endId ? html.indexOf('<div id="' + endId + '"', start) : -1;
  return end > start ? html.slice(start, end) : html.slice(start);
}

/* 只数「要让用户打字」的控件。checkbox/radio 是开关，不算输入框。 */
function countTypingInputs(block) {
  const tags = block.match(/<(input|textarea|select)\b[^>]*>/gi) || [];
  return tags.filter((t) => {
    const m = t.match(/type="([^"]+)"/i);
    const type = m ? m[1].toLowerCase() : "";
    if (type === "checkbox" || type === "radio" || type === "hidden") return false;
    return true;
  }).length;
}

function httpReq(port, method, p, body, contentType) {
  return new Promise((resolve) => {
    const headers = {};
    let buf = null;
    if (body != null) {
      buf = Buffer.from(body, "utf8");
      headers["Content-Type"] = contentType || "application/x-www-form-urlencoded";
      headers["Content-Length"] = buf.length;
    }
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method, headers, agent: false, timeout: 8000 },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on("error", (e) => resolve({ status: 0, body: String(e && e.message) }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
    if (buf) req.write(buf);
    req.end();
  });
}

function waitFor(pred, ms) {
  const until = Date.now() + ms;
  return new Promise((resolve) => {
    (function loop() {
      if (pred()) return resolve(true);
      if (Date.now() > until) return resolve(false);
      setTimeout(loop, 40);
    })();
  });
}

async function main() {
  console.log("prove_bot_manager:");

  const html = fs.readFileSync(HTML, "utf8");
  const css = fs.readFileSync(CSS, "utf8");

  /* ── 静态：IA 与形态 ───────────────────────────────────────────────── */
  const mcBlock = blockOf(html, "mobile-control-modal", "bot-manager-modal");
  const bmBlock = blockOf(html, "bot-manager-modal", "relay-settings-modal");

  if (!mcBlock || !bmBlock) {
    bad("BM-01", "两个弹窗切不出来", { mc: mcBlock.length, bm: bmBlock.length });
  } else if (/mc-ch-|使用 Bot Channel|mcChannelTitle/.test(mcBlock)) {
    bad("BM-01", "渠道卡片又回到了手机配对弹窗（IA 回退）");
  } else {
    ok("BM-01", "手机配对弹窗里没有任何渠道卡片（渠道归机器人管理）");
  }

  {
    /* 四个渠道是数据驱动的：HTML 里只留空 <aside>，条目由 channels 渲染。
       所以断言分两半 —— 静态骨架在 bmBlock，四条渠道在 channel_bind.js。 */
    const ids = Object.keys(CHANNELS);
    const want = ["dingtalk", "feishu", "wecom", "wechat"];
    const missing = want.filter((w) => ids.indexOf(w) < 0);
    const hasList = /class="bm-list"|id="bm-list"/.test(bmBlock);
    const painted = /bmPaintList/.test(html) && /bmState\.channels/.test(html);
    if (missing.length) bad("BM-02", "渠道表缺项", { missing });
    else if (!hasList || !painted) bad("BM-02", "左侧列表骨架或渲染函数缺失", { hasList, painted });
    else ok("BM-02", "四条渠道（钉钉/飞书/企微/微信）在渠道表里，左侧列表由数据渲染");
  }

  {
    /* 主区零输入框：这一屏的整个设计目标。detail 里不该出现需要打字的控件。 */
    const n = countTypingInputs(bmBlock);
    const typing = (bmBlock.match(/<(input|textarea|select)\b[^>]*>/gi) || []).filter((t) => {
      const m = t.match(/type="([^"]+)"/i);
      const type = m ? m[1].toLowerCase() : "";
      return type !== "checkbox" && type !== "radio" && type !== "hidden";
    });
    if (n !== 0) bad("BM-03", "机器人管理主区出现了 " + n + " 个打字控件", typing.slice(0, 4));
    else ok("BM-03", "机器人管理主区打字控件 = 0（开关是 checkbox，不算输入）");
  }

  if (!bmBlock || !/id="bm-qr"/.test(bmBlock) || !/id="bm-begin"/.test(bmBlock)) {
    bad("BM-04", "二维码容器或生成按钮缺失");
  } else if (!/id="bm-qr-empty"/.test(bmBlock)) {
    bad("BM-04", "没有空态文案：码没生成时那块白板会什么都不说");
  } else {
    ok("BM-04", "二维码容器 + 空态 + 生成按钮齐备");
  }

  if (!/id="bm-bind-status"/.test(bmBlock) || !/data-state/.test(bmBlock)) {
    bad("BM-05", "缺少「等待扫码」状态行（data-state 驱动的四种状态）");
  } else if (!/bmState\.timer|setInterval\(bmTick/.test(html)) {
    bad("BM-05", "状态行没有倒计时：用户不知道码还能用多久");
  } else {
    ok("BM-05", "有状态行 + 倒计时（等待/成功/过期/错误四态）");
  }

  {
    /* 微信：不给假码。这是本门最想守住的一条诚实边界。 */
    const wx = CHANNELS.wechat;
    const noQr = wx && wx.bindable === false && (wx.fields || []).length === 0;
    const hasPath = /id="bm-path"/.test(bmBlock) && wx && Boolean(wx.path);
    if (!noQr) bad("BM-06", "微信被做成了可绑定渠道（没有官方接口，扫码一定是假的）");
    else if (!hasPath) bad("BM-06", "微信不可绑定但没给可达路径（用户会走进死路）");
    else ok("BM-06", "微信如实标为不可扫码，并给出企业微信这条真路径");
  }

  {
    /* 解除关联是不可逆的：必须两步确认，不能一下点掉。 */
    const armed = /bmUnbindConfirm/.test(html) && /is-armed/.test(html);
    const single = /bmUnbindBtn/.test(html) && !armed;
    if (!armed) bad("BM-07", "解除关联是一步到位的（凭据会被静默删掉）", { single });
    else ok("BM-07", "解除关联要两步确认，4s 自动复位");
  }

  {
    const keys = [
      "bmTitle", "bmBindTitle", "bmNotBound", "bmBound", "bmQrEmpty", "bmBegin",
      "bmWaiting", "bmExpired", "bmBoundDone", "bmUnbind", "bmOpenWecom", "mcManagerHint",
    ];
    const missing = keys.filter((k) => (html.match(new RegExp("\\b" + k + ":", "g")) || []).length !== 3);
    if (missing.length) bad("BM-08", "词条不是「三语各一次」", { missing });
    else ok("BM-08", "新增词条在 zh-CN / zh-TW / en 三块各恰好一次");
  }

  {
    /* 修掉的旧错误：中转弹窗标题曾经写着「机器人管理」。 */
    const relayHead = html.indexOf('id="mc-relay-modal-title"');
    const snippet = relayHead > 0 ? html.slice(relayHead, relayHead + 160) : "";
    if (!snippet) bad("BM-09", "找不到中转弹窗标题");
    else if (/data-i18n="mcManager"/.test(snippet)) bad("BM-09", "中转弹窗标题又写成「机器人管理」了");
    else ok("BM-09", "中转弹窗标题不再冒充机器人管理");
  }

  {
    const rules = [".bm-layout", ".bm-item", ".bm-qr", ".bm-switch", ".bm-badge"];
    const missing = rules.filter((r) => css.indexOf(r + " ") < 0 && css.indexOf(r + "{") < 0);
    if (missing.length) bad("BM-10", "样式缺类", { missing });
    else if (!/@media \(max-width: 720px\)[\s\S]{0,400}\.bm-layout \{ grid-template-columns: 1fr/.test(css)) {
      bad("BM-10", "窄屏没有降成单列（手机上会挤成两栏）");
    } else ok("BM-10", "样式齐备且 720px 下降成单列");
  }

  /* ── 运行时：真起服务跑一遍绑定流程 ───────────────────────────────── */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bm-gate-"));
  const bound = [];
  const mgr = createChannelBindManager({
    onBound: async ({ channel, patch }) => {
      bound.push({ channel, patch });
      return { ok: true };
    },
  });
  let srv = null;
  try {
    srv = createCnInboundServer({
      repoRoot: tmp,
      port: 0,
      host: "127.0.0.1",
      channelBind: mgr,
    });
    const st = await srv.start();
    const port = st && st.port ? st.port : 0;
    if (!port) throw new Error("服务没起来（port=0）");

    /* BM-11 签发 + 真打开那一页 */
    const begun = mgr.begin("dingtalk");
    if (!begun.ok || !begun.token) {
      bad("BM-11", "签发失败", begun);
    } else {
      const url = "/bind?t=" + encodeURIComponent(begun.token) + "&ch=dingtalk";
      const page = await httpReq(port, "GET", url);
      const hasForm = /<form method="post" action="\/v1\/bind\/claim"/.test(page.body);
      const fields = ["BITBOT_DINGTALK_WEBHOOK", "BITBOT_DINGTALK_APP_SECRET"].filter(
        (f) => page.body.indexOf('name="' + f + '"') >= 0);
      if (page.status !== 200) bad("BM-11", "扫码打开那一页不是 200", { status: page.status });
      else if (!hasForm) bad("BM-11", "页面里没有提交表单（无脚本环境提交不了）");
      else if (fields.length !== 2) bad("BM-11", "表单字段与渠道定义不一致", { fields });
      else ok("BM-11", "GET /bind → 200，表单 action=/v1/bind/claim，两个钉钉字段都在");
    }

    /* BM-12 坏 token */
    {
      const p = await httpReq(port, "GET", "/bind?t=deadbeef&ch=dingtalk");
      if (p.status !== 410) bad("BM-12", "坏 token 没有拒绝", { status: p.status });
      else if (/name="BITBOT_DINGTALK_WEBHOOK"/.test(p.body)) bad("BM-12", "坏 token 仍然渲染了表单");
      else ok("BM-12", "坏 token → 410，且不渲染任何表单");
    }

    /* BM-13 必填缺失不消费 token */
    {
      const begun2 = mgr.begin("feishu");
      const body =
        "t=" + encodeURIComponent(begun2.token) + "&ch=feishu&BITBOT_FEISHU_TOKEN=abc";
      const r = await httpReq(port, "POST", "/v1/bind/claim", body);
      const stillAlive = mgr.peek(begun2.token, "feishu").ok;
      if (r.status !== 400) bad("BM-13", "缺必填没有拒绝", { status: r.status });
      else if (!/这一栏是必填的/.test(r.body)) bad("BM-13", "页面没说清哪一栏缺");
      else if (!stillAlive) bad("BM-13", "校验失败却把 token 消费了（改一栏再提交就被判过期）");
      else ok("BM-13", "缺必填 → 400 + 逐栏说清，且 token 未被消费");
    }

    /* BM-14 真提交成功 + 落到 onBound */
    {
      const begun3 = mgr.begin("dingtalk");
      const body =
        "t=" + encodeURIComponent(begun3.token) + "&ch=dingtalk" +
        "&BITBOT_DINGTALK_WEBHOOK=" + encodeURIComponent("https://oapi.dingtalk.com/robot/send?access_token=abc123") +
        "&BITBOT_DINGTALK_APP_SECRET=" + encodeURIComponent("SECxyz");
      const r = await httpReq(port, "POST", "/v1/bind/claim", body);
      const rec = bound[bound.length - 1] || null;
      if (r.status !== 200) bad("BM-14", "合法提交没有 200", { status: r.status, body: r.body.slice(0, 200) });
      else if (!/已关联/.test(r.body)) bad("BM-14", "成功页没说已关联");
      else if (!rec || rec.channel !== "dingtalk" ||
               rec.patch.BITBOT_DINGTALK_WEBHOOK !== "https://oapi.dingtalk.com/robot/send?access_token=abc123" ||
               rec.patch.BITBOT_DINGTALK_APP_SECRET !== "SECxyz") {
        bad("BM-14", "onBound 没收到完整凭据", rec);
      } else ok("BM-14", "合法提交 → 200 + 两项凭据原样交给宿主落盘");
    }

    /* BM-15 一次性 */
    {
      const begun4 = mgr.begin("dingtalk");
      const good =
        "t=" + encodeURIComponent(begun4.token) + "&ch=dingtalk" +
        "&BITBOT_DINGTALK_WEBHOOK=" + encodeURIComponent("https://oapi.dingtalk.com/robot/send?access_token=zzz");
      const first = await httpReq(port, "POST", "/v1/bind/claim", good);
      const second = await httpReq(port, "POST", "/v1/bind/claim", good);
      if (first.status !== 200) bad("BM-15", "首次提交就失败", { status: first.status });
      else if (second.status === 200) bad("BM-15", "同一个 token 能提交两次（重放成立）");
      else if (!/已经失效/.test(second.body)) bad("BM-15", "重放被拒但没说人话");
      else ok("BM-15", "同一 token 第二次提交被拒（一次性成立）");
    }

    /* BM-16 串渠道 */
    {
      const begun5 = mgr.begin("dingtalk");
      const r = await httpReq(
        port, "POST", "/v1/bind/claim",
        "t=" + encodeURIComponent(begun5.token) + "&ch=wecom&BITBOT_WECOM_TOKEN=x&BITBOT_WECOM_AGENT_ID=1&BITBOT_WECOM_TOUSER=@all",
      );
      if (r.status === 200) bad("BM-16", "钉钉的 token 能绑到企微上（串渠道）");
      else ok("BM-16", "token 绑死签发时的渠道，串渠道被拒");
    }

    /* BM-17 微信不可绑定 */
    {
      const r = mgr.begin("wechat");
      if (r.ok) bad("BM-17", "微信居然签发了绑定码");
      else if (r.error !== "channel_not_bindable") bad("BM-17", "拒绝理由不对", r);
      else ok("BM-17", "微信 begin() 明确拒绝（channel_not_bindable），不造假码");
    }

    /* BM-18 过期：注入时钟，不靠 sleep */
    {
      let clock = Date.now();
      const mgr2 = createChannelBindManager({ now: () => clock, ttlMs: 1000 });
      const b = mgr2.begin("feishu");
      clock += 5000;
      const r = mgr2.claim(b.token, {
        channel: "feishu",
        values: { BITBOT_FEISHU_TOKEN: "t", BITBOT_FEISHU_CHAT_ID: "oc_x" },
      });
      const res = await r;
      if (res.ok) bad("BM-18", "过期 token 仍能提交");
      else if (res.error !== "bind_token_expired" && res.error !== "bind_token_unknown") {
        bad("BM-18", "过期拒绝理由不对", res);
      } else ok("BM-18", "超过 TTL 后提交被拒（注入时钟，不靠 sleep）");
    }

    /* BM-19 凭据不进日志/不回显到密码框 */
    {
      const begun6 = mgr.begin("wecom");
      const body =
        "t=" + encodeURIComponent(begun6.token) + "&ch=wecom" +
        "&BITBOT_WECOM_TOKEN=SECRET-TOKEN-VALUE&BITBOT_WECOM_AGENT_ID=100001&BITBOT_WECOM_TOUSER=@all";
      const r = await httpReq(port, "POST", "/v1/bind/claim", body);
      if (r.status !== 200) bad("BM-19", "企微合法提交失败", { status: r.status });
      else if (r.body.indexOf("SECRET-TOKEN-VALUE") >= 0) bad("BM-19", "成功页把凭据明文吐回页面");
      else ok("BM-19", "成功页不回显任何凭据明文");
    }
  } catch (e) {
    bad("BM-20", "运行时段异常", String((e && e.stack) || e));
  } finally {
    try { if (srv) await srv.stop(); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  {
    /* 能开得出来但关不掉，是最容易漏的一类：Esc 与点遮罩都走
       BB_SHEET_CLOSE + bbBindSheetMask 这两张表，少一处就只剩右上角叉。 */
    const hasCloseEntry = /"bot-manager-modal":\s*\(\)\s*=>\s*bmClose\(\)/.test(html);
    const hasMask = /bbBindSheetMask\("bot-manager-modal"\)/.test(html);
    if (!hasCloseEntry) bad("BM-21", "Esc 路径没接：BB_SHEET_CLOSE 里没有 bot-manager-modal");
    else if (!hasMask) bad("BM-21", "点遮罩关不掉：没有 bbBindSheetMask(\"bot-manager-modal\")");
    else ok("BM-21", "Esc 与点遮罩都能关（两张表都登记了）");
  }

  {
    /* 「启用」必须等有凭据：写一个 *_POST=1 却没 Webhook，界面显示已开启、
       消息永远发不出去 —— 这是最费工单的一种状态。 */
    const dis = /bmEls\.enabled\.disabled = !bindable \|\| !c\.bound;/.test(html);
    if (!dis) bad("BM-22", "未关联时「启用」开关仍可打开（会造出「开着但发不出去」的渠道）");
    else ok("BM-22", "「启用」以已关联为前提；绑定成功后由主进程顺手打开");
  }

  /* ── 静态：主进程 → 渲染层这条回执链 ──────────────────────────────────
   * 这一段是**静态**断言，说清楚是为了不冒充端到端：真正的写盘会往
   * 用户自己的 .env.local 里写渠道凭据，门禁里不该干这件事。
   * 所以这里钉的是「四个环节都在、少一环会红」，写盘本身复用既有
   * upsertDesktopEnvLocal（已被 secrets:set 的门覆盖）。 */
  {
    const mainJs = fs.readFileSync(path.join(ROOT, "hosts", "desktop", "main.js"), "utf8");
    const preloadJs = fs.readFileSync(path.join(ROOT, "hosts", "desktop", "preload.js"), "utf8");
    /* 按 onBound **函数体**切片，不用全文正则：文件里还有一处
       unbind 分支也在广播同一个事件，全文判会把摘掉那一处的变异撑绿
       —— 第一版就是这么写出假绿的（BM-20b 当场抓住）。 */
    const onBoundBody = (() => {
      const i = mainJs.indexOf("onBound: async");
      if (i < 0) return "";
      const j = mainJs.indexOf("function channelStatusList", i);
      return j > i ? mainJs.slice(i, j) : mainJs.slice(i, i + 2000);
    })();
    const links = {
      "主进程 onBound 写盘": /upsertDesktopEnvLocal\(patch/.test(onBoundBody),
      "主进程广播": /broadcast\("bitbot:channel-bound"/.test(onBoundBody),
      "preload 暴露 onChannelBound": /onChannelBound:\s*\(cb\)/.test(preloadJs) &&
        /ipcRenderer\.on\("bitbot:channel-bound"/.test(preloadJs),
      "渲染层订阅并翻状态": /onChannelBound\(\(\)\s*=>/.test(html) && /bmBoundDone/.test(html),
    };
    const missing = Object.keys(links).filter((k) => !links[k]);
    if (missing.length) bad("BM-20", "回执链缺环节（手机会显示成功，桌面不会变）", { missing });
    else ok("BM-20", "回执链四环齐备：onBound 写盘 → 广播 → preload → 渲染层翻「已关联」（静态断言，非端到端）");

    /* 负向对照：摘掉 onBound 里那一次广播，这条必须转红。 */
    const brokeBody = onBoundBody.replace(/broadcast\("bitbot:channel-bound"/, "noop(");
    if (/broadcast\("bitbot:channel-bound"/.test(brokeBody)) bad("BM-20b", "负向对照失效：摘掉广播后仍判为有");
    else ok("BM-20b", "负向对照：摘掉 onBound 里那次广播，判据立刻转红（判据不是恒真）");
  }

  console.log("prove_bot_manager: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 门禁自身异常：" + ((e && e.stack) || e));
  console.log("prove_bot_manager: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(1);
});
