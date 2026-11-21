/* grok_acceptance_expectations.mjs — 从两份 real-spec 生成「门该断言什么」
 *
 * 为什么要它：旧 e2e_grok_desktop_spec.mjs 把期望值（紫 / 34px / radius16）手抄进常量，
 * 于是 21/21 PASS 只证明脚本和自己一致，不证明像 Grok。本脚本把所有断言的**期望值**
 * 从 reference/grok-real-spec.json 直接取出，落成 JSON，让新门只读这个文件；
 * 同时把「改这一值会让哪几条既有门红」的冲突显式列出来。
 *
 * 用法：node scripts/grok_acceptance_expectations.mjs [--write]
 *   不带 --write 只打印，不动任何文件。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const REF = path.join(REPO, "docs/design/desktop-target/reference");
const GROK = JSON.parse(fs.readFileSync(path.join(REF, "grok-real-spec.json"), "utf8"));
const BB = JSON.parse(fs.readFileSync(path.join(REF, "bb-real-spec.json"), "utf8"));
const OUT = path.join(REF, "grok-acceptance-expectations.json");

const px = (v) => (typeof v === "string" ? parseFloat(v) : v);
const num = (v) => (typeof v === "number" ? v : px(v));
const round = (v) => Math.round(v * 100) / 100;

// 断言区间：真源实测值 ± 容差（几何 ±2px 与 layout-contract 一致；圆角/字号精确）
const band = (v, tol = 2) => ({ eq: round(v), min: round(v - tol), max: round(v + tol), measured: v });

const E = {
  _source: "docs/design/desktop-target/reference/grok-real-spec.json（CDP 实测，禁止再手写常量）",
  _generatedBy: "scripts/grok_acceptance_expectations.mjs",
  _measuredAt: GROK.meta,
  sidebar: {
    width: band(num(GROK.sidebar.width), 0),
    background: GROK.sidebar.backgroundColor,
    rightBorder: `${GROK.sidebar.borderRightWidth} ${GROK.sidebar.borderRightStyle} ${GROK.sidebar.borderRightColor}`,
    sessionRow: {
      height: band(num(GROK.sessionRow.height), 2),
      width: band(num(GROK.sessionRow.width), 2),
      borderRadius: band(px(GROK.sessionRow.borderRadius), 0),
      padding: GROK.sessionRow.padding,
      gap: GROK.sessionRow.gap,
      pitch: round(num(GROK.sessionRow.verticalPitch)),
      interRowGap: round(num(GROK.sessionRow.interRowGap)),
      titleFontSize: band(num(GROK.sessionRow.title.fontSize), 0),
      titleFontWeight: GROK.sessionRow.title.fontWeight,
      previewFontSize: band(num(GROK.sessionRow.preview.fontSize), 0),
      previewColor: GROK.sessionRow.preview.color,
    },
    avatar: { size: band(num(GROK.avatar.width), 2), wrapperRadius: GROK.avatar.borderRadius },
    interaction: {
      idle: GROK.rowInteractionStates.idle.backgroundColor,
      hover: "rgba(28, 28, 28, 0.06)",
      selected: GROK.rowInteractionStates.selected.backgroundColor,
      selectedMarker: "aria-current（不是靠底色加深）",
    },
  },
  composer: {
    width: band(num(GROK.composer.width), 2),
    height: band(num(GROK.composer.height), 2),
    borderRadius: band(px(GROK.composer.borderRadius), 0),
    border: `${GROK.composer.borderTopWidth} ${GROK.composer.borderTopStyle} ${GROK.composer.borderTopColor}`,
    boxShadow: GROK.composer.boxShadow,
    fieldFontSize: band(num(GROK.composer.field.fontSize), 0),
    fieldLeftInset: band(num(GROK.composer.fieldLeftInset), 2),
    frameWidthVsPane: GROK.composer.frameWidthVsPane,
  },
  roundButtons: {
    attach: { size: band(num(GROK.attachButton.width), 1), radius: GROK.attachButton.borderRadius, background: GROK.attachButton.backgroundColor },
    mic: { size: band(num(GROK.micButton.width), 1), radius: GROK.micButton.borderRadius },
    send: {
      size: band(num(GROK.sendButton.width), 1),
      radius: GROK.sendButton.borderRadius,
      emptyBackground: GROK.sendButton.backgroundColor,
      note: "空态即实心近黑，不像我方只降 opacity",
    },
  },
  bubble: {
    borderRadius: band(px(GROK.bubble.borderRadius), 0),
    padding: GROK.bubble.padding,
    fontSize: band(num(GROK.bubbleText.fontSize), 0),
    lineHeight: GROK.bubbleText.lineHeight,
    assistantBackground: GROK.bubble.backgroundColor,
    userBackground: GROK.bubbleVariants?.[1]?.backgroundColor,
    userColor: GROK.bubbleVariants?.[1]?.color,
    insetHighlight: GROK.bubbleVariants?.[0]?.boxShadow,
    authorName: {
      fontSize: GROK.bubbleAuthorName.fontSize,
      fontWeight: GROK.bubbleAuthorName.fontWeight,
      color: GROK.bubbleAuthorName.color,
      notMeasured: ["perAuthorColored"], // 真机只采到一个 author run：能否按作者变色未知，禁止给门写死
    },
    inStreamAvatar: {
      size: band(num(GROK.bubbleAvatar.width), 1),
      radius: GROK.bubbleAvatar.borderRadius,
      position: "气泡左下（.sand-author-run__gutter，与作者名同柱，不是气泡上方）",
    },
    maxWidth: band(parseFloat(GROK.messageColumn.maxWidthRule), 2),
    codeBlockWidth: band(num(GROK.messageColumn.codeBlock.width), 2),
  },
  accountPopup: {
    width: band(num(GROK.accountPopup.container.width), 2),
    height: band(num(GROK.accountPopup.container.height), 2),
    borderRadius: band(px(GROK.accountPopup.container.borderRadius), 0),
    boxShadow: GROK.accountPopup.container.boxShadow,
    border: `${GROK.accountPopup.container.borderTopWidth} ${GROK.accountPopup.container.borderTopStyle}`,
    itemHeight: band(px(GROK.accountPopup.items[0].height), 1),
    itemPadding: GROK.accountPopup.items[0].padding,
    itemRadius: band(px(GROK.accountPopup.items[0].borderRadius), 0),
    fontSize: GROK.accountPopup.items[0].fontSize,
    fontWeight: GROK.accountPopup.items[0].fontWeight,
    iconSize: GROK.accountPopup.items[0].icons[0]?.width,
    sectionCount: GROK.accountPopup.sectionCount,
    separator: GROK.accountPopup.separators[0]?.border,
    items: GROK.accountPopup.items.map((i) => i.text),
  },
  plusMenu: {
    width: band(num(GROK.plusMenuItems.container.width), 2),
    borderRadius: band(px(GROK.plusMenuItems.container.borderRadius), 0),
    boxShadow: GROK.plusMenuItems.container.boxShadow,
    items: GROK.plusMenuItems.items.map((i) => i.text),
  },
  connectApps: {
    width: band(num(GROK.connectAppsPanel.container.width), 2),
    height: band(num(GROK.connectAppsPanel.container.height), 2),
    borderRadius: band(px(GROK.connectAppsPanel.container.borderRadius), 0),
    boxShadow: GROK.connectAppsPanel.container.boxShadow,
    titleFont: `${GROK.connectAppsPanel.title.fontSize}/${GROK.connectAppsPanel.title.fontWeight}`,
    closeRadius: GROK.connectAppsPanel.close.borderRadius,
    chipHeight: band(num(GROK.connectAppsPanel.chips[0].height), 1),
    rowHeight: band(num(GROK.connectAppsPanel.rows[0].height), 1),
    headingCount: GROK.connectAppsPanel.headings.length,
    gridColumns: GROK.connectAppsPanel.grid.gridTemplateColumns,
  },
  tokens: {
    accent: GROK.tokens?.cssVars?.["--sand-bg-primary"],
    ink: GROK.tokens?.cssVars?.["--sand-text-primary"],
    secondaryText: GROK.tokens?.cssVars?.["--sand-text-secondary"],
    weakFill: GROK.tokens?.cssVars?.["--sand-bg-secondary"],
    onlineAccent: GROK.tokens?.cssVars?.["--sand-bg-green-bright"],
    unread: GROK.tokens?.unreadDot?.color ?? null,
    unreadSize: band(num(GROK.tokens?.unreadDot?.width), 0),
  },
};

// 冲突表：这些既有门/文档写了别的值，落地时必须同批改，否则一边绿一边红
E._gateConflicts = [
  {
    field: "accent",
    grokWants: E.tokens.accent,
    ourCurrent: BB.tokens?.["--accent"] ?? "(见 bb-real-spec tokens)",
    blockers: [
      "scripts/e2e_grok_desktop_spec.mjs:34-35 手写 ACCENT_LIGHT/DARK",
      "docs/design/desktop-target/ui-unified-spec.md §2.1 权威值 #7c3aed",
      "replica/design/tokens.css|json 写 --accent:#1a1a1a（第三套值）",
    ],
  },
  {
    field: "sendButton.size",
    grokWants: E.roundButtons.send.size.eq + "px",
    ourCurrent: `${BB.sendButton?.width}(${BB.sendButton?.borderRadius ?? ""})`,
    blockers: [
      "ui_chrome.css #send 34px !important",
      "scripts/prove_m33_grokchrome.js:91-92 要求 index.html 出现字面 width:36px",
      "scripts/smoke_grok_desktop_parity.sh:1296 grep 文案「36px 圆形」",
    ],
  },
  {
    field: "bubble.borderRadius",
    grokWants: E.bubble.borderRadius.eq + "px",
    ourCurrent: `${BB.bubble?.borderRadius}`,
    blockers: ["e2e_grok_desktop_spec A10 断言 === 16", "--radius-bubble: 16px", "smoke_grok_desktop_parity.sh:780 合同文案"],
  },
  {
    field: "composer.borderRadius",
    grokWants: E.composer.borderRadius.eq + "px",
    ourCurrent: `${BB.composer?.borderRadius ?? BB.composer?.row?.borderRadius}`,
    blockers: ["css 硬写 24（覆盖 --radius-composer: 22）", "e2e A5 只断言 radius>=20（放不住精确值）"],
  },
  {
    field: "sessionRow.height",
    grokWants: E.sidebar.sessionRow.height.eq + "px",
    ourCurrent: `${BB.sessionRow?.height}`,
    blockers: ["e2e S3 断言区间 56-62", "layout-contract.md §3 合同行高"],
  },
  {
    field: "字阶 12/16px",
    grokWants: "分组/作者名 12px、行标题 16px（weight 420）",
    ourCurrent: `${BB.sessionRow?.title?.fontSize} / ${BB.groupLabel?.fontSize}`,
    blockers: ["ui-unified-spec §2.3 禁 11/12px", "prove_ui_tokens.js 字号白名单（T-3 行内 font-size 23<=24）"],
  },
];

const json = JSON.stringify(E, null, 2);
if (process.argv.includes("--write")) {
  fs.writeFileSync(OUT, json + "\n");
  console.log("期望值表 → " + OUT);
} else {
  console.log(json);
  console.log("\n（未写文件；--write 生成 " + OUT + "）");
}
console.log("断言字段:", Object.keys(E).filter((k) => !k.startsWith("_")).join(", "), "| 冲突项:", E._gateConflicts.length);
