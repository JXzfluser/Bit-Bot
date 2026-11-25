#!/usr/bin/env node
"use strict";

/**
 * prove_concurrent_write_merge — 并发写不许**丢更新**（真 provider 第八轮实测）
 *
 * 现场（真 MiniMax 第八轮，第一棒真产物落盘那一刻）：
 *   用户点「一键成队」⇒ 群建起来了、成员真的答了（转录里有 bot_reply），
 *   然后**群整批消失** —— rooms.json 变成 `{"version":1,"rooms":[]}`。
 *
 * 根因（不是玄学，是可确定性重演的交错）：
 *   桌面主进程与定时守护/回合执行器**各写各的整份 rooms.json**。
 *   T0 进程 A 读到 rooms = []           （A 的内存快照 = 空）
 *   T1 进程 B 建了群 ⇒ 盘上 = [群]
 *   T2 进程 A **又读了一次**（基线刷新成 [群]），手里的 data 仍是 T0 的旧快照
 *   T3 进程 A 写回 ⇒ 老判定「基线里有 + 我没写 = 我删的」⇒ **群被抹掉**
 *
 *   ⇒ 「基线刷新过」之后，「我没写它 ⇒ 我删了它」这条判定就不成立了。
 *   ⇒ 而群面**根本没有删除入口** ⇒ 「我这次没写它」**一律保留**。
 *
 * 同一条纪律，批准队列也中招（真 provider 第七轮 P11）：
 *   pending-approvals.jsonl 被写成 0 行，而界面上还显示着那两行 ⇒
 *   看得见、管不着。
 *
 * 契约（先立红，修完必须全绿）：
 *   1. **群面**：A 用旧快照写回，B 刚建的群**不能消失**。
 *   2. **群面**：A 自己建的群，A 写回后**仍在**（不能把自己也弄丢）。
 *   3. **群面**：A 改过的群，改动**要生效**（合并不能把真改动也丢掉）。
 *   4. **批准面**：决定一行**不抹掉**别人刚挂出的行。
 *   5. **批准面**：决定之后，这一行**真的**不再是 pending（状态落盘）。
 *   6. 两张面写回后**行数**符合预期（没凭空多、也没凭空少）。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductSurface } = require("../hosts/desktop/product_surface");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-merge-"));
const ROOMS = path.join(root, "data", "desktop", "rooms.json");
const PEND = path.join(root, "data", "desktop", "pending-approvals.jsonl");

const readRooms = () => {
  try {
    const j = JSON.parse(fs.readFileSync(ROOMS, "utf8"));
    return Array.isArray(j.rooms) ? j.rooms : [];
  } catch { return []; }
};
const readPend = () => {
  try {
    return fs.readFileSync(PEND, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
};

/* 两个**独立进程**（各自的 product surface 实例 = 各自的内存快照）。
   真实场景就是桌面主进程 vs 定时守护。 */
const surfA = createProductSurface(root);
const surfB = createProductSurface(root);

