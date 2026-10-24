/* delta_emit_regions.mjs — 从两份 real-spec 直接打印 §4.3 composer / §4.4 消息流 的对照行
 *
 * 为什么不手抄：对照稿里每个数字都必须能重跑。手写一遍 = 引入一次抄错的机会，
 * 而本轮已经吃过「门常量与真源不同步」的亏（accent 断言写死在 e2e 门里）。
 *
 * 用法：node scripts/delta_emit_regions.mjs [markdown|text]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF = path.resolve(__dirname, "../docs/design/desktop-target/reference");
const G = JSON.parse(fs.readFileSync(path.join(REF, "grok-real-spec.json"), "utf8"));
const B = JSON.parse(fs.readFileSync(path.join(REF, "bb-real-spec.json"), "utf8"));

const at = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

// [标签, grok 路径, bb 路径]：只列「改这一处就能收敛」的可见参数
const COMPOSER = [
  ["容器高 height", "composer.height", "composer.height"],
  ["容器宽 width", "composer.width", "composer.width"],
  ["容器圆角 radius", "composer.borderRadius", "composer.borderRadius"],
  ["容器底色 background", "composer.backgroundColor", "composer.backgroundColor"],
  ["边框宽 borderTopWidth", "composer.borderTopWidth", "composer.borderTopWidth"],
  ["边框色 borderColor", "composer.borderTopColor", "composer.borderTopColor"],
  ["边框样式", "composer.borderTopStyle", "composer.borderTopStyle"],
  ["阴影 boxShadow", "composer.boxShadow", "composer.boxShadow"],
  ["padding", "composer.padding", "composer.padding"],
  ["gap", "composer.gap", "composer.gap"],
  ["输入区字号", "composer.field.fontSize", "composer.field.fontSize"],
  ["输入区字重", "composer.field.fontWeight", "composer.field.fontWeight"],
  ["输入区色", "composer.field.color", "composer.field.color"],
  ["输入左内缩 fieldLeftInset", "composer.fieldLeftInset", "composer.fieldLeftInset"],
  ["＋ 钮尺寸", "attachButton.width", "attachButton.width"],
  ["＋ 钮圆角", "attachButton.borderRadius", "attachButton.borderRadius"],
  ["＋ 钮底色", "attachButton.backgroundColor", "attachButton.backgroundColor"],
  ["＋ 钮描边环", "attachButton.boxShadow", "attachButton.boxShadow"],
  ["麦克风尺寸", "micButton.width", "micButton.width"],
  ["麦克风圆角", "micButton.borderRadius", "micButton.borderRadius"],
  ["发送键尺寸", "sendButton.width", "sendButton.width"],
  ["发送键圆角", "sendButton.borderRadius", "sendButton.borderRadius"],
  ["发送键底色", "sendButton.backgroundColor", "sendButton.backgroundColor"],
  ["发送键字形色", "sendButton.color", "sendButton.color"],
  ["发送键阴影", "sendButton.boxShadow", "sendButton.boxShadow"],
  ["发送键禁用态", "sendButton.disabled", "sendButton.disabled"],
];

const FLOW = [
  ["气泡圆角 radius", "bubble.borderRadius", "bubble.borderRadius"],
  ["气泡 padding", "bubble.padding", "bubble.padding"],
  ["气泡底色 assistant", "bubble.backgroundColor", "bubble.backgroundColor"],
  ["气泡字色 assistant", "bubble.color", "bubble.color"],
  ["用户气泡底色", "bubbleVariants.1.backgroundColor", "bubbleVariants.1.backgroundColor"],
  ["用户气泡字色", "bubbleVariants.1.color", "bubbleVariants.1.color"],
  ["用户气泡圆角", "bubbleVariants.1.borderRadius", "bubbleVariants.1.borderRadius"],
  ["assistant 变体底色", "bubbleVariants.0.backgroundColor", "bubbleVariants.0.backgroundColor"],
  ["气泡内高光 inset", "bubbleVariants.1.boxShadow", "bubbleVariants.1.boxShadow"],
  ["气泡 maxWidth", "bubble.maxWidth", "bubble.maxWidth"],
  ["正文字号", "bubble.fontSize", "bubble.fontSize"],
  ["正文字重", "bubble.fontWeight", "bubble.fontWeight"],
  ["正文行高", "bubble.lineHeight", "bubble.lineHeight"],
  ["作者名字号", "bubbleAuthorName.fontSize", "bubbleAuthorName.fontSize"],
  ["作者名字重", "bubbleAuthorName.fontWeight", "bubbleAuthorName.fontWeight"],
  ["作者名色", "bubbleAuthorName.color", "bubbleAuthorName.color"],
  ["流内头像尺寸", "bubbleAvatar.width", "bubbleAvatar.width"],
  ["流内头像圆角", "bubbleAvatar.borderRadius", "bubbleAvatar.borderRadius"],
  ["流内头像底色", "bubbleAvatar.backgroundColor", "bubbleAvatar.backgroundColor"],
  ["消息列宽列 max", "messageColumn.maxWidthRule", "messageColumn.maxWidthRule"],
  ["消息列 left", "messageColumn.left", "messageColumn.left"],
  ["消息列 width", "messageColumn.width", "messageColumn.width"],
  ["面板宽 paneWidth","messageColumn.paneWidth","messageColumn.paneWidth"],["行宽 rowWidth","messageColumn.rowWidth","messageColumn.rowWidth"],["行 left","messageColumn.row.left","messageColumn.row.left"],["两侧留白 sideMargin","messageColumn.sideMargin","messageColumn.sideMargin"],
  ["代码块宽", "messageColumn.codeBlock.width", "messageColumn.codeBlock.width"],
  ["代码块圆角", "messageColumn.codeBlock.borderRadius", "messageColumn.codeBlock.borderRadius"],
  ["代码块底色", "messageColumn.codeBlock.backgroundColor", "messageColumn.codeBlock.backgroundColor"],
  ["代码块字号", "messageColumn.codeBlock.fontSize", "messageColumn.codeBlock.fontSize"],
];

function rows(pairs) {
  const out = [];
  for (const [label, gp, bp] of pairs) {
    const g = at(G, gp);
    const b = at(B, bp);
    if (g === undefined && b === undefined) continue;
    const fmt = (v) => (v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
    out.push(`| ${label} | ${fmt(g)} | ${fmt(b)} | ${g === b ? "同值" : "差"} |`);
  }
  return out;
}

const SIDEBAR = [
  ["行高 height","sessionRow.height","sessionRow.height"],
  ["行宽 width","sessionRow.width","sessionRow.width"],
  ["行间距 interRowGap","sessionRow.interRowGap","sessionRow.interRowGap"],
  ["垂直节距 verticalPitch","sessionRow.verticalPitch","sessionRow.verticalPitch"],
  ["行圆角 radius","sessionRow.borderRadius","sessionRow.borderRadius"],
  ["行 padding","sessionRow.padding","sessionRow.padding"],
  ["行 gap（头像→文字）","sessionRow.gap","sessionRow.gap"],
  ["标题字号","sessionRow.title.fontSize","sessionRow.title.fontSize"],
  ["标题字重","sessionRow.title.fontWeight","sessionRow.title.fontWeight"],
  ["标题左起始","sessionRow.title.left","sessionRow.title.left"],
  ["预览字号","sessionRow.preview.fontSize","sessionRow.preview.fontSize"],
  ["预览字重","sessionRow.preview.fontWeight","sessionRow.preview.fontWeight"],
  ["预览色","sessionRow.preview.color","sessionRow.preview.color"],
  ["选中底色","sessionRow.activeRowBackground","sessionRow.activeRowBackground"],
  ["hover 底色","rowInteractionStates.hover.backgroundColor","rowInteractionStates.hoverBackgroundColor"],
  ["选中态底色","rowInteractionStates.selected.backgroundColor","rowInteractionStates.activeBackgroundColor"],
  ["分组标题容器高","groupLabel.height","groupLabel.height"],
  ["分组标题 padding","groupLabel.padding","groupLabel.padding"],
  ["分组标题字重","groupLabel.fontWeight","groupLabel.fontWeight"],
  ["分组文字字号","groupLabel.textSpan.fontSize","groupLabel.textSpan.fontSize"],
  ["分组文字色","groupLabel.textSpan.color","groupLabel.textSpan.color"],
  ["头像尺寸","avatar.width","avatar.width"],
  ["头像圆角","avatar.borderRadius","avatar.borderRadius"],
  ["头像底色","avatar.backgroundColor","avatar.backgroundColor"],
  ["头像 overflow","avatar.overflow","avatar.overflow"],
];

const md = process.argv[2] === "markdown";
if (md) {
  console.log("### 4.2 侧栏会话区（同一命令生成）");
  console.log("| 实测项 | Grok 真源 | 我方现状 | 判定 |");
  console.log("| --- | --- | --- | --- |");
  rows(SIDEBAR).forEach((r) => console.log(r));
  console.log("");
  console.log("| 实测项 | Grok 真源 | 我方现状 | 判定 |");
  console.log("| --- | --- | --- | --- |");
  rows(COMPOSER).forEach((r) => console.log(r));
  console.log("\n| 实测项 | Grok 真源 | 我方现状 | 判定 |");
  console.log("| --- | --- | --- | --- |");
  rows(FLOW).forEach((r) => console.log(r));
} else {
  rows([...COMPOSER, ...FLOW]).forEach((r) => console.log(r));
}
