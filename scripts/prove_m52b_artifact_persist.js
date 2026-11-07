#!/usr/bin/env node
"use strict";

/**
 * prove_m52b_artifact_persist — 产物落库（Canvas 的数据地基）
 *
 * 背景：私聊的消息落库时只存 `{role, text}`，而一轮里生成的图片 / 视频 / 图表 /
 * ics / eml / skill.md / 导出包，路径全都只活在渲染层内存里。刷新一次，库里那条
 * 回复还在、文件卡却没了 —— 用户看到的是「图被吞了」。
 *
 * 这条链路必须先补，因为「产物画布」的内容源就是它：没有按消息归属的产物索引，
 * 画布只能画出一张空面。
 *
 * 契约：
 *   1. 收集器只收**磁盘上真存在**的文件；ok:false / 路径空 / 文件已删一律不收；
 *   2. 同一轮里重复路径只收一次；
 *   3. store 只留四个字段（path / name / kind / bytes），且上限 24；
 *   4. turn 结束时挂到**最后一条 assistant 行**（删掉那条回复，产物跟着消失）；
 *   5. 读历史时按存下来的产物重建卡片；文件已经不在了就如实写一行「已不在本机」，
 *      不画点开是空的破卡。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { collectTurnArtifacts, MAX_PER_TURN } = require("../hosts/desktop/turn_artifacts");
const { createSessionStore } = require("../hosts/desktop/sessions");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const REPO = path.join(__dirname, "..");
const MAIN = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
const SESSIONS = fs.readFileSync(path.join(REPO, "hosts/desktop/sessions.js"), "utf8");
const HTML = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

console.log("prove_m52b_artifact_persist — 产物落库");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m52b-"));
const png = path.join(tmp, "gen-image-desktop-1.png");
const ics = path.join(tmp, "schedule-desktop-1.ics");
fs.writeFileSync(png, Buffer.alloc(1234, 7));
fs.writeFileSync(ics, "BEGIN:VCALENDAR\nEND:VCALENDAR\n");

const r = (kind, obj, okFlag = true) => ({ kind, ok: okFlag, stdout: JSON.stringify(obj) });

/* T1 只收存在的、认得出种类的 */
{
  const got = collectTurnArtifacts([
    r("generate_image", { media_path: png }),
    r("schedule_meeting", { ics_path: ics }),
    r("generate_video", { media_path: path.join(tmp, "nope.mp4") }), // 文件不在
    r("mail_send", { eml_path: png }, false),                          // 这一步失败了
    r("unknown_kind", { path: png }),                                   // 认不出 = 不收
    r("generate_image", { media_path: png }),                           // 重复
  ]);
  const paths = got.artifacts.map((a) => a.path);
  paths.length === 2 && paths[0] === png && paths[1] === ics
    ? ok("T1 只收磁盘上真存在的产物（" + got.artifacts.map((a) => a.kind).join(" + ") + "）")
    : bad("T1 收集结果不对", JSON.stringify({ paths, skipped: got.skipped }));
  got.artifacts[0] && got.artifacts[0].bytes === 1234 && got.artifacts[0].name === "gen-image-desktop-1.png"
    ? ok("T1b 带上了真实字节数与文件名（不是只存一个路径字符串）")
    : bad("T1b 字节/名字缺失", JSON.stringify(got.artifacts[0]));
}

/* T2 负向：把文件删掉，同一条 host 结果就不能再被收 */
{
  const gone = path.join(tmp, "gone.txt");
  fs.writeFileSync(gone, "x");
  const a1 = collectTurnArtifacts([r("export_pack", { export_path: gone })]).artifacts.length;
  fs.unlinkSync(gone);
  const a2 = collectTurnArtifacts([r("export_pack", { export_path: gone })]).artifacts.length;
  a1 === 1 && a2 === 0
    ? ok("T2 负向对照：文件删掉后不再被收（T1 不是恒真）")
    : bad("T2 负向对照失败", JSON.stringify({ before: a1, after: a2 }));
}

