/*
 * task_view.js — P1 批 3:指挥台「任务视图」的**唯一一份**实现。
 *
 * 为什么单独一个文件(而不是继续住在渲染层里):
 *   方案 docs/design/p1-task-axis-and-mobile-command.md §3.2.2 定死了「聚合逻辑只留一份」。
 *   桌面指挥台要出清单,手机的 GET /v1/tasks 也要出清单 —— 两边必须是**同一批**任务,
 *   否则用户看到「桌面上在跑、手机上没有」这种分叉,而分叉一旦出现就没人知道该信谁。
 *
 * 一条红线(**不许平行数据源**):
 *   · Task 实体只有 data/desktop/tasks.json 一份(product_surface.js 的 loadTasks/listTasks);
 *   · 转录只有 data/desktop/rooms.json 一份(product_surface.js 的 roomsStoreStatus);
 *   · 聚合逻辑只有本文件这一份(index.html 的渲染层已改成委派,门禁盯着不许出现第二份)。
 *   本文件**不读盘、不写盘、不碰 Electron** —— 它只把「已经读出来的 rooms + task 记录」
 *   算成一张清单。读盘是调用方的事(Node 侧走 surface,浏览器侧走 IPC)。
 *
 * 形态:UMD(照抄 hosts/shared/client_core/reducer.js 的写法)——
 *   浏览器端 <script src="../shared/task_view.js">  ⇒ window.__bitbotTaskView
 *   Node 端   require("./task_view")               ⇒ module.exports
 *   两条路拿到的是**同一个对象** ⇒ 桌面与手机不可能算出两份不同的清单。
 *
 * 里面搬过来的两个函数是**原样搬**的(hosts/desktop/index.html 的 B-8 指挥台脚本块):
 *   cmdMergeTaskRecords / aggregateCommandTasks
 * 它们只依赖彼此 + JS 内建(Array/String/Number/localeCompare)⇒ 没有隐式闭包依赖,
 * 搬走不会丢任何东西。
 */
