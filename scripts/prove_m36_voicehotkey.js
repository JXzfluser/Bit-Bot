#!/usr/bin/env node
"use strict";

/**
 * prove_m36_voicehotkey — Wave M36「Cmd/Ctrl+D 语音输入绑定」
 *
 * 静态层：
 *   1) wireAccelerators 里 `ev.key === "d" | "D"` 分支调用 startVoiceInput()；
 *      使用 `typeof startVoiceInput === "function"` 做前向引用保护（函数声明
 *      在文件后段），不新增重复实现；
 *   2) 🎙 按钮 click 走同一个 startVoiceInput，避免"鼠标 vs 键盘"两份录音状态；
 *   3) HOTKEYS 表里 hkVoice 的短语与按钮 title 一致（Cmd/Ctrl + D）。
 *
 * 负向对照：抹掉 startVoiceInput() 调用，第 1 项断言应变红。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M36 voice-hotkey proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* ---------- 1) Cmd/Ctrl+D 分支接入 wireAccelerators ---------- */
if (/else if \(ev\.key === "d" \|\| ev\.key === "D"\) \{[\s\S]{0,220}startVoiceInput\(\)/.test(html)) {
  ok("wireAccelerators：Cmd/Ctrl+D 分支调用 startVoiceInput()");
} else {
  bad("accelerator D", "startVoiceInput not wired");
}

/* ---------- 1b) 前向引用保护 ---------- */
if (/typeof startVoiceInput === "function"/.test(html)) {
  ok("键盘分支使用 typeof guard，不假设 startVoiceInput 已 hoist 完成");
} else {
  bad("safe dispatch", "no typeof guard before startVoiceInput");
}

/* ---------- 2) 按钮 click 与快捷键共用同一入口 ---------- */
if (/getElementById\("voice-btn"\)[\s\S]{0,120}addEventListener\("click", startVoiceInput\)/.test(html)) {
  ok("🎙 按钮 click → startVoiceInput（与快捷键同一入口，无第二份录音状态）");
} else {
  bad("voice button", "button not sharing startVoiceInput");
}

/* ---------- 3) HOTKEYS 表 hkVoice 存在，短语对齐 title ---------- */
if (/\["Cmd \/ Ctrl \+ D", "hkVoice"\]/.test(html)
  && /id="voice-btn"[^>]*title="语音输入（Ctrl\/Cmd\+D）"/.test(html)) {
  ok("HOTKEYS hkVoice 项与按钮 title 一致：语音输入 / Ctrl+Cmd+D");
} else {
  bad("hotkey label", "voice hotkey entry or button title drift");
}

/* ---------- 4) 负向对照 ---------- */
const broken = html.replace(/startVoiceInput\(\);/, "/* removed */");
const survived = /else if \(ev\.key === "d" \|\| ev\.key === "D"\)[\s\S]{0,220}startVoiceInput\(\)/.test(broken);
if (!survived) ok("负向对照：抹掉 startVoiceInput() 调用 → 分支断言翻假（非恒真）");
else bad("negative control", "call survived strip");

console.log("\nprove_m36_voicehotkey: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
