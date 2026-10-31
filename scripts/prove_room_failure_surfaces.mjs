#!/usr/bin/env node
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

/**
 * RF — room failure must be visible.
 *
 * 现象（用户报的真事）：群消息发出去了，界面上一条回复都没有，连一句报错都
 * 没有 —— 看起来就像「Bot 故意不理我」。真机上这是三件事叠在一起：
 *
 *   1. 群回合的 IPC 没有总时限。Host 那一侧一旦不返回，渲染层的 await 永远
 *      不落地：`finally` 不跑 → 不重绘转录、不出错误卡、发送键永久禁用。
 *   2. 发送键的禁用态写成了 `opacity: 1`，和可用态长得一模一样，所以「按钮
 *      已经废了」这件事在屏幕上根本看不出来。
 *   3. 删 Bot 会连带解散成员不足 2 人的群，但只回一个数字。用户回头发消息
 *      只得到「群不存在」，根本不知道群是自己刚才删人删掉的。
 *
 * 这个门禁把「失败必须出声」钉成合同：
 *   RF1  群回合超过总时限 → 必须**如实**返回超时，并往群里落一条汇报；
 *   RF2  删 Bot 连带解散群 → 返回值必须点名被解散的群；
 *   RF3  渲染层必须有一道客户端兜底闸，且重绘转录失败不能吃掉结果卡；
 *   RF4  发送键的禁用态必须看得见（不能是 opacity:1）。
 *
 * 用法：
 *   node scripts/prove_room_failure_surfaces.mjs
 *
 * 退出码 0 = 合同成立；非 0 = 已破。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let failures = 0;
function ok(id, msg) {
  console.log("ok " + id + " — " + msg);
}
function bad(id, msg) {
  console.log("FAIL " + id + " — " + msg);
  failures += 1;
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/* ---------- RF1: 群回合总时限 ---------- */
async function rf1() {
  const { dispatchRoomTurn } = require(path.join(ROOT, "hosts/shared/room_dispatch.js"));

  const appended = [];
  const surface = {
    roomTurn: () => ({
      ok: true,
      mode: "host_room_turn",
      transcript_entry: {
        kind: "user",
        room_id: "room-rf1",
        text: "hi",
        responders: ["bot-x"],
        responder_policy: "mentioned_only",
      },
      escalations: "dm-only",
    }),
    appendRoomTranscript: (_id, entry) => {
      appended.push(entry);
      return { ok: true };
    },
    // 永远不返回 —— 这正是真机上「消息发出去了没人回」的形状。
    orchestrateRoom: () => new Promise(() => {}),
  };

  const t0 = Date.now();
  let res = null;
  try {
    // 门禁自己也得有闸：没有时限闸的 dispatchRoomTurn 会**永远挂着**，
    // 那样门禁就不是「变红」，而是「卡住」—— 卡住的红不算红。
    res = await Promise.race([
      dispatchRoomTurn({
        surface,
        roomId: "room-rf1",
        text: "hi",
        messageId: "rf1-1",
        deadlineMs: 300,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("gate_timeout")), 5000),
      ),
    ]);
  } catch (e) {
    bad(
      "RF1",
      "dispatchRoomTurn 没有按时收口（挂死了）：" +
        (e && e.message ? e.message : e) +
        " —— 没有时限闸时，群回合真的会永远不返回",
    );
    return;
  }
  const waited = Date.now() - t0;

  if (res && res.ok === false && res.error === "room_turn_timeout") {
    ok("RF1", "超时的群回合如实报 room_turn_timeout（等了 " + waited + "ms，没有挂死）");
  } else {
    bad("RF1", "超时的群回合没有如实报错，回包是 " + JSON.stringify(res));
  }

  const report = appended.find((e) => e && e.kind === "final_report");
  if (report && report.error === "room_turn_timeout") {
    ok("RF1b", "超时也往群里落了一条 final_report（群里看得见这轮没跑完）");
  } else {
    bad("RF1b", "超时没有往群里落汇报，群里只会剩下用户那一句（看起来像没人理）");
  }

  if (waited < 3000) {
    ok("RF1c", "时限闸按配置生效，没有多等");
  } else {
    bad("RF1c", "时限闸没生效，等了 " + waited + "ms");
  }
}

