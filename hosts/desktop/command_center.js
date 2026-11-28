/* B-8 团队指挥台 (原 index.html 尾部 <script>).
 * 从 28657 行的单文件里搬出来：它是自包含 IIFE，只通过 window.BitBotCmd
 * 与主脚本通信，所以换成经典 <script src> 后作用域与加载顺序都不变。
 * 改这里请同步跑 scripts/e2e_grok_desktop_boot.mjs（GP-128/129 指挥台）。 */
  (function () {
    "use strict";

    /* ── 任务是从转录**重建**出来的,不是另一份数据 ──
       群转录里已经落着三类事实行:
         · bot_reply / bot_reply_error —— 某个成员真的跑了一轮
         · confirm_request              —— 停下来了,等人回答
         · final_report                 —— 这一批收口了(含产物与分段)
       ⇒ 指挥台 = 这些行的聚合视图。**不新增数据源** ⇒ 不会与真相分叉。
     * 诚实的边界:批 3 之后 bot_reply 也带 task_sig ⇒ 分组精确到批次;
       批次边界由 final_report / confirm_request 划定。界面里如实标注。 */
    var CMD_BUCKETS = [
      { key: "needs_you", i18n: "cmdNeedsYou", sec: "cmdNeedsYou" },
      { key: "working", i18n: "cmdWorking", sec: "cmdRunningTitle" },
      { key: "waiting", i18n: "cmdWaiting", sec: "cmdWaiting" },
      { key: "closed", i18n: "cmdClosed", sec: "cmdClosed" },
    ];

    /* P1 批 1:桶从「只计数」变成**可点的 tab** ⇒ 渲染层多一个状态:当前选中哪个桶。
       默认落在「在跑」—— 一级信息(要你拍板)由 #cmd-active 单独占首屏,
       二级信息(正在跑的事)才轮到 tab。 */
    var CMD_STATE = { tasks: [], selected: null, note: "", duty: {}, records: [],
      /* 默认桶：**「在跑」**（批次 11 想过改成 needs_you ⇒ 又撤回）。
         像素门 TA-06 结尾「回到默认桶(在跑)」就钉住了这个默认。
         「在跑常常是空的」是真的 —— 但那是**数据状态**，不是 UI 该替用户决定的；
         解决办法是空态说人话（见 cmdEmptyFor），不是偷偷换默认视图。 */
      tab: "working", activeExpanded: false,
      /* 【批次 12】指挥台的作用域 = **你当前所在的那个会话**。
         kind: "room"（在群里）/ "dm"（在跟某个 Bot 单聊）/ "none"（没有会话）。
         ⇒ 换群就换一套成员、换一批任务 —— 这是「不同群指挥台成员不一样」的落点。 */
      scope: { kind: "none", id: "", title: "", memberIds: [] },
      /* 当前作用域里的团队成员（含职责与当前状态）。 */
      members: [],
      /* 其它群的「要你拍板」计数 —— 只做提醒，不做第二套仪表盘。 */
      otherRooms: [], otherExpanded: false, orphanNeeds: 0 };

    function cmdEsc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function cmdT(key) {
      try {
        if (typeof wavegT === "function") return wavegT(key);
      } catch (e) { /* 字典还没就绪 */ }
      return key;
    }
    /* 带参数的取词(如「还有 {n} 件」)。cmdT 不带参数,带参数的是全局 t(key, params)。
       **不在顶层调用** —— 顶层求值期调 t() 会撞 TDZ(字典在文件后半段才初始化),
       这里只在**渲染时**调,天然安全。 */
    function cmdTp(key, params) {
      try {
        if (typeof t === "function") return t(key, params);
      } catch (e) { /* 字典还没就绪 */ }
      return key;
    }

    /* P1 批 3：聚合逻辑**搬走了** —— 唯一一份在 hosts/shared/task_view.js。
       桌面指挥台与手机的 GET /v1/tasks 必须算出**同一批**任务
       （方案 docs/design/p1-task-axis-and-mobile-command.md §3.2.2「聚合逻辑只留一份」）。
       这里**只做委派，不保留第二份实现** ——
       门禁 scripts/prove_task_view_http.mjs 盯着「index.html 里不再出现
       aggregateCommandTasks / cmdMergeTaskRecords 的**本地函数定义**」。
       依赖清单（搬之前逐个查过）：原来这两个函数在渲染层里只依赖**彼此**
       与 JS 内建（Array/String/Number/localeCompare）——
       不碰 t() / cmdT() / CMD_STATE / DOM / window.bitbot ⇒ 搬走不丢任何东西。 */
    var aggregateCommandTasks = function (rooms, taskRecords) {
      if (!window.__bitbotTaskView || typeof window.__bitbotTaskView.aggregate !== "function") {
        // 聚合只有那一份。加载不上就是**装坏了** —— 不许悄悄回一份空清单
        // （空清单 = 界面显示「还没有任务」= 骗用户）。
        throw new Error("task_view_unavailable: hosts/shared/task_view.js 没加载上");
      }
      return window.__bitbotTaskView.aggregate(rooms, taskRecords);
    };

    /** 每个成员的步骤明细:谁跑了、成没成、说了什么、错在哪。 */
    function cmdRenderSteps(steps, taskSig, roomId) {
      if (!Array.isArray(steps) || !steps.length) return "";
      /* 【批次 15】步骤上的名字也走统一标签（同一个人在哪都是同一个名字）。 */
      var labels = CMD_STATE.memberLabels || {};
      var html = '<div class="cmd-steps">';
      for (var i = 0; i < steps.length; i++) {
        var st = steps[i] || {};
        var mark = st.ok ? "✓" : "✗";
        var body = st.ok
          ? String(st.text || "").replace(/\s+/g, " ").trim().slice(0, 120)
          : String(st.error || "").slice(0, 120);
        var stepLabel = String(st.bot_id || "") ? String(labels[st.bot_id] || st.name || "") : String(st.name || "");
        html += '<div class="cmd-step' + (st.ok ? "" : " cmd-step-bad") + '" data-cmd-step="' + cmdEsc(st.name || "") + '">' +
          '<span class="cmd-step-mark">' + mark + "</span>" +
          '<span class="cmd-step-name">' + cmdEsc(stepLabel) + "</span>" +
          '<span class="cmd-step-text">' + cmdEsc(body) + "</span>" +
          // 「换人」:读**同一张任务卡的输入框**当新人选 ⇒ 一步到位,不用中间弹窗。
          (taskSig && st.bot_id
            ? '<button type="button" class="bb-btn bb-btn-xs" data-cmd-swap="' + cmdEsc(st.bot_id) +
              '" data-cmd-swap-task="' + cmdEsc(taskSig) + '" data-cmd-swap-room="' + cmdEsc(roomId || "") +
                            '" data-i18n="cmdSwap">' + cmdEsc(cmdT("cmdSwap")) + "</button>"
            : "") +
          "</div>";
      }
      return html + "</div>";
    }

    /**
     * 值班区(B-8 批 H):今天该跑什么、上次跑没跑。
     * 数据来自各群的 routines(routines.list)—— **不另造一份排班**。
     * P1 批 1:值班是「未来的事」⇒ 降级成面板末尾的**折叠区**(D-6),
     * 行仍然写进 #cmd-duty-list;折叠区标题与计数在 <summary> 上。
     */
    function cmdRenderDuty(byRoom) {
      var host = document.getElementById("cmd-duty-list");
      if (!host) return;
      var rows = [];
      var scD = CMD_STATE.scope || { kind: "none" };
      for (var roomId in byRoom) {
        if (!Object.prototype.hasOwnProperty.call(byRoom, roomId)) continue;
        /* 【批次 12】值班只显示**当前群**的排班（值班本来就是逐房的）。 */
        if (scD.kind === "room" && String(roomId) !== scD.id) continue;
        var list = byRoom[roomId] || [];
        for (var i = 0; i < list.length; i++) {
          var r = list[i] || {};
          if (r.archived === true) continue;
          rows.push({ room_id: roomId, r: r });
        }
      }
      var cnt = document.getElementById("cmd-duty-count");
      if (cnt) cnt.textContent = String(rows.length);
      if (!rows.length) {
        host.innerHTML = '<div class="frame-box" data-i18n="cmdDutyEmpty">' + cmdEsc(cmdT("cmdDutyEmpty")) + "</div>";
        return;
      }
      var html = "";
      for (var j = 0; j < rows.length; j++) {
        var row = rows[j];
        var r2 = row.r;
        var meta = "";
        if (r2.next_due_label) meta = cmdT("cmdDutyNext") + " " + r2.next_due_label;
        else if (r2.once_done && r2.last_fired_label) meta = cmdT("cmdDutyDone") + " " + r2.last_fired_label;
        else if (r2.once_done) meta = cmdT("cmdDutyDone") + " " + cmdT("cmdDutyUnknownTime");
        else meta = cmdT("cmdDutyNever");
        html += '<div class="frame-box cmd-duty-row">' +
          '<div class="cmd-line">' + cmdEsc(String(r2.prompt || r2.id || "").slice(0, 120)) + "</div>" +
          '<div class="cmd-sub">' + cmdEsc(meta) +
          (r2.enabled === false ? " · " + cmdT("cmdDutyOff") : "") +
          (r2.cron ? " · " + cmdEsc(r2.cron) : "") + "</div></div>";
      }
      host.innerHTML = html;
    }

    /**
     * 已完区(P1 批 1,原「复盘区」):做完了什么。
     * 数据来自 Task 实体(state=done)—— 不编,只列真的收过口的批次。
     * 复盘 = 已完 = **同一份 Task 实体** ⇒ 原 #cmd-review 容器与 cmdRenderReview
     * 已删(D-7),行仍然叫 .cmd-review-row(门禁按 class 找,不改名)。
     */
    /** 毫秒 → 人话（复盘用）。1.2s / 850ms / 2m05s。 */
    function cmdFmtDur(ms) {
      var v = Number(ms || 0);
      if (!(v > 0)) return "";
      if (v < 1000) return Math.round(v) + "ms";
      if (v < 60000) return (v / 1000).toFixed(1) + "s";
      var m = Math.floor(v / 60000);
      var sec = Math.floor((v % 60000) / 1000);
      return m + "m" + (sec < 10 ? "0" : "") + sec + "s";
    }

    function cmdRenderDone(records) {
      var host = document.getElementById("cmd-done-list");
      if (!host) return;
      var sc = CMD_STATE.scope || { kind: "none" };
      var list = (Array.isArray(records) ? records : []).filter(function (x) {
        if (!x || x.state !== "done") return false;
        /* 【批次 12】只显示**当前作用域**的已完任务。
           以前是全量（真数据上「已完 54」全挤在这个折叠区里）⇒ 又是跨群混排。 */
        if (sc.kind !== "room") return true;
        return String(x.room_id || "") === sc.id;
      });
      var cnt = document.getElementById("cmd-done-count");
      if (cnt) cnt.textContent = String(list.length);
      if (!list.length) {
        host.innerHTML = '<div class="frame-box" data-i18n="cmdReviewEmpty">' + cmdEsc(cmdT("cmdReviewEmpty")) + "</div>";
        return;
      }
      list.sort(function (a, b) {
        return String(b.closed_at || b.updated_at || "").localeCompare(String(a.closed_at || a.updated_at || ""));
      });
      var html = "";
      for (var i = 0; i < list.length; i++) {
        var rec = list[i] || {};
        var when = String(rec.closed_at || rec.updated_at || "");
        /* 复盘三件套（批次 2）：整轮用时 / 返工次数 / 验收通过数 ——
           数据来自 Task 实体里那几份字段（唯一真源），没有就**不显示**，
           绝不编一个「0 次返工」出来。 */
        var sub = cmdEsc(when) +
          (rec.total ? " · " + cmdEsc(String(rec.returned || 0) + "/" + String(rec.total)) : "") +
          (rec.partial ? " · " + cmdT("cmdPartial") : "");
        if (rec.duration_ms) {
          sub += " · " + cmdT("cmdDuration") + " " + cmdEsc(cmdFmtDur(rec.duration_ms));
        }
        if (Number(rec.rework_count || 0) > 0) {
          sub += " · " + cmdT("cmdRework") + " " + cmdEsc(String(rec.rework_count)) + " " + cmdT("cmdTimes");
        }
        var stg = Array.isArray(rec.stages) ? rec.stages : [];
        if (stg.length) {
          var passed = 0;
          for (var si = 0; si < stg.length; si++) if (stg[si] && stg[si].pass) passed++;
          sub += " · " + cmdT("cmdStagePass") + " " + cmdEsc(String(passed) + "/" + String(stg.length));
        }
        /* 每棒一行：谁做的、多久、过没过（不过的带原因）。
           数据来自实体里的 stages[] —— 看不到的那一段就**不画**，不编。 */
        var stageLine = "";
        if (stg.length) {
          var bits = [];
          for (var k = 0; k < stg.length; k++) {
            var x = stg[k] || {};
            var nm = String(x.name || x.bot_id || "").slice(0, 20);
            if (!nm) continue;
            var mark = x.pass === true ? "✓" : "✗";
            var dur = x.duration_ms ? " " + cmdFmtDur(x.duration_ms) : "";
            var why = x.pass === true ? "" : "（" + String(x.reason || "").slice(0, 60) + "）";
            bits.push(nm + " " + mark + dur + why);
          }
          if (bits.length) stageLine = '<div class="cmd-sub">' + cmdEsc(bits.join(" · ")) + "</div>";
        }
        html += '<div class="frame-box cmd-review-row">' +
          '<div class="cmd-line">' + cmdEsc(String(rec.title || rec.task || rec.id || "").slice(0, 120)) + "</div>" +
          '<div class="cmd-sub">' + sub + "</div>" + stageLine + "</div>";
      }
      host.innerHTML = html;
    }

    /** 桶的中文/英文标签(状态徽标用)。取不到就返回空串,不编。 */
    function cmdBucketLabel(bucket) {
      for (var i = 0; i < CMD_BUCKETS.length; i++) {
        if (CMD_BUCKETS[i].key === bucket) return cmdT(CMD_BUCKETS[i].i18n);
      }
      return "";
    }

    /**
     * 一张任务卡(P1 批 1 D-8..D-13)。
     * 数据仍然来自同一份聚合结果 —— **不新增数据源**。
     * 四个动作(插话/改向/刹停/换人)的属性与语义一个字没动(D-11/D-12);
     * 变的只是外壳:卡片根从 div.frame-box 变成 article.cmd-card,
     * 标题走类型阶 class(去掉行内 font-weight),多一个状态徽标。
     */
    /* 【批次 13】指挥动作的线性图标（和全局图标同一套语言：
       24 视窗、stroke 1.8、无填充）。 */
    var CMD_ICON_STEER =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.9-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/></svg>';
    var CMD_ICON_REPLAN =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

    /** 【批次 15】能换给谁：当前群里的成员（去掉自己），显示名用统一标签。
     *  用户点「换人」却不知道该填什么名字 —— 这份名单就是答案。 */
    function cmdSwapCandidates(excludeId) {
      var ms = Array.isArray(CMD_STATE.members) ? CMD_STATE.members : [];
      var out = [];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i] || {};
        if (String(m.id || "") === String(excludeId || "")) continue;
        out.push(String(m.label || m.name || m.id || ""));
      }
      return out;
    }

    /** 任务卡的「谁」：用**带 id 的引用**查统一标签表。
     *  【批次 15】原来只 join 名字 ⇒ 两个同名 bot 会印成「助手、助手」，
     *  用户根本看不出是两个人。⇒ 现在按 id 查标签 ⇒ 「助手 · 销售、助手 · 支持」。 */
    function cmdTaskWho(t) {
      var labels = CMD_STATE.memberLabels || {};
      var refs = Array.isArray(t.member_refs) ? t.member_refs : [];
      if (refs.length) {
        var names = [];
        for (var i = 0; i < refs.length; i++) {
          var r = refs[i] || {};
          var id = String(r.id || "");
          var lb = id ? String(labels[id] || "") : "";
          names.push(lb || String(r.name || id));
        }
        return names.join("、");
      }
      var ms = Array.isArray(t.members) ? t.members : [];
      return ms.join("、");
    }

    function cmdCardHtml(task) {
      var t = task;
      var title = t.task_title || t.task || (t.steps[0] && t.steps[0].text) || t.room_title || "";
      var who = cmdTaskWho(t);
      /* 【批次 11 修 bug】line 原来先看 t.needs_you，没有就无条件写「在跑」。
         但 bucket=needs_you 有**两条来源**：state=waiting（显式等用户）或 needs_you 非空。
         前一种 needs_you 是 null ⇒ 卡片顶上贴着「需要你拍板」，下面却写着「在跑」——
         自相矛盾，用户会以为这活儿还轮不到自己 ⇒ **按 bucket 判**，不再按字段猜。 */
      var line = "";
      var showLine = true;
      if (t.bucket === "needs_you") {
        if (t.needs_you && t.needs_you.question) {
          line = cmdT("cmdNeedsYou") + "：" + t.needs_you.question;
        } else {
          /* 顶上已经有「需要你拍板」的状态徽标了 ⇒ 这里再写一遍就是重复。
             没有具体问题时**不写这一行**（留着空白更糟）。 */
          line = "";
          showLine = false;
        }
      } else if (t.bucket === "closed") {
        line = cmdT("cmdClosed") + " " + t.returned + "/" + t.total;
      } else if (t.bucket === "waiting") {
        line = cmdT("cmdWaiting");
      } else {
        line = cmdT("cmdWorking");
      }
      /* 批次 11：卡片重排 —— 标题一行，meta 一行（状态 · 群 · 成员），
         下面才是「要你拍板的问题 / 进度」。
         以前标题、状态标签、成员、群名各占一行 ⇒ 一张卡五行才说完事，
         一屏放不下几件 ⇒ 跟整个界面的密度对不上。 */
      var when = "";
      try {
        var at = Date.parse(t.at || "");
        if (isFinite(at)) when = mcRelTime(new Date(at).toISOString());
      } catch (e) { when = ""; }
      return '<article class="cmd-card" data-cmd-task="' + cmdEsc(t.task_sig || t.at) +
        '" data-bucket="' + cmdEsc(t.bucket || "") +
        '" data-task-sig="' + cmdEsc(t.task_sig || "") + '">' +
        '<div class="cmd-card-head">' +
        '<h4 class="cmd-card-title">' + cmdEsc(String(title).slice(0, 120)) + "</h4>" +
        '<span class="cmd-state" data-cmd-state="' + cmdEsc(t.bucket || "") + '">' +
        cmdEsc(cmdBucketLabel(t.bucket)) + "</span>" +
        /* 「打开群」放在标题行右端：跟状态徽标并排 ⇒ 不占额外行高，
           也不会把 meta 行挤到换行（meta 行本来要放群 · 成员 · 时间）。 */
        '<button type="button" class="bb-btn bb-btn-sm cmd-card-open" data-cmd-open-room="' +
          cmdEsc(t.room_id) + '" data-i18n="cmdOpenRoom">' + cmdEsc(cmdT("cmdOpenRoom")) + "</button>" +
        "</div>" +
        '<div class="cmd-card-meta">' +
        '<span class="cmd-card-room">' + cmdEsc(t.room_title || t.room_id) + "</span>" +
        '<span class="cmd-card-who">' + cmdEsc(who ? who : cmdT("cmdMembers")) + "</span>" +
        (t.archived ? ' <span class="cmd-tag" data-i18n="cmdArchived">' + cmdEsc(cmdT("cmdArchived")) + "</span>" : "") +
        (when ? '<span class="cmd-card-when">' + cmdEsc(when) + "</span>" : "") +
        "</div>" +
        (showLine ? '<div class="cmd-line">' + cmdEsc(line) + "</div>" : "") +
        // 批 1 让成员真并行 ⇒ 用户必须看得见**谁干了什么**,
        // 否则并行只会变成"一堆 bot 同时动但说不清"。
        cmdRenderSteps(t.steps, t.task_sig, t.room_id) +
        // 指挥区:一句输入,两个动作 —— 插话(下一棒看见) / 改向(立刻重跑)。
        //
        // 【口径(2026-11-22)】**按钮只在点了能成的时候才渲染**。
        // 这不是新规矩,是把「刹停」的先例补齐到插话/改向上:
        //   · 刹停早就这么做了 —— `t.bucket === "working" && t.task_sig` 才给按钮
        //     (下面那段),理由写在注释里:「没有在跑的,按下去只会得到一句 no_running_task」。
        //   · 服务端同一把尺:can.steer / can.replan = !!task_sig
        //     (scripts/prove_task_view_http.mjs TV-15);没有 sig 时命令接口回 task_sig_required。
        //   · 而输入框只被插话/改向用(它取的是 [data-cmd-steer]/[data-cmd-replan] 上的 sig),
        //     所以没有 sig 时,连输入框一起不渲染 —— 留一个填了也发不出去的口子更糟。
        // ⇒ 桌面与服务端从此是同一把尺,不再出现「按钮在、点了必失败」。
        (t.task_sig
          ? '<div class="cmd-command">' +
              '<input class="cmd-input" type="text" data-i18n-placeholder="cmdCmdPlaceholder" placeholder="' +
                cmdEsc(cmdT("cmdCmdPlaceholder")) + '">' +
              /* 【批次 13】动作按钮改成**框内图标**（参考图那个输入区：
                 左边输入、右边图标动作）。
                 文字不能删 —— 无障碍与 copy contract 都要它 ⇒
                 可见文字换成 SVG，可见性靠 sr-only 保留在 DOM 里。 */
              '<button type="button" class="bb-btn bb-btn-sm cmd-act" data-cmd-steer="' + cmdEsc(t.task_sig) +
                '" data-cmd-room="' + cmdEsc(t.room_id) + '" data-i18n-title="cmdSteer" data-i18n-aria="cmdSteer" ' +
                'aria-label="' + cmdEsc(cmdT("cmdSteer")) + '">' + CMD_ICON_STEER +
                '<span class="cmd-sr" data-i18n="cmdSteer">' + cmdEsc(cmdT("cmdSteer")) + "</span></button>" +
              '<button type="button" class="bb-btn bb-btn-sm cmd-act" data-cmd-replan="' + cmdEsc(t.task_sig) +
                '" data-cmd-room="' + cmdEsc(t.room_id) + '" data-i18n-title="cmdReplan" data-i18n-aria="cmdReplan" ' +
                'aria-label="' + cmdEsc(cmdT("cmdReplan")) + '">' + CMD_ICON_REPLAN +
                '<span class="cmd-sr" data-i18n="cmdReplan">' + cmdEsc(cmdT("cmdReplan")) + "</span></button>" +
              // 插话的诚实边界常驻小字(product_surface.js:2756 scope:"next_hop"):
              // 下一棒看得见,**当前这一轮看不见** —— 不许让用户以为插话能打断这一轮。
              '<span class="cmd-note cmd-steer-hint" data-i18n="cmdSteerScopeHint">' + cmdEsc(cmdT("cmdSteerScopeHint")) + "</span>" +
            "</div>"
          : "") +
        /* 「刹停」只在**真在跑**且有 task_sig 时才给 —— 没有在跑的,
           按下去只会得到一句 "no_running_task",不如不给。
           （「打开群」已并进 meta 行 ⇒ 这里没有其它按钮时不留空行。） */
        (t.bucket === "working" && t.task_sig
          ? '<div class="cmd-actions">' +
            '<button type="button" class="bb-btn bb-btn-sm bb-btn-danger-soft" data-cmd-cancel="' +
                        cmdEsc(t.task_sig) + '" data-cmd-room="' + cmdEsc(t.room_id) + '" data-i18n="cmdCancel">' + cmdEsc(cmdT("cmdCancel")) + "</button>" +
            "</div>"
          : "") +
        "</article>";
    }

    /**
     * tab 标签的 data-i18n 属性 —— **写字面量,不拼**。
     * copy contract CC-05 扫的是源码里 data-i18n 属性的取值;拼出来的键名它看不见
     * ⇒ 拼 = 哪天漏了词条也不会有人发现(界面直接显示键名)。
     */
    function cmdTabAttr(bucket) {
      if (bucket === "needs_you") return 'data-i18n="cmdNeedsYou"';
      if (bucket === "working") return 'data-i18n="cmdWorking"';
      if (bucket === "waiting") return 'data-i18n="cmdWaiting"';
      if (bucket === "closed") return 'data-i18n="cmdClosed"';
      return "";
    }

    /**
     * 四个状态桶 → **可点的 tab**(P1 批 1 D-2)。
     * 以前这里只画四个数字,用户点不动、数字与列表之间没有映射;
     * 现在每个桶一个 button,点一下就只看那个桶的卡。
     */
    function cmdRenderBuckets() {
      var host = document.getElementById("cmd-buckets");
      if (!host) return;
      var html = "";
      for (var i = 0; i < CMD_BUCKETS.length; i++) {
        var b = CMD_BUCKETS[i];
        var n = 0;
        for (var j = 0; j < CMD_STATE.tasks.length; j++) {
          if (CMD_STATE.tasks[j].bucket === b.key) n += 1;
        }
        var on = CMD_STATE.tab === b.key;
        html += '<button type="button" class="cmd-tab' + (on ? " cmd-tab-on" : "") + '" data-cmd-tab="' +
          b.key + '" role="tab" aria-selected="' + (on ? "true" : "false") + '">' +
          // 标签文本渲染时取词(cmdT),同时挂 data-i18n ⇒ 换语言时扫描也覆盖得到。
          '<span class="cmd-tab-label" ' + cmdTabAttr(b.key) + '>' + cmdEsc(cmdT(b.i18n)) + "</span>" +
          '<span class="cmd-tab-count">' + n + "</span></button>";
      }
      host.innerHTML = html;
    }

    /**
     * 按桶分栏的列表(P1 批 1 D-4):每个桶一个 section,
     * 只有 tab 选中的那个可见(其余 hidden,但**仍在 DOM 里** ——
     * 门禁读 #cmd-detail 的 textContent,读的是真实内容而不是"当前这一屏")。
     */
    function cmdRenderList() {
      var host = document.getElementById("cmd-detail");
      if (!host) return;
      /* 【批次 12】整会话空态：这个团队**一件任务都没有**。
         分桶空态是「这个桶没东西」，整会话空态是「这个团队还没开工」——
         两件事对用户意义不同 ⇒ 分开说。
         （CP-5 门禁钉的就是整会话空态的那句「还没有任务」。） */
      var scopeEmpty = document.getElementById("cmd-scope-empty");
      if (scopeEmpty) {
        var noTasks = !CMD_STATE.tasks.length;
        scopeEmpty.hidden = !noTasks;
        if (noTasks) scopeEmpty.textContent = cmdT("cmdEmptyScope");
      }
      // 提示**不替换**列表 —— 以前 note 一有值就整个 return,
      // 用户看到的是"我的任务全没了",只留一句报错。列表必须在。
      var html = "";
      if (CMD_STATE.note) {
        html += '<div class="frame-box cmd-note-box">' + cmdEsc(CMD_STATE.note) + "</div>";
      }
      if (!CMD_STATE.tasks.length) {
        host.innerHTML = html + '<div class="frame-box" data-i18n="cmdEmpty">' + cmdEsc(cmdT("cmdEmpty")) + "</div>";
        return;
      }
      var byBucket = {};
      for (var i = 0; i < CMD_BUCKETS.length; i++) byBucket[CMD_BUCKETS[i].key] = [];
      for (var j = 0; j < CMD_STATE.tasks.length; j++) {
        var task = CMD_STATE.tasks[j];
        var key = task.bucket || "waiting";
        if (!byBucket[key]) byBucket[key] = [];
        byBucket[key].push(task);
      }
      for (var k = 0; k < CMD_BUCKETS.length; k++) {
        var b = CMD_BUCKETS[k];
        var list = byBucket[b.key] || [];
        var on = b.key === CMD_STATE.tab;
        /* 【撤回】批次 11 曾经把 needs_you 桶分区藏掉（说"一级区已经渲染过了"）——
           那**破坏了桶 tab 的语义**：点「需要你拍板」时对应分区必须亮着
           （像素门 TA-06 就是钉这一条）。一级区和桶分区**都留着**，
           同一张卡出现两处是已知残留（TA-16 如实记着，不假装它是设计）。 */
        html += '<section class="cmd-section" data-bucket="' + b.key + '"' + (on ? "" : " hidden") + ">" +
          '<h4 class="cmd-sec-title">' + cmdEsc(cmdT(b.sec)) + "</h4>" +
          '<div class="cmd-list">';
        if (!list.length) {
          /* 空态**按桶说人话**：「没有在跑的任务」≠「你没有任务」。
             以前所有空桶都写同一句「还没有任务」⇒ 在「在跑」桶看到这句，
             用户会以为整个团队没干活（其实有 18 件在等他拍板）。 */
          /* data-i18n 必须写**字面量**（copy contract CC-05 扫源码里的字面量，
             拼出来的键名它看不见 ⇒ 哪天漏了词条也没人发现）。
             ⇒ 四个桶各写各的字面量，不拼。 */
          if (b.key === "working") {
            html += '<div class="frame-box cmd-empty" data-i18n="cmdEmptyWorking">' + cmdEsc(cmdT("cmdEmptyWorking")) + "</div>";
          } else if (b.key === "waiting") {
            html += '<div class="frame-box cmd-empty" data-i18n="cmdEmptyWaiting">' + cmdEsc(cmdT("cmdEmptyWaiting")) + "</div>";
          } else if (b.key === "needs_you") {
            html += '<div class="frame-box cmd-empty" data-i18n="cmdEmptyNeedsYou">' + cmdEsc(cmdT("cmdEmptyNeedsYou")) + "</div>";
          } else {
            html += '<div class="frame-box cmd-empty" data-i18n="cmdEmptyClosed">' + cmdEsc(cmdT("cmdEmptyClosed")) + "</div>";
          }
        } else {
          for (var m = 0; m < list.length; m++) html += cmdCardHtml(list[m]);
        }
        html += "</div></section>";
      }
      host.innerHTML = html;
    }

    /**
     * 一级信息(P1 批 1 D-3):**要你拍板**的那件事。
     * 面板打开后的第一屏就是它;没有待办时整块隐藏(不占屏),
     * 首屏直接是四个 tab。最多 3 条 + 「还有 N 件」。
     */
    function cmdRenderActive() {
      var sec = document.getElementById("cmd-active");
      var list = document.getElementById("cmd-active-list");
      if (!sec || !list) return;
      var more = document.getElementById("cmd-active-more");
      var needs = [];
      for (var i = 0; i < CMD_STATE.tasks.length; i++) {
        if (CMD_STATE.tasks[i].bucket === "needs_you") needs.push(CMD_STATE.tasks[i]);
      }
      if (!needs.length) {
        sec.hidden = true;
        list.innerHTML = "";
        if (more) { more.hidden = true; more.textContent = ""; }
        return;
      }
      sec.hidden = false;
      /* 批次 11：「还有 N 件」以前是**纯文本** ⇒ 用户只能看到前 3 条，
         要看全量得去按桶分栏那边找（还要先选中对应的桶）。
         ⇒ 现在它是一个按钮：点了就在这儿展开全量。
         （不新增数据源 —— 还是同一份 CMD_STATE.tasks，只是多渲染几张卡。） */
      var expanded = !!CMD_STATE.activeExpanded;
      var shown = (!expanded && needs.length > 3) ? needs.slice(0, 3) : needs;
      var html = "";
      for (var j = 0; j < shown.length; j++) html += cmdCardHtml(shown[j]);
      list.innerHTML = html;
      if (more) {
        var rest = needs.length - shown.length;
        if (rest > 0) {
          more.hidden = false;
          more.innerHTML = '<button type="button" class="cmd-link-btn" data-cmd-expand="1" data-i18n="cmdMoreCount">' +
            cmdEsc(cmdTp("cmdMoreCount", { n: String(rest) })) + "</button>";
        } else if (expanded && needs.length > 3) {
          /* 展开后变成「收起」—— 否则点开就回不去。 */
          more.hidden = false;
          more.innerHTML = '<button type="button" class="cmd-link-btn" data-cmd-collapse="1" data-i18n="cmdCollapse">' +
            cmdEsc(cmdT("cmdCollapse")) + "</button>";
        } else {
          more.hidden = true;
          more.textContent = "";
        }
      }
    }

    function cmdRender() {
      /* 【批次 12】渲染顺序改了：
           跨群提醒 → 团队成员（人）→ 桶 tab → 一级「要你拍板」→ 按桶分栏 →
           「已完成」折叠 → 「值班」折叠。
         为什么成员排在任务前面：指挥台的**用途**是「看清这个团队谁在干什么、
         哪些卡在等我，然后指挥他们」⇒ 人是主语，任务是宾语。
         以前只有任务没有成员 ⇒ 用户根本不知道该指挥谁。 */
      cmdRenderScopeTitle();
      cmdRenderOtherRooms();
      cmdRenderMembers();
      cmdRenderBuckets();
      cmdRenderActive();
      cmdRenderList();
      cmdRenderDone(CMD_STATE.records || []);
      cmdRenderDuty(CMD_STATE.duty || {});
    }

    /** 顶栏标题：**谁的指挥台**（批次 12）。 */
    function cmdRenderScopeTitle() {
      try {
        var titleEl = document.getElementById("cmd-top-title");
        if (!titleEl) return;
        var sc = CMD_STATE.scope || { kind: "none" };
        if (sc.kind === "none") {
          titleEl.textContent = cmdT("cmdTitle");
          return;
        }
        titleEl.textContent = cmdTp("cmdTitleOf", { r: String(sc.title || sc.id) });
      } catch (e) { /* 标题拿不到就不改 */ }
    }

    /** 跨群提醒条（批次 12）：别的群有要你拍板的事 ⇒ 顶上一条细条。
        只提醒，不做第二套仪表盘 ⇒ 点了直接切到那个群。 */
    function cmdRenderOtherRooms() {
      var host = document.getElementById("cmd-other-rooms");
      if (!host) return;
      var others = CMD_STATE.otherRooms || [];
      if (!others.length) { host.hidden = true; host.innerHTML = ""; return; }
      var total = 0;
      for (var i = 0; i < others.length; i++) total += Number(others[i].n || 0);

      /* 【批次 12 修】以前这一条把**所有**别的群一个不漏地列出来（真数据上就是 10 个）⇒
         一条提醒吃掉半屏，把成员区和任务区全挤下去。
         而且很多列出来的是 room-xxx 这种**已删群的历史残留**（任务还在、群没了）⇒
         根本没有群名可显示。
         ⇒ 现在：默认只说**总数**（「另有 N 件事在别的群等你拍板」），
           展开后最多列 3 个；群名取不到就写「未命名群」，不把内部 id 甩给用户。 */
      var expanded = !!CMD_STATE.otherExpanded;
      var html = '<div class="cmd-other-row">';
      html += '<span class="cmd-other-text">' + cmdEsc(cmdTp("cmdOtherRooms", { n: String(total) })) + "</span>";
      var shown = expanded ? others.slice(0, 3) : [];
      for (var j = 0; j < shown.length; j++) {
        var nm = String(shown[j].title || "").trim();
        if (!nm || nm === shown[j].id) nm = cmdT("cmdUnnamedRoom");
        html += '<button type="button" class="cmd-other-chip" data-cmd-goto-room="' + cmdEsc(shown[j].id) + '" ' +
          'data-i18n-title="cmdGoToRoom">' + cmdEsc(nm) + " · " + Number(shown[j].n || 0) + "</button>";
      }
      if (others.length > shown.length) {
        html += '<span class="cmd-other-more">+ ' + (others.length - shown.length) + "</span>";
      }
      /* data-i18n 必须写**字面量**（copy contract CC-05 扫源码里的字面量，
         拼出来的键名它看不见 ⇒ 哪天漏了词条也没人发现）。
         ⇒ 展开/收起两个分支各写各的字面量。 */
      html += expanded
        ? '<button type="button" class="cmd-link-btn" data-cmd-toggle-other="1" data-i18n="cmdCollapse">' + cmdEsc(cmdT("cmdCollapse")) + "</button>"
        : '<button type="button" class="cmd-link-btn" data-cmd-toggle-other="1" data-i18n="cmdExpand">' + cmdEsc(cmdT("cmdExpand")) + "</button>";
      html += "</div>";
      host.innerHTML = html;
      host.hidden = false;
    }

    /** 成员区：这个团队的**人**（批次 12）。
        每人：名字 + 职责 + 当前状态（在跑 / 等你拍板 / 空闲）。 */
    function cmdRenderMembers() {
      var sec = document.getElementById("cmd-members");
      var list = document.getElementById("cmd-members-list");
      var count = document.getElementById("cmd-members-count");
      if (!sec || !list) return;
      var ms = CMD_STATE.members || [];
      if (!ms.length) {
        sec.hidden = true;
        list.innerHTML = "";
        if (count) count.textContent = "";
        return;
      }
      sec.hidden = false;
      if (count) count.textContent = String(ms.length);
      var html = "";
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        var st = m.status || "idle";
        html += '<div class="cmd-member" data-cmd-member="' + cmdEsc(m.id) + '" data-cmd-member-status="' + cmdEsc(st) + '">';
        html += '<span class="cmd-member-av" aria-hidden="true">' + cmdEsc(String(m.name || "?").slice(0, 1)) + "</span>";
        html += '<span class="cmd-member-main">';
        /* 【批次 15】显示名用统一标签（同名 ⇒ 带消歧后缀），不是裸名字。 */
        html += '<span class="cmd-member-name">' + cmdEsc(m.label || m.name) + "</span>";
        if (m.job) html += '<span class="cmd-member-job">' + cmdEsc(m.job) + "</span>";
        html += "</span>";
        html += '<span class="cmd-member-state" data-cmd-state="' + cmdEsc(st) + '">' +
          cmdEsc(cmdT(st === "working" ? "cmdMemberWorking" : st === "needs_you" ? "cmdMemberNeedsYou" : "cmdMemberIdle")) +
          "</span>";
        html += "</div>";
      }
      list.innerHTML = html;
    }

    async function cmdRefresh() {
      var api = window.bitbot && window.bitbot.rooms && window.bitbot.rooms.list;
      if (typeof api !== "function") {
        CMD_STATE.tasks = [];
        CMD_STATE.note = cmdT("cmdUnavailable");
        cmdRender();
        return;
      }
      try {
        var res = await api();
        var rooms = (res && res.rooms && res.rooms.rooms) || res.rooms || [];
        // Task 实体(批 4):跨会话的任务状态。拿不到就照旧只用转录,
        // **不因此报错** —— 老数据没有 tasks.json 是正常的。
        var records = [];
        try {
          var tApi = window.bitbot && window.bitbot.tasks && window.bitbot.tasks.list;
          if (typeof tApi === "function") {
            var tres = await tApi();
            records = (tres && tres.tasks) || [];
          }
        } catch (_) { records = []; }
        var allTasks = aggregateCommandTasks(rooms, records);
        CMD_STATE.note = "";

        /* 【批次 12】定作用域：**你当前所在的那个会话**。
           群 ⇒ composerRoom（跟聊天输入框瞄准的是同一个群）；
           单聊 ⇒ activeBotId（你正在跟哪个 Bot 说话）。
           ⇒ 指挥台服务于这个团队，而不是所有群混在一起。 */
        var scope = { kind: "none", id: "", title: "", memberIds: [] };
        try {
          if (composerRoom && composerRoom.id) {
            var rm = null;
            for (var ri2 = 0; ri2 < rooms.length; ri2++) {
              if (rooms[ri2] && rooms[ri2].id === composerRoom.id) { rm = rooms[ri2]; break; }
            }
            scope = {
              kind: "room",
              id: composerRoom.id,
              title: String((rm && rm.title) || composerRoom.title || composerRoom.id),
              memberIds: Array.isArray(rm && rm.members) ? rm.members.slice() : [],
            };
          }
          /* 【批次 12】**没有在群里**（还在单聊、或还没进任何群）⇒ **不收窄**。
             为什么不在单聊里收窄到那个 Bot：指挥台是**团队**的指挥台 ——
             单聊里没有「被指挥的团队」⇒ 硬收窄只会得到一个空面板（实测：
             门禁环境没进群，面板直接空了 ⇒ 「还没有任务」）。
             ⇒ 没进群时它退回「全局概览」，并照常提醒别处的待办。 */
        } catch (_) { scope = { kind: "none", id: "", title: "", memberIds: [] }; }
        CMD_STATE.scope = scope;

        /* 只保留**这个作用域**的任务。别的群的事不混进来。
           （没进群 ⇒ 保留全部，此时它就是全局概览。） */
        CMD_STATE.tasks = scope.kind === "room"
          ? allTasks.filter(function (t) {
              return t && String(t.room_id || "") === scope.id;
            })
          : allTasks;

        /* 真实存在的群 id 集合（批次 12）。
           **必须定义在使用它之前** —— 上一版定义在后面 ⇒ var 提升但值为 undefined
           ⇒ 取属性抛错 ⇒ 被外层 catch 吞掉 ⇒ 整个刷新静默失败
           （症状：成员区空、作用域没设对，而页面不报任何错）。 */
        var liveRoomIds = {};
        for (var lri = 0; lri < rooms.length; lri++) {
          if (rooms[lri] && rooms[lri].id) liveRoomIds[String(rooms[lri].id)] = 1;
        }

        /* 侧栏角标：**全局**提醒（所有群要你拍板的总和）——
           它是「别忘了那边也在等你」，所以必须是全局的；
           而面板内部是当前作用域 ⇒ 两者语义不同、位置不同。 */
        cmdUpdateBadge(allTasks.filter(function (t) {
          /* 角标是「点了就能处理」的数字 ⇒ 已删群的不算（那个群根本进不去）。 */
          var rid = String((t && t.room_id) || "");
          return !rid || liveRoomIds[rid];
        }));

        /* 其它群的要你拍板（只提醒，不做第二套仪表盘）。
         *
         * 【批次 12 修】只提醒**真实存在**的群。
         * 为什么：tasks.json 里留着**已删群**的历史任务（真数据上 72 条里有 60+ 条
         * 属于 room-xxx 这种已经不存在的群）⇒ 之前这一条把它们一个个列出来，
         * 而用户**点不过去**（群没了）⇒ 纯误导，还吃掉半屏。
         * ⇒ 只统计 rooms 里还在的群。 */
        var other = [];
        var seenOther = {};
        var orphanNeeds = 0;
        for (var oi = 0; oi < allTasks.length; oi++) {
          var ot = allTasks[oi];
          if (!ot || ot.bucket !== "needs_you") continue;
          var oid = String(ot.room_id || "");
          if (!oid || oid === scope.id) continue;
          if (!liveRoomIds[oid]) { orphanNeeds += 1; continue; }
          if (!seenOther[oid]) {
            seenOther[oid] = { id: oid, title: String(ot.room_title || ""), n: 0 };
            other.push(seenOther[oid]);
          }
          seenOther[oid].n += 1;
        }
        CMD_STATE.otherRooms = other;
        CMD_STATE.orphanNeeds = orphanNeeds;

        /* 成员区：这个团队的**人** + 职责 + 当前状态。
           状态从**已有的任务数据**推（不新增数据源）：
             在跑     = 出现在 working 桶任务里的成员
             等你拍板 = 出现在 needs_you 桶任务里的成员
             空闲     = 群成员里其余的 */
        var memberIds = scope.kind === "room" ? scope.memberIds.slice() : [];
        var byId = {};
        for (var mi = 0; mi < memberIds.length; mi++) byId[memberIds[mi]] = null;
        try {
          var bApi2 = window.bitbot && window.bitbot.bots && window.bitbot.bots.list;
          if (typeof bApi2 === "function") {
            var bv2 = await bApi2();
            var bl2 = (bv2 && (bv2.bots || bv2.views || bv2)) || [];
            if (Array.isArray(bl2)) {
              for (var bj = 0; bj < bl2.length; bj++) {
                if (bl2[bj] && byId[bl2[bj].id] !== undefined) byId[bl2[bj].id] = bl2[bj];
              }
            }
          }
        } catch (_) { /* 读不到成员资料就只显示 id，不编造 */ }
        /* 【批次 15 · 真 bug】原来这里拿 **名字**做键（workingNames[名字]），
           下面查的却是 **id**（workingNames[mid]）⇒ 名字≠id 时永远查不到
           ⇒ **「在跑」状态从来算不出来**（截图里只有「等你拍板」是因为
           那条走的是 confirm_request.candidates，用的是 id）。
           ⇒ 现在统一用 **id** 作键：优先 member_refs（批次 15 给 task 补的
           带 id 引用），老数据没有就退到 steps[].bot_id（步骤层一直带着 id）。 */
        var workingIds = {};
        var needIds = {};
        for (var ti = 0; ti < CMD_STATE.tasks.length; ti++) {
          var tt = CMD_STATE.tasks[ti];
          if (!tt) continue;
          var msIds = [];
          try {
            var refs = Array.isArray(tt.member_refs) ? tt.member_refs : [];
            for (var ri = 0; ri < refs.length; ri++) {
              var rid = String((refs[ri] || {}).id || "");
              if (rid) msIds.push(rid);
            }
            if (!msIds.length) {
              var stp = Array.isArray(tt.steps) ? tt.steps : [];
              for (var si = 0; si < stp.length; si++) {
                var sid = String((stp[si] || {}).bot_id || "");
                if (sid) msIds.push(sid);
              }
            }
          } catch (_) { /* 取不到就当没人参与 */ }
          if (tt.bucket === "working") {
            for (var wi = 0; wi < msIds.length; wi++) workingIds[msIds[wi]] = 1;
          } else if (tt.bucket === "needs_you") {
            for (var ni = 0; ni < msIds.length; ni++) needIds[msIds[ni]] = 1;
            /* 等你拍板的人**不一定在 members 里** ——
               confirm_request 把候选人放在 needs_you.candidates（要用户点名谁来做），
               那个人才是真正卡住的人 ⇒ 也要算成「等你拍板」。 */
            try {
              var cands = (tt.needs_you && tt.needs_you.candidates) || [];
              if (Array.isArray(cands)) {
                for (var ci = 0; ci < cands.length; ci++) {
                  var cd = cands[ci] || {};
                  var cid = String(cd.id || cd.name || "");
                  if (cid) needIds[cid] = 1;
                }
              }
            } catch (_) { /* 没有候选就按成员算 */ }
          }
        }
        /* 成员区的显示名：作用域 = **当前群的成员**（同一群里同名 ⇒ 消歧）。 */
        var ident15 = window.__botIdentity || {};
        var peerBots15 = [];
        for (var pi = 0; pi < memberIds.length; pi++) {
          var pid = String(memberIds[pi] || "");
          if (!pid) continue;
          var pinfo = byId[pid] || {};
          peerBots15.push({
            id: pid,
            name: String(pinfo.name || pid),
            job: String(pinfo.job || ""),
            group: String(pinfo.group || ""),
          });
        }
        var labelMap15 = (typeof ident15.labelMap === "function") ? ident15.labelMap(peerBots15) : {};
        var members = [];
        for (var mk = 0; mk < memberIds.length; mk++) {
          var mid = String(memberIds[mk] || "");
          if (!mid) continue;
          var info = byId[mid] || {};
          var status = workingIds[mid] ? "working" : (needIds[mid] ? "needs_you" : "idle");
          members.push({
            id: mid,
            name: String(info.name || mid),
            /* 显示名：统一标签算出来的（含消歧后缀）。 */
            label: labelMap15[mid] || String(info.name || mid),
            job: String(info.job || info.description || ""),
            status: status,
          });
        }
        CMD_STATE.members = members;
        /* 任务卡与步骤行也查**同一张表** ⇒ 同一个 bot 在任何地方都是同一个名字。 */
        CMD_STATE.memberLabels = labelMap15;

        /* 顶栏副标题：**说清楚这是谁的指挥台**（批次 12）。
           以前写「10 个群 · 72 件事」⇒ 跨群混排，用户不知道在看谁；
           现在写当前团队的范围（成员数 · 任务数 · 等你拍板数）。 */
        try {
          var sub = document.getElementById("cmd-top-sub");
          if (sub) {
            var needN = 0;
            for (var q = 0; q < CMD_STATE.tasks.length; q++) {
              if (CMD_STATE.tasks[q] && CMD_STATE.tasks[q].bucket === "needs_you") needN += 1;
            }
            if (scope.kind === "room") {
              sub.textContent = cmdTp("cmdScope", {
                r: members.length,
                t: CMD_STATE.tasks.length,
                n: needN,
              });
            } else {
              /* 全局概览：说清是「几个群」而不是「几位成员」—— 一个数字都不许含糊。 */
              var roomN2 = 0, seen2 = {};
              for (var z = 0; z < CMD_STATE.tasks.length; z++) {
                var zr = String((CMD_STATE.tasks[z] && CMD_STATE.tasks[z].room_id) || "");
                if (zr && !seen2[zr]) { seen2[zr] = 1; roomN2 += 1; }
              }
              sub.textContent = cmdTp("cmdScopeAll", {
                r: roomN2,
                t: CMD_STATE.tasks.length,
                n: needN,
              });
            }
          }
        } catch (e) { /* 副标题拿不到就不写 */ }

        // 值班(批 H):逐房读排班。读不到就当没有 —— **不编排班**。
        var dutyByRoom = {};
        try {
          var rApi = window.bitbot && window.bitbot.routines && window.bitbot.routines.list;
          if (typeof rApi === "function") {
            for (var ri = 0; ri < rooms.length; ri++) {
              var rid2 = String((rooms[ri] && rooms[ri].id) || "");
              if (!rid2) continue;
              try {
                var rres = await rApi({ roomId: rid2 });
                if (rres && rres.ok !== false && Array.isArray(rres.routines)) {
                  dutyByRoom[rid2] = rres.routines;
                }
              } catch (_) { /* 这个房读不到就跳过,别的房照常 */ }
            }
          }
        } catch (_) { dutyByRoom = {}; }
        CMD_STATE.duty = dutyByRoom;
        CMD_STATE.records = records;
      } catch (e) {
        CMD_STATE.tasks = [];
        CMD_STATE.note = String((e && e.message) || e);
      }
      cmdRender();
    }

    /* ===== 批次 14：域导航栏 ==============================================
     * 这一栏只回答「我在哪 / 我要去哪」。四个域都有**真实去处** ——
     * 没有去处的不放进来（不加「不知道干嘛」的功能）。
     *
     *   对话   → 回到聊天（默认视图）
     *   指挥   → 团队指挥台
     *   自动化 → 当前群的定时任务（没有群 ⇒ 禁用并说清原因）
     *   设置   → 设置面板
     *
     * 注意：这三个函数必须和 cmdOpen/cmdClose **在同一个作用域** ——
     * index.html 里有嵌套的 IIFE，函数声明只在**本作用域**提升。
     * （第一版把它放在 openRoomChat 附近 ⇒ cmdOpen is not defined ⇒
     *   而且那个大 try/catch 把异常吞了 ⇒ 点「指挥」毫无反应却看不出错。）
     * ⇒ 指挥台一律走 window.__bitbotCommand（那边是公开入口）。 */
    var APP_RAIL_DOMAINS = ["chat", "command", "automation", "settings"];

    /** 自动化域能不能去：定时任务是**逐群**的（群资料面板那一段）⇒ 没群就没得看。 */
    function appRailAutomationReady() {
      var ctx = window.__appRailCtx;
      var rm = ctx && typeof ctx.room === "function" ? ctx.room() : null;
      return !!(rm && rm.id);
    }

    function appRailRender() {
      var rail = document.getElementById("app-rail");
      if (!rail) return;
      if (!rail.getAttribute("data-app-domain")) rail.setAttribute("data-app-domain", "chat");
      var cur = String(rail.getAttribute("data-app-domain") || "chat");
      var autoReady = appRailAutomationReady();
      var items = rail.querySelectorAll(".app-rail-item");
      for (var i = 0; i < items.length; i++) {
        var b = items[i];
        var d = String(b.getAttribute("data-app-domain") || "");
        if (d === cur) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
        if (d === "automation") {
          b.disabled = !autoReady;
          var k = autoReady ? "appAutoTitle" : "appAutoNeedRoom";
          b.setAttribute("data-i18n-title", k);
          try { b.setAttribute("title", wavegT(k)); } catch (e) { b.setAttribute("title", ""); }
        }
      }
    }

    /** 切域。每个域各自处理 —— **不共用一个大 try/catch**：
     *  一个域打不开不该把其它域也拖下水，更不该把错误吞成「点了没反应」。 */
    function appRailGo(domain) {
      var rail = document.getElementById("app-rail");
      if (!rail) return;
      var d = String(domain || "chat");
      if (d === "automation" && !appRailAutomationReady()) return;
      rail.setAttribute("data-app-domain", d);
      try { document.body.setAttribute("data-app-domain", d); } catch (e) { /* ignore */ }
      appRailRender();
      if (d === "command") {
        var cmd = window.__bitbotCommand;
        if (cmd && typeof cmd.open === "function") cmd.open();
      } else if (d === "automation") {
        /* 【批次 15】切去别的域 ⇒ **先把指挥台收起来**。
           指挥台是聊天区上的一个视图，和「群资料/排程」同时开着 = 两个视图叠着。
           keepDomain=true：面板收掉，但当前域留在用户点的这一个上。 */
        var cmdOff = window.__bitbotCommand;
        if (cmdOff && typeof cmdOff.close === "function") cmdOff.close(true);
        var ctx = window.__appRailCtx;
        if (ctx && typeof ctx.setRoomRailTab === "function") ctx.setRoomRailTab("routines");
        if (ctx && typeof ctx.openRoomRail === "function") ctx.openRoomRail();
      } else if (d === "settings") {
        var cmdOff2 = window.__bitbotCommand;
        if (cmdOff2 && typeof cmdOff2.close === "function") cmdOff2.close(true);
        var ctx2 = window.__appRailCtx;
        if (ctx2 && typeof ctx2.runUserTurn === "function") {
          ctx2.runUserTurn("open settings", { skipSession: true, silentUser: true });
        }
      } else {
        var cmd2 = window.__bitbotCommand;
        if (cmd2 && typeof cmd2.close === "function") cmd2.close();
      }
    }

    /** 域导航栏的点击绑定（批次 14）。 */
    function appRailBind() {
      var rail = document.getElementById("app-rail");
      if (!rail) return;
      rail.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var btn = t.closest(".app-rail-item");
        if (!btn || btn.disabled) return;
        appRailGo(btn.getAttribute("data-app-domain") || "chat");
      });
      appRailRender();
    }

    /* 指挥台视图的开关（批次 11）。
     *
     * 缘起：指挥台以前是 #main 里的一个 flex 项 ⇒ 开着的时候，聊天流被挤到
     * 零高度、而**聊天输入框还挂在底下** ⇒ 一个任务视图长在聊天区里，
     * 顶栏还写着聊天对象「Bit Bot」⇒ 跟整体完全不搭。
     *
     * ⇒ 现在指挥台**和聊天互斥**：开它 ⇒ 顶栏换成指挥台自己的标识、
     *   聊天输入框让位；关它 ⇒ 一切回到聊天。
     *   （body.cmd-view 是这两个状态的唯一开关，不另起数据源、不另写状态机。）
     */
    function cmdSetView(on) {
      try { document.body.classList.toggle("cmd-view", !!on); } catch (e) { /* 老浏览器没有 classList 就当没这层 */ }
    }

    /** 侧栏入口的角标：现在有多少件**要你拍板**（用户不用点进去才知道有事）。 */
    function cmdUpdateBadge(tasks) {
      var badge = document.getElementById("cmd-nav-badge");
      if (!badge) return;
      var n = 0;
      try {
        /* 按 bucket 判，不按 t.needs_you 判 ——
           bucket 才是聚合算好的四桶（needs_you/working/waiting/closed），
           和卡片上的标签、统计数字必须是**同一把尺**。 */
        n = (tasks || []).filter(function (t) { return t && t.bucket === "needs_you"; }).length;
      } catch (e) { n = 0; }
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.hidden = n <= 0;
    }

    /* 【批次 15】指挥台的显隐 ↔ 域导航栏的当前域，**必须同步**。
       两件事：
         1) 指挥台开着 ⇒ 域导航栏要指向「指挥」—— 否则用户停在「对话」域里
            看到一个属于「指挥」域的面板（而且两个域同时标着选中态）。
         2) 关掉指挥台 ⇒ 回到「对话」域（指挥台是聊天区上的**另一个视图**）。
       keepDomain = true 时不抢域（切去别的域时用：先把指挥台收起来，
       但当前域要留在用户点的那一个上）。 */
    function cmdSyncRailDomain(domain) {
      try {
        var rail = document.getElementById("app-rail");
        if (!rail) return;
        rail.setAttribute("data-app-domain", domain);
        document.body.setAttribute("data-app-domain", domain);
        var api = window.__bitbotCommand;
        if (api && typeof api.appRailRender === "function") api.appRailRender();
      } catch (_) { /* ignore */ }
    }

    async function cmdOpen() {
      // P1 批 1 D-1:面板的显隐走 **hidden 属性**(不再写行内 style.display)
      // —— ui_chrome.css 里 [hidden]{display:none!important} 是既有兜底(T-1b)。
      var el = document.getElementById("command-panel");
      if (el) el.hidden = false;
      /* 【批次 15】展开态记在**域导航栏的「指挥」**上（侧栏那个入口已删）。 */
      var btn = document.getElementById("app-rail-command");
      if (btn) btn.setAttribute("aria-expanded", "true");
      cmdSetView(true);
      cmdSyncRailDomain("command");
      await cmdRefresh();
    }

    function cmdClose(keepDomain) {
      var el = document.getElementById("command-panel");
      if (el) el.hidden = true;
      var btn = document.getElementById("app-rail-command");
      if (btn) btn.setAttribute("aria-expanded", "false");
      cmdSetView(false);
      /* 面板关了 ⇒ 回到「对话」域；除非是「切去别的域」顺手收面板（keepDomain）。 */
      if (!keepDomain) cmdSyncRailDomain("chat");
    }

    document.addEventListener("DOMContentLoaded", function () {
      /* 批次 14：域导航栏先绑上（它决定当前在哪个域）。
         走 window.__bitbotCommand —— appRailBind 与本 handler 虽在同一作用域，
         但用公开入口更稳；catch 里**留一句说明**，别再静默吞错。 */
      try {
        var railApi = window.__bitbotCommand;
        if (railApi && typeof railApi.appRailBind === "function") railApi.appRailBind();
      } catch (e) {
        console.error("[app-rail] 绑定失败", e);
      }
      /* 【批次 15】侧栏那颗「指挥台」按钮已删 ⇒ 它的点击绑定也删。
         进指挥台的入口只剩**域导航栏的「指挥」**（appRailBind 里那一条）。 */
      var close = document.getElementById("cmd-panel-close");
      if (close) close.addEventListener("click", function () { cmdClose(); });
      var refresh = document.getElementById("cmd-refresh-btn");
      if (refresh) refresh.addEventListener("click", function () { cmdRefresh(); });
      /* 批次 12：这里变成 async —— 「点其它群 ⇒ 切过去」要 await 房间列表。 */
      document.addEventListener("click", async function (ev) {
        var t = ev.target;
        if (!t || !t.getAttribute) return;
        // P1 批 1 D-2:桶 tab —— 点一下就切到那个桶,只看那个桶的卡。
        // P1 批 2 修:tab 按钮里包着两个 span(.cmd-tab-label / .cmd-tab-count),
        // **点文字时 ev.target 是那个 span**,不是按钮 ⇒ 以前只认
        // t.getAttribute("data-cmd-tab") ⇒ 点「在跑」两个字没反应、
        // 点按钮的空白处才切(批 2 的像素门真点 tab 时当场抓到)。
        // ⇒ 改成 closest() 往上找那个带 data-cmd-tab 的按钮。
        /* 批次 11：「还有 N 件」/「收起」。
           以前「还有 N 件」是纯文本 ⇒ 看不到全量只能去下面按桶分栏找。
           ⇒ 现在点了就展开/收起（全量仍来自同一份 CMD_STATE.tasks）。 */
        /* 批次 12：点「其它群」⇒ 切到那个群。指挥台随即跟着换内容
           （因为它的作用域就是当前会话）。 */
        var gotoEl = t.closest ? t.closest("[data-cmd-goto-room]") : null;
        if (gotoEl) {
          var gotoId = gotoEl.getAttribute("data-cmd-goto-room");
          if (gotoId && typeof openRoomChat === "function") {
            var roomsNow = [];
            try {
              var lres = await window.bitbot.rooms.list();
              var lp = (lres && lres.rooms) || {};
              roomsNow = Array.isArray(lp) ? lp : lp.rooms || [];
            } catch (_) { roomsNow = []; }
            for (var gi = 0; gi < roomsNow.length; gi++) {
              if (roomsNow[gi] && roomsNow[gi].id === gotoId) {
                openRoomChat(roomsNow[gi]);
                break;
              }
            }
            await cmdRefresh();
          }
          return;
        }
        if (t.closest && t.closest("[data-cmd-toggle-other]")) {
          CMD_STATE.otherExpanded = !CMD_STATE.otherExpanded;
          cmdRender();
          return;
        }
        if (t.closest && t.closest("[data-cmd-expand]")) {
          CMD_STATE.activeExpanded = true;
          cmdRender();
          return;
        }
        if (t.closest && t.closest("[data-cmd-collapse]")) {
          CMD_STATE.activeExpanded = false;
          cmdRender();
          return;
        }
        var tabEl = t.closest ? t.closest("[data-cmd-tab]") : null;
        var tabKey = tabEl ? tabEl.getAttribute("data-cmd-tab") : (t.getAttribute("data-cmd-tab") || null);
        if (tabKey) {
          CMD_STATE.tab = tabKey;
          cmdRender();
          return;
        }
        var swapBot = t.getAttribute("data-cmd-swap");
        if (swapBot) {
          var swapCard = t.closest ? t.closest("[data-cmd-task]") : null;
          var swapInp = swapCard ? swapCard.querySelector(".cmd-input") : null;
          var swapVal = swapInp ? String(swapInp.value || "").trim() : "";
          /* 【批次 15】空输入点「换人」⇒ 如实告诉用户**能换给谁**。
             以前只说一句「先说点什么」，用户根本不知道该填什么名字。
             候选用**统一标签**（同名的人带消歧后缀）。 */
          if (!swapVal) {
            var cands = cmdSwapCandidates(swapBot);
            CMD_STATE.note = cands.length
              ? cmdT("cmdSwapWho") + "：" + cands.join("、")
              : cmdT("cmdCmdEmpty");
            cmdRender();
            return;
          }
          var apiW = window.bitbot && window.bitbot.rooms && window.bitbot.rooms.reassignTask;
          if (typeof apiW !== "function") return;
          apiW({
            task_sig: t.getAttribute("data-cmd-swap-task") || "",
            room_id: t.getAttribute("data-cmd-swap-room") || "",
            from_bot: swapBot,
            to_bot: swapVal,
          }).then(function (r) {
            /* 【批次 15】同名歧义：Host 现在**不替用户猜**了 ⇒ 前端要把
               「有几个、叫什么、可以用哪些 id」讲清楚，不是一句 error code。 */
            if (r && r.ok) {
              CMD_STATE.note = cmdT("cmdSwapped");
            } else if (r && r.error === "ambiguous_bot") {
              var ids = ((r.candidates || []).map(function (c) { return String((c || {}).id || ""); })).filter(Boolean).join("、");
              CMD_STATE.note = cmdTp("cmdSwapAmbiguous", { n: String(r.count || (r.candidates || []).length || 2), name: String(r.bot || swapVal), ids: ids });
            } else {
              CMD_STATE.note = cmdT("cmdSwapFailed") + ":" + String((r && r.error) || "unknown");
            }
            cmdRender();
          }).catch(function (e) {
            CMD_STATE.note = cmdT("cmdSwapFailed") + ":" + String((e && e.message) || e);
            cmdRender();
          });
          return;
        }
        var steerSig = t.getAttribute("data-cmd-steer");
        var replanSig = t.getAttribute("data-cmd-replan");
        if (steerSig || replanSig) {
          var card = t.closest ? t.closest("[data-cmd-task]") : null;
          var inp = card ? card.querySelector(".cmd-input") : null;
          var val = inp ? String(inp.value || "").trim() : "";
          if (!val) { CMD_STATE.note = cmdT("cmdCmdEmpty"); cmdRender(); return; }
          var sig = steerSig || replanSig;
          var roomId2 = t.getAttribute("data-cmd-room") || "";
          if (steerSig) {
            var apiS = window.bitbot && window.bitbot.rooms && window.bitbot.rooms.steerTask;
            if (typeof apiS !== "function") return;
            apiS({ task_sig: sig, room_id: roomId2, text: val }).then(function (r) {
              CMD_STATE.note = r && r.ok ? cmdT("cmdSteered") : cmdT("cmdCmdFailed") + ":" + String((r && r.error) || "unknown");
              cmdRender();
            }).catch(function (e) {
              CMD_STATE.note = cmdT("cmdCmdFailed") + ":" + String((e && e.message) || e);
              cmdRender();
            });
            return;
          }
          var apiR = window.bitbot && window.bitbot.rooms && window.bitbot.rooms.replanTask;
          if (typeof apiR !== "function") return;
          apiR({ task_sig: sig, room_id: roomId2, task: val }).then(function (r) {
            CMD_STATE.note = r && r.ok ? cmdT("cmdReplanned") : cmdT("cmdCmdFailed") + ":" + String((r && r.error) || "unknown");
            cmdRender();
          }).catch(function (e) {
            CMD_STATE.note = cmdT("cmdCmdFailed") + ":" + String((e && e.message) || e);
            cmdRender();
          });
          return;
        }
        var cancelSig = t.getAttribute("data-cmd-cancel");
        if (cancelSig) {
          var api = window.bitbot && window.bitbot.rooms && window.bitbot.rooms.cancelTask;
          if (typeof api !== "function") return;
          api({
            task_sig: cancelSig,
            room_id: t.getAttribute("data-cmd-room") || "",
            reason: "user_stop",
          }).then(function (r) {
            CMD_STATE.note = r && r.ok
              ? cmdT("cmdStopped")
              : cmdT("cmdStopFailed") + ":" + String((r && r.error) || "unknown");
            cmdRender();
          }).catch(function (e) {
            CMD_STATE.note = cmdT("cmdStopFailed") + ":" + String((e && e.message) || e);
            cmdRender();
          });
          return;
        }
        var rid = t.getAttribute("data-cmd-open-room");
        if (!rid) return;
        if (typeof openRoomChat === "function") {
          var rooms = [];
          try {
            var api = window.bitbot && window.bitbot.rooms && window.bitbot.rooms.list;
            if (typeof api === "function") {
              api().then(function (res) {
                var rs = (res && res.rooms && res.rooms.rooms) || res.rooms || [];
                for (var i = 0; i < rs.length; i++) if (rs[i] && rs[i].id === rid) openRoomChat(rs[i]);
              });
              return;
            }
          } catch (e) { /* 拿不到就如实不跳 */ }
        }
      });
    });

    window.__bitbotCommand = {
      aggregate: aggregateCommandTasks,
      open: cmdOpen, close: cmdClose, refresh: cmdRefresh,
      /* 【批次 12】指挥台绑定**当前会话** ⇒ 它需要一个「切到这个群」的入口。
         面板里的跨群提醒条会调它；门禁也靠它模拟「用户切了群」。
         （它做的是真事：openRoomChat + 刷新面板 ⇒ 不是为测试开后门。） */
      enterRoom: async function (roomId) {
        var rid = String(roomId || "").trim();
        if (!rid) return { ok: false, error: "empty_room_id" };
        var list = [];
        try {
          var lres = await window.bitbot.rooms.list();
          var lp = (lres && lres.rooms) || {};
          list = Array.isArray(lp) ? lp : lp.rooms || [];
        } catch (_) { list = []; }
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].id === rid) {
            /* 【批次 15】**await** openRoomChat —— 以前不 await ⇒ 它还在跑，
               下面那次刷新就先开始了（竞态），而且刷的是**旧作用域**。
               现在切群由 openRoomChat 自己负责刷新指挥台（作用域就是当前会话），
               这里**不再**额外刷一次 —— 免得把「切群不刷新」这个 bug 盖住
               （盖住了，门禁就永远抓不到它）。 */
            if (typeof openRoomChat === "function") await openRoomChat(list[i]);
            return { ok: true, room_id: rid, title: String(list[i].title || rid) };
          }
        }
        return { ok: false, error: "room_not_found", room_id: rid };
      },
      scope: function () { return CMD_STATE.scope; },
      /* 批次 14：域导航栏的入口（跨作用域 ⇒ 挂 window）。 */
      appRailGo: appRailGo,
      appRailRender: appRailRender,
      appRailBind: appRailBind,
      // P1 批 1 D-15:暴露 render —— 换语言时要把已渲染的面板重画,
      // 否则屏幕上会留着上一种语言(wavegLangApply 里那条注释记过这个病)。
      render: cmdRender,
      state: CMD_STATE, buckets: CMD_BUCKETS,
    };
  })();