/* T3 上限 */
{
  const many = [];
  for (let i = 0; i < MAX_PER_TURN + 6; i++) {
    const f = path.join(tmp, "cap-" + i + ".png");
    fs.writeFileSync(f, "x");
    many.push(r("generate_image", { media_path: f }));
  }
  const got = collectTurnArtifacts(many).artifacts.length;
  got === MAX_PER_TURN
    ? ok("T3 一轮最多收 " + MAX_PER_TURN + " 条（产物索引不是文件系统清单）")
    : bad("T3 上限没生效", String(got));
}

/* T4 store 只留四个字段 + 落盘后读得回来 */
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "m52b-store-"));
  fs.mkdirSync(path.join(root, "desktop"), { recursive: true });
  const st = createSessionStore(root, { dataRoot: path.join(root) });
  const created = st.create("产物落库");
  const sid = created.session.id;
  const res = st.appendMessages(sid, [
    { role: "user", text: "做一张区域图" },
    {
      role: "assistant",
      text: "图做好了。",
      artifacts: [
        { path: png, name: "gen-image-desktop-1.png", kind: "generate_image", bytes: 1234, evil: "<script>" },
        { path: "", name: "空路径" },
      ],
    },
  ]);
  const rows = (res && res.session && res.session.messages) || [];
  const art = (rows[1] && rows[1].artifacts) || [];
  art.length === 1 && art[0].path === png && art[0].kind === "generate_image" &&
    art[0].bytes === 1234 && !("evil" in art[0])
    ? ok("T4 store 只留 path/name/kind/bytes，空路径被剔除")
    : bad("T4 store 字段不对", JSON.stringify(art));
  const reread = st.get(sid);
  const again = ((reread.session.messages || [])[1] || {}).artifacts || [];
  again.length === 1 && again[0].path === png
    ? ok("T4b 重新 load 之后产物还在（这就是「刷新不丢」）")
    : bad("T4b 读回来没了", JSON.stringify(again));
}

/* T5 turn 结束挂到最后一条 assistant 行 */
{
  const attached = MAIN.includes("const picked = collectTurnArtifacts(result && result.host_results);") &&
    /for \(let i = toStore\.length - 1; i >= 0; i--\)[\s\S]{0,160}toStore\[i\]\.artifacts = picked\.artifacts;/.test(MAIN) &&
    MAIN.indexOf("toStore[i].artifacts = picked.artifacts") < MAIN.indexOf("sessions.appendMessages(sessionId, toStore)");
  attached
    ? ok("T5 产物在 appendMessages **之前**挂到最后一条 assistant 行")
    : bad("T5 挂载点不对（顺序错了就等于没存）");
}

/* T6 读历史时重建卡片，且先问文件还在不在 */
{
  const load = HTML.includes("if (Array.isArray(m.artifacts) && m.artifacts.length) {") &&
    HTML.includes("await window.bitbot.attachments.preview(ap)") &&
    HTML.includes("await renderDeliveryMedia(ap, kind, { label: kind });") &&
    HTML.includes("await renderOpenArtifact(ap, kind);");
  const goneLine = HTML.includes("gone.className = \"msg assistant artifact-gone\";") &&
    HTML.includes('t("artifactGone", { n:');
  load && goneLine
    ? ok("T6 历史加载按产物的 kind 重建成媒体卡/文件卡；文件不在了写一行灰字")
    : bad("T6 读历史没有重建路径", JSON.stringify({ load, goneLine }));
}

/* T7 三语一条 */
{
  const n = (HTML.match(/^\s*artifactGone: /gm) || []).length;
  n === 3 ? ok("T7 artifactGone 在 zh-CN / zh-TW / en 各一条")
    : bad("T7 三语缺条", String(n));
}