(function () {
"use strict";

/**
 * 把 Task 实体(B-8 批 4)合并进聚合结果。
 * 为什么需要它:转录只留**最后 200 条** ⇒ 长任务会被滚出视野;
 * Task 实体单独记着「这批是什么、什么状态」⇒ 跨会话还认得。
 * 规则:
 *   ① 状态**以 Task 实体为准**(它是显式的,不是从转录推的);
 *   ② Task 里有、聚合里没有的 ⇒ 补一张「仅记录」卡(转录已滚出)。
 */
function cmdMergeTaskRecords(tasks, records) {
  var list = Array.isArray(records) ? records : [];
  if (!list.length) return tasks;
  var byId = {};
  for (var i = 0; i < list.length; i++) {
    var r = list[i] || {};
    if (r.id) byId[r.id] = r;
  }
  for (var j = 0; j < tasks.length; j++) {
    var t = tasks[j];
    var rec = byId[t.task_sig];
    if (!rec) continue;
    t.persisted = true;
    if (rec.state) t.state = rec.state;
    if (rec.task && !t.task) t.task = rec.task;
    if (rec.title && !t.task_title) t.task_title = rec.title;
  }
  for (var k = 0; k < list.length; k++) {
    var rec2 = list[k] || {};
    if (!rec2.id) continue;
    var seen = false;
    for (var m = 0; m < tasks.length; m++) {
      if (tasks[m].task_sig === rec2.id) { seen = true; break; }
    }
    if (seen) continue;
    tasks.push({
      room_id: String(rec2.room_id || ""), room_title: "",
      steps: [], members: [], needs_you: null, report: null,
      deliverables: [], task: String(rec2.task || ""),
      task_title: String(rec2.title || rec2.task || ""),
      task_sig: rec2.id, partial: false,
      total: Number(rec2.total || 0), returned: Number(rec2.returned || 0),
      at: String(rec2.updated_at || ""), persisted: true, archived: true,
      state: String(rec2.state || ""),
    });
  }
  return tasks;
}

function aggregateCommandTasks(rooms, taskRecords) {
  var tasks = [];
  var list = Array.isArray(rooms) ? rooms : [];
  tasks = cmdMergeTaskRecords(tasks, taskRecords);
  for (var i = 0; i < list.length; i++) {
    var room = list[i] || {};
    var tr = Array.isArray(room.transcript) ? room.transcript : [];
    var cur = null;
    function fresh(row) {
      return {
        room_id: String((row && row.room_id) || room.id || ""),
        room_title: String(room.title || ""),
        steps: [], members: [], needs_you: null, report: null,
        deliverables: [], task: "", task_title: "", task_sig: "",
        partial: false, total: 0, returned: 0, at: "",
      };
    }
    for (var j = 0; j < tr.length; j++) {
      var row = tr[j];
      if (!row || !row.kind) continue;
      var k = row.kind;
      if (k === "bot_reply" || k === "bot_reply_error") {
        // 换了 task_sig ⇒ 那是**另一批**任务 ⇒ 收尾上一批,另起一组。
        // (批 3 之后 bot_reply 带 task_sig ⇒ 分组可以精确到批次,
        //  不用再靠"同一个群就算同一批"这种粗判。)
        var rsig = String(row.task_sig || "");
        if (cur && rsig && cur.task_sig && cur.task_sig !== rsig) cur = null;
        if (!cur) { cur = fresh(row); tasks.push(cur); }
        if (rsig) cur.task_sig = rsig;
        var nm = String(row.name || row.bot_id || row.speaker || "");
        cur.steps.push({
          name: nm,
          bot_id: String(row.bot_id || row.speaker || ""),
          ok: k === "bot_reply",
          text: String(row.text || ""),
          error: String(row.error || ""),
          at: String(row.at || ""),
        });
        if (nm && cur.members.indexOf(nm) < 0) cur.members.push(nm);
        if (!cur.at) cur.at = String(row.at || "");
        continue;
      }
      if (k === "confirm_request") {
        var csig = String(row.task_sig || "");
        if (cur && csig && cur.task_sig && cur.task_sig !== csig) cur = null;
        if (!cur) { cur = fresh(row); tasks.push(cur); }
        cur.needs_you = {
          question: String(row.question || ""),
          candidates: Array.isArray(row.candidates) ? row.candidates : [],
          at: String(row.at || ""),
        };
        cur.task = String(row.task || "");
        cur.task_sig = String(row.task_sig || "");
        cur.at = String(row.at || cur.at);
        continue;
      }
      if (k === "final_report") {
        var fsig = String(row.task_sig || "");
        if (cur && fsig && cur.task_sig && cur.task_sig !== fsig) cur = null;
        if (!cur) { cur = fresh(row); tasks.push(cur); }
        cur.report = row;
        cur.task = String(row.task || "");
        cur.task_title = String(row.task_title || "");
        cur.task_sig = String(row.task_sig || "");
        cur.responders = Array.isArray(row.responders) ? row.responders : [];
        cur.partial = row.partial === true;
        cur.total = Number(row.total || 0);
        cur.returned = Number(row.returned || 0);
        var arts = Array.isArray(row.artifacts) ? row.artifacts.slice() : [];
        if (row.deliverable) arts.push(row.deliverable);
        cur.deliverables = arts;
        cur.at = String(row.at || cur.at);
        cur = null;
      }
    }
  }
  for (var t = 0; t < tasks.length; t++) {
    var x = tasks[t];
    // Task 实体的状态**优先**于从转录推出来的 —— 它是显式写下的。
    var st = String(x.state || "");
    if (st === "done" || st === "cancelled") x.bucket = "closed";
    else if (st === "waiting") x.bucket = "needs_you";
    else if (st === "running") x.bucket = "working";
    else if (x.needs_you) x.bucket = "needs_you";
    else if (x.report) x.bucket = "closed";
    else if (x.steps.length) x.bucket = "working";
    else x.bucket = "waiting";
  }
  tasks.sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); });
  return tasks;
}

/* ---------------------------------------------------------------------------
 * 下面这些是 P1 批 3 新增的**投影**与**寻址契约**。
 * 它们不是第二份聚合 —— 聚合仍然只有上面那一个函数;这里只做
 *   「把一张聚合结果里的任务,投影成手机端要的那份 JSON」以及
 *   「task_sig 怎么在 URL 里寻址」(批 4 的四条路由直接用它,不许再抄一遍)。
 * ------------------------------------------------------------------------- */

/**
 * 一条聚合结果 → 手机端清单里的一项(方案 §3.2.1 写死的形状)。
 *
 * 字段口径(每一条都对着产品的既有规则来,不许端上自己猜):
 *   · title     —— 与桌面卡片标题**同一套**取值顺序(task_title → task → 首步文本 → 群名)。
 *   · bucket    —— 聚合里算好的四桶(needs_you / working / waiting / closed)。
 *   · state     —— Task 实体的状态;没有实体记录就是空串(**不编**一个状态出来)。
 *   · running   —— 「在跑」= 桶是 working。**不是**看 state:"running"
 *                   (Task 实体至今没有 running 态的写入方,见方案 R-12)。
 *   · can.*     —— 服务端算的能不能点,依据与桌面按钮**同一套**规则:
 *                   cancel 只在「桶=working 且有 task_sig」时给(桌面 index.html 同规则);
 *                   swap 只在**有成员的 bot_id** 时给(换人按钮挂在成员行上);
 *                   steer / replan 需要 task_sig(没有 sig 时 product_surface 会回
 *                   task_sig_required,与其给一个必然失败的动作,不如如实说不能)。
 */