/* ---------- RF2: 删 Bot 连带解散群要点名 ---------- */
function rf2() {
  const { createProductSurface } = require(path.join(ROOT, "hosts/desktop/product_surface.js"));
  const os = require("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rf2-"));
  try {
    const surface = createProductSurface(ROOT, { dataRoot: tmp });
    const a = surface.botsCreate({ name: "RFA", job: "a" }).bot.id;
    const b = surface.botsCreate({ name: "RFB", job: "b" }).bot.id;
    const room = surface.roomCreate(a + "," + b, "rf2-group");
    if (!room.ok) {
      bad("RF2", "建群失败：" + (room.error || "unknown"));
      return;
    }
    const del = surface.botsDelete(a, "yes");
    const dropped = (del && del.rooms_dropped) || [];
    const st = surface.roomsStoreStatus();
    const alive = ((st.rooms && st.rooms.rooms) || []).some((r) => r && r.id === room.room.id);
    if (!alive) {
      ok("RF2a", "成员不足 2 人的群确实被连带解散（GP-07 级联）");
    } else {
      bad("RF2a", "删了一个成员后群还在，级联行为与代码里的声明不一致");
    }
    if (dropped.length === 1 && String(dropped[0].title) === "rf2-group") {
      ok("RF2", "解散结果点名了被解散的群：" + dropped[0].title);
    } else {
      bad("RF2", "解散结果没有点名被解散的群：" + JSON.stringify(dropped));
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

/* ---------- RF3 / RF4: 渲染层与样式 ---------- */
function rf3() {
  const html = read("hosts/desktop/index.html");
  // 必须看**调用点**：光有那个辅助函数不算数 —— 把调用换回裸 invoke 一样会挂死。
  if (/await\s+roomOrchestrateWithDeadline\s*\(/.test(html)) {
    ok("RF3a", "渲染层的群回合调用点确实走了客户端兜底闸");
  } else {
    bad("RF3a", "渲染层的群回合调用点没走兜底闸：Host 不返回时界面永远停在「发出去没人回」");
  }
  if (/try\s*\{\s*await renderRoomTranscript\(roomId\);\s*\}\s*catch/.test(html.replace(/\n/g, "\n"))) {
    ok("RF3b", "重绘转录失败不会吃掉结果卡");
  } else {
    bad("RF3b", "重绘转录一旦抛错，结果卡就没了（失败又被吞掉一层）");
  }
  if (/room_turn_timeout\|room_turn_deadline/.test(html) && /roomTurnTimeout/.test(html)) {
    ok("RF3c", "超时有专属的人话文案，不是通用失败提示");
  } else {
    bad("RF3c", "超时没有专属文案，用户只能看到一句泛泛的失败");
  }
}

function rf4() {
  const css = read("hosts/desktop/ui_chrome.css");
  const m = css.match(/#composer #send:disabled\s*\{([^}]*)\}/);
  if (!m) {
    bad("RF4", "找不到 #send:disabled 规则");
    return;
  }
  const body = m[1];
  if (/opacity:\s*1\b/.test(body) && !/filter:\s*grayscale/.test(body)) {
    bad("RF4", "发送键的禁用态和可用态长得一样（opacity:1），按钮废了用户看不出来");
  } else {
    ok("RF4", "发送键的禁用态看得见了");
  }
}

await rf1();
rf2();
rf3();
rf4();

if (failures > 0) {
  console.log("");
  console.log("room failure surfaces: " + failures + " FAIL");
  process.exit(1);
}
console.log("");
console.log("room failure surfaces: all green");
process.exit(0);
