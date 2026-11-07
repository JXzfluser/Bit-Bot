#!/usr/bin/env node
"use strict";

/**
 * import_grok_bot — CLI 壳。核心实现住在 `hosts/desktop/grok_import.js`。
 *
 * 为什么要分离：打包只带 hosts/desktop 与 hosts/shared（scripts/ 不进 app），
 * 而界面里的「从 Grok 搬过来」要用同一套逻辑。如果这里再写一份，就会出现
 * 「命令行能跑、界面搬出来不一样」——所以这里只做参数解析与打印。
 *
 * 用法：
 *   node scripts/import_grok_bot.js [--list] [--apply] [--json] [--limit N]
 *                                   [--source <目录>] [--data-root <目录>]
 */

const path = require("path");

const REPO = path.join(__dirname, "..");
const gi = require(path.join(REPO, "hosts/desktop/grok_import.js"));

/* ---------- CLI ---------- */

function parseArgv(argv) {
  const out = { source: gi.DEFAULT_SOURCE, apply: false, json: false, list: false, limit: 0, dataRoot: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") out.source = argv[++i] || gi.DEFAULT_SOURCE;
    else if (a === "--apply") out.apply = true;
    else if (a === "--json") out.json = true;
    else if (a === "--list") out.list = true;
    else if (a === "--limit") out.limit = Number(argv[++i]) || 0;
    else if (a === "--data-root") out.dataRoot = argv[++i] || "";
    else if (a === "-h" || a === "--help") out.help = true;
  }
  return out;
}

/** CLI 没有 Host 实例，只能自己造一份 store（界面走 Host，见 grok_import.applyPlan 注释）。 */
function makeStores(dataRoot) {
  const { createProductSurface } = require(path.join(REPO, "hosts/desktop/product_surface"));
  const { createSessionStore } = require(path.join(REPO, "hosts/desktop/sessions"));
  return {
    surface: createProductSurface(REPO, { dataRoot }),
    sessions: createSessionStore(REPO, { dataRoot }),
  };
}