function toTaskListItem(task, opts) {
  var t = task || {};
  var o = opts || {};
  var steps = Array.isArray(t.steps) ? t.steps : [];
  var members = Array.isArray(t.members) ? t.members : [];
  var bucket = String(t.bucket || "");
  var sig = String(t.task_sig || "");
  var firstText = steps.length ? String((steps[0] || {}).text || "") : "";
  var title = String(t.task_title || t.task || firstText || t.room_title || "");
  var hasBotId = false;
  for (var i = 0; i < steps.length; i++) {
    if (String((steps[i] || {}).bot_id || "")) { hasBotId = true; break; }
  }
  var needs = t.needs_you
    ? {
        question: String(t.needs_you.question || ""),
        candidates: Array.isArray(t.needs_you.candidates) ? t.needs_you.candidates : [],
        at: String(t.needs_you.at || ""),
      }
    : null;
  return {
    task_sig: sig,
    room_id: String(t.room_id || ""),
    room_title: String(t.room_title || ""),
    bucket: bucket,
    state: String(t.state || ""),
    title: title,
    task: String(t.task || ""),
    members: members.slice(),
    steps: steps.map(function (s) {
      var row = s || {};
      return {
        name: String(row.name || ""),
        bot_id: String(row.bot_id || ""),
        ok: row.ok === true,
        text: String(row.text || ""),
        error: String(row.error || ""),
        at: String(row.at || ""),
      };
    }),
    needs_you: needs,
    total: Number(t.total || 0),
    returned: Number(t.returned || 0),
    partial: t.partial === true,
    running: bucket === "working",
    at: String(t.at || ""),
    updated_at: String(o.updated_at || ""),
    can: {
      steer: Boolean(sig),
      replan: Boolean(sig),
      swap: hasBotId,
      cancel: bucket === "working" && Boolean(sig),
    },
  };
}

/* --- task_sig 的寻址契约(批 3 定死,批 4 的四条路由直接用) ----------------
 * task_sig 的形状是 `<room_id>|<message_id>`(data/desktop/tasks.json 实测),
 * 里面带 `|` ⇒ 放进 URL 路径段必须 encodeURIComponent。
 * 服务端取回来时 decodeURIComponent 还原 —— 与已有的 approvals 路由同一套写法
 * (cn_inbound_server.js 的 /v1/approvals/<id>/decide)。
 */
var TASK_SIG_ROUTE_RE = /^\/v1\/tasks\/([^/]+)\/(steer|replan|cancel|swap)$/;

/** task_sig → URL 路径段(客户端侧)。 */
function encodeTaskSig(sig) {
  return encodeURIComponent(String(sig == null ? "" : sig));
}

/** URL 路径段 → task_sig(服务端侧)。解不开就回空串,不抛。 */
function decodeTaskSig(segment) {
  try {
    return decodeURIComponent(String(segment == null ? "" : segment));
  } catch (_) {
    return "";
  }
}

/**
 * 路由匹配:`/v1/tasks/<encodeURIComponent(task_sig)>/<action>` → { sig, action }。
 * 没匹配上就是 null(**不猜**)。批 4 的四条路由用它,免得又抄一份正则。
 */
function matchTaskSigRoute(pathname) {
  var m = TASK_SIG_ROUTE_RE.exec(String(pathname || ""));
  if (!m) return null;
  return { sig: decodeTaskSig(m[1]), action: String(m[2] || "") };
}

const API = {
  mergeTaskRecords: cmdMergeTaskRecords,
  aggregate: aggregateCommandTasks,
  toTaskListItem: toTaskListItem,
  encodeTaskSig: encodeTaskSig,
  decodeTaskSig: decodeTaskSig,
  matchTaskSigRoute: matchTaskSigRoute,
};

/* Node 侧(cn_inbound_server.js require("./task_view"))。 */
if (typeof module !== "undefined" && module.exports) module.exports = API;
/* 浏览器侧(渲染层委派 window.__bitbotTaskView.aggregate)。 */
if (typeof globalThis !== "undefined") globalThis.__bitbotTaskView = API;
})();