/* T8 负向对照 a：抹掉挂载 → T5 翻假 */
{
  const broken = MAIN.replace("toStore[i].artifacts = picked.artifacts;", "");
  const still = broken.includes("toStore[i].artifacts = picked.artifacts;");
  !still ? ok("T8 负向对照 a：抹掉挂载 → T5 翻假（非恒真）") : bad("T8 负向对照 a 恒真");
}

/* T9 负向对照 b：抹掉 store 的持久化 → T4 的静态断言翻假 */
{
  const broken = SESSIONS.replace("if (arts.length) row.artifacts = arts;", "");
  const still = broken.includes("if (arts.length) row.artifacts = arts;");
  !still ? ok("T9 负向对照 b：抹掉 store 持久化 → 落库断言翻假（非恒真）") : bad("T9 负向对照 b 恒真");
}

/* ===== 画布（只读产物墙）===== */

/* T10 DOM 与入口 */
{
  const dom = HTML.includes('id="canvas-panel"') && HTML.includes('id="canvas-grid"') &&
    HTML.includes('id="canvas-empty"') && HTML.includes('id="canvas-open-btn"') &&
    HTML.includes('data-i18n="canvasTitle"');
  dom ? ok("T10 画布面板 + 网格 + 空态 + 「＋」菜单入口都在")
    : bad("T10 画布 DOM 不完整");
}

/* T11 数据源是消息行上的 artifacts[]，不是扫目录 */
{
  const src = HTML.includes("async function canvasCollect()") &&
    HTML.includes("window.bitbot.sessions.get(activeSessionId)") &&
    HTML.includes("if (!m || !Array.isArray(m.artifacts)) continue;") &&
    !/canvasCollect[\s\S]{0,400}readdir/.test(HTML);
  src ? ok("T11 画布只铺「这个对话」的产物（读消息行 artifacts[]，不扫目录猜）")
    : bad("T11 画布数据源不对");
}

/* T12 图片给缩略图、缺失给「已不在本机」、别的给种类 —— 三种不混 */
{
  const three = HTML.includes("const CV_IMAGE_KINDS = /^(generate_image|structured_chart|watch_frame|screenshot)$/;") &&
    HTML.includes("await window.bitbot.attachments.preview(it.path)") &&
    HTML.includes('card.classList.add("cv-gone")') &&
    HTML.includes('k.textContent = alive ? (it.kind || "file") : t("canvasGone");');
  three ? ok("T12 图片→缩略图、其它→种类、文件没了→已不在本机（三态分开）")
    : bad("T12 卡片三态没分开");
}

/* T13 Esc / 背景 / ✕ 三个出口 */
{
  const exits = HTML.includes('if (close) close.addEventListener("click", closeCanvas);') &&
    HTML.includes('if (ev.target === panel) closeCanvas();') &&
    HTML.includes('if (ev.key !== "Escape") return;');
  exits ? ok("T13 画布三个出口都在（✕ / 点背景 / Esc）")
    : bad("T13 出口不全（Esc 关不掉最招骂）");
}

/* T14 六个画布键 × 三语 */
{
  const keys = ["canvasOpenBtn", "canvasTitle", "canvasNote", "canvasEmpty", "canvasCount", "canvasOpen", "canvasGone"];
  const missing = [];
  for (const k of keys) {
    const n = (HTML.match(new RegExp("^\\s*" + k + ": ", "gm")) || []).length;
    if (n !== 3) missing.push(k + "×" + n);
  }
  missing.length === 0 ? ok("T14 画布 7 个键在 zh-CN / zh-TW / en 各一条（7×3）")
    : bad("T14 三语不齐", missing.join(", "));
}

/* T15 负向对照 c：抹掉产物遍历 → T11 翻假 */
{
  const broken = HTML.replace("if (!m || !Array.isArray(m.artifacts)) continue;", "");
  !broken.includes("if (!m || !Array.isArray(m.artifacts)) continue;")
    ? ok("T15 负向对照 c：抹掉产物遍历 → T11 翻假（非恒真）")
    : bad("T15 负向对照 c 恒真");
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

console.log("\nprove_m52b_artifact_persist: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