async function main() {
  const args = parseArgv(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        "用法：node scripts/import_grok_bot.js [--list] [--apply] [--json] [--limit N] [--source <目录>]",
        "",
        "默认读本机 Grok Bot 的客户端持久化（~/Library/Application Support/Grok Bot/sand-client-persistence），",
        "预演不写盘；--apply 才写，写前把 bots/rooms/sessions 备份到 data/import-backup-<时间>/。",
        "幂等：迁过的 Grok id 记在 data/desktop/grok-import-map.json，再跑只报「已迁移」。",
        "界面入口：设置 → 从 Grok 搬过来（同一套实现）。",
      ].join("\n"),
    );
    process.exit(0);
  }

  const dataRoot = args.dataRoot || process.env.BITBOT_DATA_ROOT || path.join(REPO, "data");
  const store = gi.readStore(args.source);
  if (store.error) {
    console.error("找不到 Grok Bot 的本地数据目录：" + args.source);
    console.error("（请先确认 /Applications/Grok Bot.app 装过并至少登录打开过一次）");
    process.exit(2);
  }
  const plan = gi.planMigration(store, { limit: args.limit });
  if (plan.error) {
    console.error("这份本地数据里没有 roster：" + plan.error + "（可能还没登录过）");
    process.exit(2);
  }

  if (args.list) {
    console.log(`\n本机 Grok Bot：${plan.stats.roster_rows} 个条目（Bot ${plan.stats.bots} / 群 ${plan.stats.rooms} / 有内容的线程 ${plan.stats.sessions}）`);
    for (const b of plan.bots) console.log(`  · [Bot]  ${b.name}`);
    for (const r of plan.rooms) console.log(`  · [群]   ${r.title}（${r.member_grok_ids.length} 人）`);
    console.log("");
    process.exit(0);
  }

  if (args.json) {
    const out = {
      mode: args.apply ? "apply" : "dry_run",
      data_root: dataRoot,
      plan: {
        stats: plan.stats,
        skip_reasons: plan.skip_reasons,
        bots: plan.bots.map((b) => ({ grok_id: b.grok_id, name: b.name, job: b.job })),
        rooms: plan.rooms.map((r) => ({ grok_id: r.grok_id, title: r.title, members: r.member_grok_ids.length })),
        sessions: plan.sessions.map((s) => ({ grok_id: s.grok_id, title: s.title, messages: s.messages.length })),
      },
    };
    if (args.apply) {
      const stores = makeStores(dataRoot);
      out.applied = gi.applyPlan(plan, { dataRoot, ...stores, backup: gi.backupData });
      out.backup = out.applied.backup;
    }
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  console.log(`\n从本机 Grok Bot 迁到本项目（${args.apply ? "已写入" : "预演，未写入"}）`);
  console.log(`源：${plan.source}`);
  console.log(`库：${dataRoot}`);
  console.log(
    `读到 ${plan.stats.roster_rows} 个条目：Bot ${plan.stats.bots} / 群 ${plan.stats.rooms} / 线程 ${plan.stats.sessions}（共 ${plan.stats.messages} 条消息）`,
  );
  if (plan.stats.widget_converted) console.log(`  · 其中 ${plan.stats.widget_converted} 条是选项卡片，已转成文字（否则这些"下一步该选什么"会整段丢掉）`);
  if (plan.stats.skipped) {
    const detail = Object.entries(plan.skip_reasons).map(([k, n]) => `${k}×${n}`).join("、");
    console.log(`  · 跳过 ${plan.stats.skipped} 条（${detail}）`);
  }
  if (plan.stats.missing_members) console.log(`  · 有 ${plan.stats.missing_members} 个群成员在 roster 里叫不出名字（不会硬凑进群）`);

  console.log("\n要建的 Bot：");
  for (const b of plan.bots) console.log(`  · ${b.name}${b.job ? "　—　" + b.job : ""}`);
  if (plan.rooms.length) {
    console.log("\n要建的群：");
    for (const r of plan.rooms) console.log(`  · ${r.title}（${r.member_grok_ids.length} 人）`);
  }
  if (plan.sessions.length) {
    console.log("\n要建的会话（标题加 Grok · 前缀，方便和本机自己的对话分开）：");
    for (const s of plan.sessions.slice(0, 12)) console.log(`  · ${s.title}　${s.messages.length} 条`);
    if (plan.sessions.length > 12) console.log(`  · …另有 ${plan.sessions.length - 12} 个`);
  }

  if (!args.apply) {
    console.log("\n确认无误后加 --apply 真写（会先备份 bots/rooms/sessions）。");
    console.log("");
    process.exit(0);
  }

  const stores = makeStores(dataRoot);
  const applied = gi.applyPlan(plan, { dataRoot, ...stores, backup: gi.backupData });
  if (applied.backup) {
    console.log(`\n已备份：${applied.backup.dir}（${applied.backup.copied.length} 个文件）`);
  } else {
    console.log("\n没有新内容要写，未备份也未改盘（空跑不留痕迹）。");
  }
  console.log(`建好：Bot ${applied.bots.length} / 群 ${applied.rooms.length} / 会话 ${applied.sessions.length}；已存在跳过 ${applied.reused}`);
  if (applied.failed.length) {
    console.log("没建成（如实列出，没有假装成功）：");
    for (const f of applied.failed) {
      const title = f.title ? `「${f.title}」` : "";
      const detail = f.kind === "room"
        ? `（对得上 ${f.members} 人 / roster 里叫不出 ${f.missing} 人）`
        : "";
      const why = f.error === "members_too_few"
        ? "members_too_few —— Grok 那边这个群本来就只有 1 人，本机建群至少 2 人"
        : f.error;
      console.log(`  ✗ ${f.kind} ${String(f.grok_id).slice(0, 8)}…${title}　${why}${detail}`);
    }
  }
  console.log(`台账：${applied.ledger_path}`);
  console.log("");
}

// 旧用法（门禁/脚本 require 这个文件取纯函数）继续可用 —— 这里只是转发，
// 不复制实现。真正的实现只有 hosts/desktop/grok_import.js 一份。
module.exports = {
  decodeKey: gi.decodeKey,
  readStore: gi.readStore,
  readRoster: gi.readRoster,
  convertEntry: gi.convertEntry,
  blocksToText: gi.blocksToText,
  planMigration: gi.planMigration,
  DEFAULT_SOURCE: gi.DEFAULT_SOURCE,
};

if (require.main === module) {
  main().catch((e) => {
    console.error("import_grok_bot fatal:", e && e.message ? e.message : e);
    process.exit(1);
  });
}
