#!/usr/bin/env node
/* repro_task_sig_cards.mjs — P1 批 3.5 的**最小复现场景**（不是门禁）
 *
 * 这不是门禁（门禁是 scripts/prove_task_command_http.mjs 与
 * scripts/prove_command_task_control.js 的 TC-32）；这是一份**人能手动跑**的
 * 复现脚本,把「同一个 task_sig 在指挥台出现两张卡」这件事摆到台面上。
 *
 *   node scripts/repro_task_sig_cards.mjs
 *
 * 跑在**隔离的临时数据根**里（自己 mkdtemp），用户真仓库的 data/ 一个字节都不碰。
 *
 * 三个场景(全部用**真产品代码**:createProductSurface + 真 orchestrateRoom /
 * 真 replanRoomTask / 真 handoffTaskAsync + 真 hosts/shared/task_view.js 聚合):
 *   ① 编排一轮          ⇒ 转录 bot_reply×2 + final_report(都带 task_sig)
 *                        ⇒ Task 实体落一条同号记录
 *   ② 改向(force 重跑) ⇒ **第二批同号**的行(同号、同一批任务,不是新任务)
 *   ③ 交接(转交)       ⇒ 交接回执那一行(批 3.5 之前**不带** task_sig)
 *
 * 批 3.5 之前:① 2 张卡 / ② 3 张卡 / ③ 3 张卡(其中一张 task_sig 是空的孤儿卡)
 * 批 3.5 之后:① 1 张 / ② 1 张 / ③ 1 张,且那张卡的 state 取自 Task 实体。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { createProductSurface } = require(path.join(REPO, "hosts/desktop/product_surface.js"));
const taskView = require(path.join(REPO, "hosts/shared/task_view.js"));

const BOTS = {
  version: 1, primary_id: "b1",
  bots: [
    { id: "b1", name: "Alice", job: "research", description: "", hidden: false },
    { id: "b2", name: "Bob", job: "write", description: "", hidden: false },
  ],
};
const ROOMS = {
  version: 1,
  rooms: [{ id: "room-t", title: "内容团队", members: ["b1", "b2"], created_at: "t", transcript: [] }],
};

function mkSurface() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-repro-sig-"));
  const dir = path.join(root, "data", "desktop");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bots.json"), JSON.stringify(BOTS));
  fs.writeFileSync(path.join(dir, "rooms.json"), JSON.stringify(ROOMS));
  return { surface: createProductSurface(root), root };
}

function cardCounts(cards) {
  const out = {};
  for (const c of cards) {
    const k = String(c.task_sig || "(空 task_sig)");
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function show(label, surface) {
  const rooms = surface.roomsStoreStatus().rooms.rooms || [];
  const tx = (rooms[0] && rooms[0].transcript) || [];
  console.log("\n── " + label + " ──");
  for (const e of tx) {
    console.log("   转录 " + String(e.kind).padEnd(15) +
      " task_sig=" + JSON.stringify(e.task_sig || "") +
      (e.responder_policy ? " policy=" + e.responder_policy : ""));
  }
  for (const r of surface.listTasks()) {
    console.log("   实体 " + JSON.stringify({ id: r.id, state: r.state === undefined ? "(无 state)" : r.state }));
  }
  const cards = taskView.aggregate(rooms, surface.listTasks());
  for (const c of cards) {
    console.log("   卡   " + JSON.stringify({
      task_sig: c.task_sig, bucket: c.bucket, state: c.state === undefined ? "(空)" : c.state,
      persisted: !!c.persisted, archived: !!c.archived, steps: (c.steps || []).length,
    }));
  }
  const counts = cardCounts(cards);
  console.log("   ⇒ 每个 task_sig 的卡片数: " + JSON.stringify(counts));
  const dup = Object.entries(counts).filter(([, n]) => n > 1);
  console.log("   ⇒ 同一个 task_sig 出现 " + (dup.length ? "**" + dup.length + " 处重复**" : "0 处重复"));
  return { cards, counts, dup };
}

/* ① 编排一轮 */
{
  const { surface, root } = mkSurface();
  let n = 0;
  const runResponderTurn = async () => ({ ok: true, text: "要点 " + (++n) });
  await surface.orchestrateRoom({
    room: "room-t", task: "整理热点稿", to: "b1,b2",
    message_id: "msg-1", deps: { runResponderTurn },
  });
  show("① 编排一轮（bot_reply + final_report + Task 实体）", surface);
  fs.rmSync(root, { recursive: true, force: true });
}

/* ② 改向 ⇒ force 重跑 ⇒ 第二批同号的行 */
{
  const { surface, root } = mkSurface();
  let n = 0;
  const runResponderTurn = async () => ({ ok: true, text: "答案 " + (++n) });
  await surface.orchestrateRoom({
    room: "room-t", task: "整理热点稿", to: "b1,b2",
    message_id: "msg-1", deps: { runResponderTurn },
  });
  const out = surface.replanRoomTask("room-t|msg-1", "room-t", "改写成交付稿");
  await surface.orchestrateRoom({
    room: "room-t", task: out.task, message_id: out.message_id, force: true,
    to: "b1,b2", deps: { runResponderTurn },
  });
  show("② 改向（force 重跑 ⇒ 第二批**同号**的行）", surface);
  fs.rmSync(root, { recursive: true, force: true });
}

/* ③ 交接 ⇒ 交接回执那一行（批 3.5 之前不带 task_sig） */
{
  const { surface, root } = mkSurface();
  let n = 0;
  const runResponderTurn = async () => ({ ok: true, text: "交接回执 " + (++n) });
  await surface.orchestrateRoom({
    room: "room-t", task: "整理热点稿", to: "b1,b2",
    message_id: "msg-1", deps: { runResponderTurn },
  });
  await surface.handoffTaskAsync(
    { room: "room-t", from_bot: "b1", to_bot: "b2", task: "collect deploy logs" },
    { runResponderTurn },
  );
  show("③ 交接（交接回执那一行带没带 task_sig）", surface);
  fs.rmSync(root, { recursive: true, force: true });
}
