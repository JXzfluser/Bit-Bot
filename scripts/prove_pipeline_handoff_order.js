#!/usr/bin/env node
"use strict";

/**
 * prove_pipeline_handoff_order — 流水线的下一棒**由契约 order 决定**，不由成员临时改
 *
 * 现场（**真 MiniMax 第十四轮**，真 bug，不是门禁问题）：
 *   第一棒（情报侦察员）交完 3 条情报卡，末尾写了一句
 *     「【交给】内容主笔：把上面候选稿扩写成 1200—1500 字成稿…」
 *   ⇒ 旧逻辑「模型显式点名时以它为准」⇒ **选题策划师整棒被跳过**
 *   ⇒ 内容主笔**没拿到 brief**（上游没交）⇒ 它交出来一个只有标题的空壳
 *   ⇒ 验收判红「「正文」这一节只有标题没有内容（正文 0 字，要求 ≥ 120 字）
 *      —— 交了标题不算交付」
 *   ⇒ **五棒永远跑不完**。
 *
 * 为什么会这样：流水线的顺序是**建团时由角色契约的 order 定死**的，
 * 不是每轮重新商量的事。情报侦察员没有资格决定谁写稿 ——
 * 它的职责是交情报卡；跳过选题策划师，主笔就没有 brief 可写。
 *
 * 契约：
 *   1. 模型点名**与契约冲突** ⇒ 走**契约**（下一棒 = order 上的下一位）。
 *   2. 冲突时**如实说出来**（conflict 文案点名「想交给谁 / 契约说该交给谁」），
 *      不是偷偷改。
 *   3. 模型点名**与契约一致** ⇒ 走契约，且**没有**冲突文案（不制造噪音）。
 *   4. 模型**没点名** ⇒ 走契约。
 *   5. 已经是**最后一棒** ⇒ 没有契约可违背 ⇒ 尊重模型点名（不制造假冲突）。
 */

const path = require("path");
const { resolveNextPipelineMember } =
  require(path.resolve(__dirname, "..", "hosts", "desktop", "room_orchestrator.js"));

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

const pipe = [
  { id: "a", name: "情报侦察员" },
  { id: "b", name: "选题策划师" },
  { id: "c", name: "内容主笔" },
  { id: "d", name: "事实编辑" },
];

/* 1：冲突 ⇒ 走契约 */
{
  const r = resolveNextPipelineMember(pipe, "a", { id: "c", name: "内容主笔" });
  r && r.next && r.next.id === "b"
    ? ok("模型点名「内容主笔」⇒ 下一棒仍按契约是「选题策划师」（不跳棒）")
    : bad("模型点名改掉了流水线顺序（选题策划师被跳过）", JSON.stringify(r));
}

/* 2：冲突要**说出来**，且点名双方 */
{
  const r = resolveNextPipelineMember(pipe, "a", { id: "c", name: "内容主笔" });
  const c = String((r && r.conflict) || "");
  c.includes("内容主笔") && c.includes("选题策划师") && c.includes("契约")
    ? ok("冲突**如实说出来**：「想交给内容主笔 / 契约说该交给选题策划师」")
    : bad("冲突没被说清楚", c);
}

/* 3：一致 ⇒ 走契约且没有冲突文案 */
{
  const r = resolveNextPipelineMember(pipe, "a", { id: "b", name: "选题策划师" });
  r && r.next && r.next.id === "b" && !r.conflict
    ? ok("模型点名与契约一致 ⇒ 正常走，且**不**制造冲突噪音")
    : bad("一致时不该报冲突", JSON.stringify(r));
}

/* 4：没点名 ⇒ 走契约 */
{
  const r = resolveNextPipelineMember(pipe, "a", null);
  r && r.next && r.next.id === "b" && !r.conflict
    ? ok("模型没点名 ⇒ 按契约接棒")
    : bad("没点名时不该乱接", JSON.stringify(r));
}

/* 5：最后一棒 ⇒ 没有契约可违背 ⇒ 尊重模型点名 */
{
  const r = resolveNextPipelineMember(pipe, "d", { id: "c", name: "内容主笔" });
  r && r.next && r.next.id === "c" && !r.conflict
    ? ok("已经是最后一棒 ⇒ 尊重模型点名（不制造假冲突）")
    : bad("最后一棒不该报冲突", JSON.stringify(r));
}

/* 6：逐棒走 ⇒ 顺序必须是 情报→选题→主笔→审校 */
{
  let cur = pipe[0];
  const order = [cur.name];
  for (let i = 0; i < 3; i += 1) {
    const r = resolveNextPipelineMember(pipe, cur.id, null);
    if (!r.next) break;
    order.push(r.next.name);
    cur = r.next;
  }
  const want = "情报侦察员→选题策划师→内容主笔→事实编辑";
  order.join("→") === want
    ? ok("逐棒走完顺序正确：" + order.join("→"))
    : bad("顺序错了", order.join("→"));
}

console.log("prove_pipeline_handoff_order: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