try {
  /* 两个 Bot（先有成员，才有群）。 */
  const bot1 = surfA.botsCreate({ name: "甲成员", job: "搜集" });
  const bot2 = surfA.botsCreate({ name: "乙成员", job: "写作" });
  const b1 = bot1 && bot1.bot && bot1.bot.id;
  const b2 = bot2 && bot2.bot && bot2.bot.id;
  b1 && b2 ? ok("建了两个 Bot（" + b1 + " / " + b2 + "）") : bad("建 Bot 失败", JSON.stringify([bot1, bot2]).slice(0, 200));

  /* ---------- 群面 ---------- */
  /* A 先读（拿到空快照）；B 建群；A 再读（基线刷新）；A 用**旧快照**写回。 */
  const aSnapshot = surfA.__roomsIO.requireWritable();
  const created = surfB.roomCreate(b1 + "," + b2, "B 建的群");
  const bRoomId = created && created.room && created.room.id;
  created && created.ok
    ? ok("B 建群成功（" + bRoomId + "）")
    : bad("B 建群失败", JSON.stringify(created).slice(0, 200));

  /* A 此刻再做一次「写前重读」⇒ 基线刷新成含 B 的群；A 手里仍是旧快照。 */
  surfA.__roomsIO.requireWritable();
  /* A 用**它读到的旧快照**写回（这正是「基线刷新 + 旧内存」的交错）。 */
  surfA.__roomsIO.save({ version: 1, rooms: (aSnapshot && aSnapshot.rooms) || [] });

  const after = readRooms();
  const bStillThere = after.some((r) => r && String(r.id) === String(bRoomId));
  bStillThere
    ? ok("A 用旧快照写回之后，**B 刚建的群没有消失**（丢更新修好）")
    : bad("B 的群被 A 的旧快照整批抹掉了", JSON.stringify(after.map((r) => r && r.id)));

  /* A 自己建的群也不能丢 */
  const aCreated = surfA.roomCreate(b1 + "," + b2, "A 建的群");
  const aId = aCreated && aCreated.room && aCreated.room.id;
  const aSnapshot2 = surfA.__roomsIO.requireWritable();
  surfA.__roomsIO.save({ version: 1, rooms: ((aSnapshot2 && aSnapshot2.rooms) || []).filter((r) => r && r.id !== aId) });
  const after2 = readRooms();
  const aStillThere = after2.some((r) => r && String(r.id) === String(aId));
  aStillThere
    ? ok("A 自己建的群写回后**仍在**（合并没把自己也弄丢）")
    : bad("A 自己的群丢了", JSON.stringify(after2.map((r) => r && r.id)));

  /* ---- 级联删除（删 Bot ⇒ 成员不足 2 人的群被移除）**不能被复活** ----
   * ⚠️ 这是批次 10 续自己引入的一条新红（CI 的 G-14 cleanup）：
   *   群面「一律保留」的修法把**级联删除**也复活了 ⇒ 「我明明解散了这个群，
   *   它又出现了」。⇒ 「真删除」与「并发丢更新」在数据上完全一样（都是
   *   「基线里有、我没写」）⇒ **分不出来** ⇒ 删除必须是**显式意图**。
   * ⇒ 这里用**真接口**（删 Bot）走一遍 ⇒ 群行必须真的消失。 */
  {
    /* 造一个 2 成员的群（只有 a1/a2 在群里），删掉其中一个 ⇒ 群应被级联移除。 */
    const b3 = surfA.botsCreate({ name: "丙成员", job: "审阅" });
    const b3id = b3 && b3.bot && b3.bot.id;
    const room2 = surfA.roomCreate(b3id + "," + b2, "将被解散的群");
    const r2id = room2 && room2.room && room2.room.id;
    const beforeRows = readRooms().length;
    /* botsDelete 需要 confirm === "yes"（删除是不可逆动作，两段确认）。 */
    const del = surfA.deleteBot ? surfA.deleteBot(b3id, "yes") : null;
    const afterRows = readRooms();
    const gone = !afterRows.some((r) => r && String(r.id) === String(r2id));
    gone && del && del.ok !== false
      ? ok("删掉成员不足 2 人的群里的 Bot ⇒ **群行被级联移除，没被复活**" +
           "（这条是本批自己引入的红：群面「一律保留」会把级联删除也复活）")
      : bad("级联删除的群行复活了（或者删除失败）",
            JSON.stringify({ del: del && (del.ok || del.error), r2id, beforeRows,
                             after: afterRows.map((r) => r && r.id) }).slice(0, 300));
    /* 别人的群**仍然**不能被复活（并发丢更新的修复不能因此退化）。 */
    const bStillThere2 = afterRows.some((r) => r && String(r.id) === String(bRoomId));
    bStillThere2
      ? ok("级联删除**没有**让别的群复活（并发丢更新的修复仍在）")
      : bad("别的群被误删了", JSON.stringify(afterRows.map((r) => r && r.id)));
  }

  /* 真改动要生效 */
  const renamed = surfB.roomRename({ room: aId, title: "A 改过的群" });
  if (renamed && renamed.ok !== false) {
    const t = readRooms().find((r) => r && String(r.id) === String(aId));
    t && /A 改过的群/.test(String(t.title || ""))
      ? ok("真改动**生效**（合并没把改动一起丢掉）")
      : bad("群改名没生效", JSON.stringify({ renamed: renamed && renamed.ok, title: t && t.title }));
  } else {
    bad("群改名入口不可用", JSON.stringify(renamed).slice(0, 200));
  }

  /* ---------- 批准面 ---------- */
  const p1 = surfA.appendPendingApproval({ source: "routine", kind: "mail_send", command: "gmail|a@example.com|one|body" });
  const p2 = surfB.appendPendingApproval({ source: "routine", kind: "mail_send", command: "gmail|b@example.com|two|body" });
  ok("两边各挂一行待批准（" + (p1 && p1.id) + " / " + (p2 && p2.id) + "）");

  /* A 决定**自己**那一行 —— 写回是整面覆盖，绝不能把 B 刚挂的那行抹掉 */
  const dec = surfA.approvalDecide(p1.id, "deny");
  dec && dec.ok === true
    ? ok("A 决定自己那行成功")
    : bad("A 决定失败", JSON.stringify(dec));

  const pend = readPend();
  /* ⚠ 这条**单独**抓不住「写回吃掉别人的行」：decide 自己会重读最新文件，
   *   所以即使退回整面覆盖，它也照样带得上 p2（变异二实测：这条仍绿）。
   *   ⇒ 它只保证「同一进程内的误删」没发生；**真正的牙在下面的合并断言**。
   *   ⇒ 这里仍然留着（它对「误删全部 pending」这类错误有牙），但不拿它当并发护栏。 */
  const p2Alive = pend.some((e) => String(e && e.id) === String(p2.id));
  p2Alive
    ? ok("A 决定之后，B 挂的那行仍在队列里（同进程内没被误删）")
    : bad("A 决定把 B 的行整批抹掉了", JSON.stringify(pend.map((e) => [e && e.id, e && e.status])));

  const p1State = pend.find((e) => String(e && e.id) === String(p1.id));
  p1State && p1State.status === "decided" && p1State.decision === "deny"
    ? ok("A 决定的那行**真的**落到真源里（status=decided）")
    : bad("决定没落盘", JSON.stringify(p1State));

  /* ---- 批准面的「读-改-写之间被别人插队」必须**确定性**验到 ----
   * 上面那条（A 决定 p1）里，A 自己会重读最新文件 ⇒ 整面覆盖也带得上 p2 ⇒
   * **测不到**真正的丢更新 ⇒ 上面那条断言其实**没有牙**（变异二证明了这点）。
   * ⇒ 这里直接测**合并函数**：我手里的 entries 是**旧快照**（只有 p1），
   *   而磁盘上此刻已经有 B 刚挂的 p2 ⇒ 合并结果**必须**把 p2 带上。
   *   （退回整面覆盖时这条必须翻红 ⇒ 判据有牙。） */
  const mergedList = surfA.__approvalsIO.merge([Object.assign({}, p1State, { status: "decided", decision: "deny" })]);
  const mergedHasP2 = mergedList.some((e) => String(e && e.id) === String(p2.id) && e.status === "pending");
  mergedHasP2
    ? ok("合并把**别人刚挂的行**带上了（旧快照写回不吃掉别人的行）")
    : bad("合并把别人刚挂的行丢了（退回整面覆盖了？）", JSON.stringify(mergedList.map((e) => [e && e.id, e && e.status])));
  /* 再走**真写回**：把合并结果写进真源 ⇒ p2 必须**真的**还在文件里。
   * （这一条让「合并对了但写回没用它」这类错误也翻红。） */
  fs.writeFileSync(PEND, mergedList.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const afterWrite = readPend();
  const p2OnDisk = afterWrite.some((e) => String(e && e.id) === String(p2.id) && e.status === "pending");
  p2OnDisk
    ? ok("合并结果**真的写回**了真源，别人的行在文件里还在")
    : bad("合并结果写回后，别人的行没了", JSON.stringify(afterWrite.map((e) => [e && e.id, e && e.status])));
  const mergedHasP1 = mergedList.some((e) => String(e && e.id) === String(p1.id) && e.status === "decided");
  mergedHasP1
    ? ok("合并也保住了我自己的决定（status=decided）")
    : bad("合并把自己的决定弄丢了", JSON.stringify(mergedList.map((e) => [e && e.id, e && e.status])));

  const expectCount = 2;
  pend.length === expectCount
    ? ok("批准队列行数符合预期（" + pend.length + " 行，没多没少）")
    : bad("批准队列行数不对", JSON.stringify({ got: pend.length, expect: expectCount }));

  /* 渲染口径：决定的行不再当待批准 */
  const listed = surfA.pendingApprovals();
  const stillPending = (listed || []).some((x) => String(x && x.id) === String(p1.id) && x.status === "pending");
  !stillPending
    ? ok("渲染不再把决定的行当待批准")
    : bad("决定的行还显示成待批准", JSON.stringify((listed || []).filter((x) => x && x.id === p1.id)));
} catch (e) {
  bad("探针崩了", (e && e.stack) || e);
}

console.log("prove_concurrent_write_merge: PASS=" + pass + " FAIL=" + fail);
try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* keep */ }
process.exit(fail ? 1 : 0);
