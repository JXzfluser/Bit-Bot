#!/usr/bin/env node
"use strict";
/** MCP product short-circuit residual-CLOSE suite (extracted from smoke_desktop_turn.sh). */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { createHostFfi } = require(path.join(
  __dirname,
  "..",
  "hosts",
  "shared",
  "host_ffi.js",
));
function sleep(ms){ return new Promise((r)=>setTimeout(r,ms)); }
function startMock(port, mode, token, empty) {
  const log =
    "/tmp/bitbot-mcp-" + mode + (empty ? "-empty" : "") + "-mock.log";
  try {
    require("child_process").execSync("fuser -k " + port + "/tcp", {
      stdio: "ignore",
    });
  } catch (_) {}
  const args = [
    path.join(process.cwd(), "scripts/host_local_http_mock.py"),
    "--port", String(port), "--mode", mode, "--token", token,
  ];
  if (empty) args.push("--empty");
  const child = spawn(process.env.PYTHON || "python3", args, {
    stdio: ["ignore", fs.openSync(log, "w"), fs.openSync(log, "a")],
  });
  return child;
}
function stripHostAppliedMarker(file) {
  try {
    const t = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      file,
      t
        .split(/\n/)
        .filter((ln) => !ln.includes("bitbot-host-applied"))
        .join("\n") + (t.endsWith("\n") ? "\n" : ""),
    );
  } catch (_) {}
}
(async () => {
  const ffi = createHostFfi(process.cwd());
  const slides = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.make_slides|{\"title\":\"Smoke Deck\"}" }]);
  const h = slides.find((r) => r && r.kind === "mcp_call");
  if (!h || !h.ok) throw new Error("slides mcp");
  const p = JSON.parse(h.stdout || "{}");
  if (p.mapped !== "host_slides_pptx" || p.product_tool_residual !== false) throw new Error(JSON.stringify(p).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-slides.json", JSON.stringify({ ok: true, ...p }, null, 2));
  console.log("mcp_call slides short-circuit ok", p.mapped, (p.slides||{}).pptx_path);
  const xs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.search_posts|{\"q\":\"smoke\"}" }]);
  const xh = xs.find((r) => r && r.kind === "mcp_call");
  const xp = JSON.parse((xh && xh.stdout) || "{}");
  if (xp.mapped !== "host_x_search" || xp.product_tool_residual !== false) throw new Error(JSON.stringify(xp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-x.json", JSON.stringify({ ok: true, ...xp }, null, 2));
  console.log("mcp_call x short-circuit ok", xp.mapped, (xp.x_search||{}).mode);
  const fins = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.get_balance|{}" }]);
  const fh = fins.find((r) => r && r.kind === "mcp_call");
  if (!fh || !fh.ok) throw new Error("finance mcp");
  const fp = JSON.parse(fh.stdout || "{}");
  if (fp.mapped !== "host_finance_call" || fp.product_tool_residual !== false) throw new Error(JSON.stringify(fp).slice(0,200));
  if (!(fp.finance||{}).path && !(fp.finance||{}).mode) throw new Error("finance payload: " + JSON.stringify(fp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-finance.json", JSON.stringify({ ok: true, ...fp }, null, 2));
  console.log("mcp_call finance short-circuit ok", fp.mapped, (fp.finance||{}).mode, (fp.finance||{}).path);
  const finStar = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.finance_list_accounts|{}" }]);
  const fsh = finStar.find((r) => r && r.kind === "mcp_call");
  const fsp = JSON.parse((fsh && fsh.stdout) || "{}");
  if (fsp.mapped !== "host_finance_call" || fsp.product_tool_residual !== false) throw new Error(JSON.stringify(fsp).slice(0,200));
  console.log("mcp_call finance_* short-circuit ok", fsp.mapped, (fsp.finance||{}).tool || fsp.tool);
  const jobs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.search_jobs|{\"q\":\"engineer\"}" }]);
  const jh = jobs.find((r) => r && r.kind === "mcp_call");
  if (!jh || !jh.ok) throw new Error("job mcp");
  const jp = JSON.parse(jh.stdout || "{}");
  if (jp.mapped !== "host_job_search" || jp.product_tool_residual !== false) throw new Error(JSON.stringify(jp).slice(0,200));
  if ((jp.job_search||{}).pretend_applied === true) throw new Error("pretend_applied");
  require("fs").writeFileSync("/tmp/bitbot-mcp-job.json", JSON.stringify({ ok: true, ...jp }, null, 2));
  console.log("mcp_call job short-circuit ok", jp.mapped, (jp.job_search||{}).mode, (jp.job_search||{}).hit_count);
  const jobsAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.job_search|{\"q\":\"pm\"}" }]);
  const jah = jobsAlias.find((r) => r && r.kind === "mcp_call");
  const jap = JSON.parse((jah && jah.stdout) || "{}");
  if (jap.mapped !== "host_job_search" || jap.product_tool_residual !== false) throw new Error(JSON.stringify(jap).slice(0,200));
  console.log("mcp_call job_search alias short-circuit ok", jap.mapped, (jap.job_search||{}).mode);
  const cals = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.create_event|{\"title\":\"MCP Sprint\",\"when\":\"tomorrow-3pm\"}" }]);
  const ch = cals.find((r) => r && r.kind === "mcp_call");
  if (!ch || !ch.ok) throw new Error("calendar mcp");
  const cp = JSON.parse(ch.stdout || "{}");
  if (cp.mapped !== "host_schedule_meeting" || cp.product_tool_residual !== false) throw new Error(JSON.stringify(cp).slice(0,200));
  if (!(cp.schedule||{}).ics_path && !(cp.schedule||{}).path) throw new Error("schedule payload: " + JSON.stringify(cp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-calendar.json", JSON.stringify({ ok: true, ...cp }, null, 2));
  console.log("mcp_call calendar short-circuit ok", cp.mapped, (cp.schedule||{}).mode, (cp.schedule||{}).ics_path);
  const calStar = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.calendar_create_event|{\"title\":\"CalStar\",\"when\":\"tomorrow-4pm\"}" }]);
  const csh = calStar.find((r) => r && r.kind === "mcp_call");
  const csp = JSON.parse((csh && csh.stdout) || "{}");
  if (csp.mapped !== "host_schedule_meeting" || csp.product_tool_residual !== false) throw new Error(JSON.stringify(csp).slice(0,200));
  console.log("mcp_call calendar_* short-circuit ok", csp.mapped, (csp.schedule||{}).mode || csp.tool);
  const schedAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.schedule_meeting|{\"title\":\"AliasMeet\",\"when\":\"friday\"}" }]);
  const sah = schedAlias.find((r) => r && r.kind === "mcp_call");
  const sap = JSON.parse((sah && sah.stdout) || "{}");
  if (sap.mapped !== "host_schedule_meeting" || sap.product_tool_residual !== false) throw new Error(JSON.stringify(sap).slice(0,200));
  console.log("mcp_call schedule_meeting alias short-circuit ok", sap.mapped, (sap.schedule||{}).mode);
  // Clear prior live purchase token so sandbox_receipt is not reclassified as live_charge.
  try { fs.unlinkSync("data/connectors/purchase_token.json"); } catch (_) {}
  delete process.env.BITBOT_PURCHASE_LIVE;
  delete process.env.BITBOT_PURCHASE_TOKEN;
  delete process.env.BITBOT_PURCHASE_API_URL;
  const buys = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.purchase_item|{\"item\":\"MCPWidget\",\"cents\":999}" }]);
  const bh = buys.find((r) => r && r.kind === "mcp_call");
  if (!bh || !bh.ok) throw new Error("purchase mcp");
  const bp = JSON.parse(bh.stdout || "{}");
  if (bp.mapped !== "host_purchase" || bp.product_tool_residual !== false) throw new Error(JSON.stringify(bp).slice(0,200));
  if ((bp.purchase||{}).pretend_paid === true) throw new Error("pretend_paid");
  if (!(bp.purchase||{}).receipt_path && !(bp.purchase||{}).path) throw new Error("purchase payload: " + JSON.stringify(bp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-purchase.json", JSON.stringify({ ok: true, ...bp }, null, 2));
  console.log("mcp_call purchase short-circuit ok", bp.mapped, (bp.purchase||{}).mode, (bp.purchase||{}).receipt_path);
  const buyStar = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.buy_widget|{\"item\":\"BuyStar\",\"cents\":499}" }]);
  const bsh = buyStar.find((r) => r && r.kind === "mcp_call");
  const bsp = JSON.parse((bsh && bsh.stdout) || "{}");
  if (bsp.mapped !== "host_purchase" || bsp.product_tool_residual !== false) throw new Error(JSON.stringify(bsp).slice(0,200));
  console.log("mcp_call buy_* short-circuit ok", bsp.mapped, (bsp.purchase||{}).mode || bsp.tool);
  const purchaseAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.purchase|{\"item\":\"AliasBuy\",\"cents\":100}" }]);
  const pah = purchaseAlias.find((r) => r && r.kind === "mcp_call");
  const pap = JSON.parse((pah && pah.stdout) || "{}");
  if (pap.mapped !== "host_purchase" || pap.product_tool_residual !== false) throw new Error(JSON.stringify(pap).slice(0,200));
  console.log("mcp_call purchase alias short-circuit ok", pap.mapped, (pap.purchase||{}).mode);
  // Mail send/read product short-circuit (sandbox; residual may stay open without live mock)
  delete process.env.BITBOT_MAIL_SEND;
  delete process.env.BITBOT_GMAIL_TOKEN;
  delete process.env.BITBOT_GMAIL_API_BASE;
  try { fs.unlinkSync("data/connectors/gmail_token.json"); } catch (_) {}
  const sends = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.send_mail|{\"to\":\"mcp@example.com\",\"subject\":\"MCP Send\",\"body\":\"hello\"}" }]);
  const sh = sends.find((r) => r && r.kind === "mcp_call");
  if (!sh || !sh.ok) throw new Error("mail_send mcp");
  const sp = JSON.parse(sh.stdout || "{}");
  if (sp.mapped !== "host_mail_send" || sp.product_tool_residual !== false) throw new Error(JSON.stringify(sp).slice(0,200));
  if ((sp.mail_send||{}).pretend_sent === true) throw new Error("pretend_sent");
  if (!(sp.mail_send||{}).eml_path && !(sp.mail_send||{}).path) throw new Error("mail_send payload: " + JSON.stringify(sp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-mail-send.json", JSON.stringify({ ok: true, ...sp }, null, 2));
  console.log("mcp_call mail_send short-circuit ok", sp.mapped, (sp.mail_send||{}).mode, (sp.mail_send||{}).eml_path);
  const sendAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.send_message|{\"to\":\"alias@example.com\",\"subject\":\"Alias\",\"body\":\"hi\"}" }]);
  const smah = sendAlias.find((r) => r && r.kind === "mcp_call");
  const smap = JSON.parse((smah && smah.stdout) || "{}");
  if (smap.mapped !== "host_mail_send" || smap.product_tool_residual !== false) throw new Error(JSON.stringify(smap).slice(0,200));
  console.log("mcp_call send_message alias short-circuit ok", smap.mapped, (smap.mail_send||{}).mode);
  const mailSendAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.mail_send|{\"to\":\"ms@example.com\",\"subject\":\"MS\",\"body\":\"ms\"}" }]);
  const msah = mailSendAlias.find((r) => r && r.kind === "mcp_call");
  const msap = JSON.parse((msah && msah.stdout) || "{}");
  if (msap.mapped !== "host_mail_send" || msap.product_tool_residual !== false) throw new Error(JSON.stringify(msap).slice(0,200));
  console.log("mcp_call mail_send alias short-circuit ok", msap.mapped, (msap.mail_send||{}).mode);
  const reads = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.mail_read|{\"thread_id\":\"t-invoice-1\"}" }]);
  const rh = reads.find((r) => r && r.kind === "mcp_call");
  if (!rh || !rh.ok) throw new Error("mail_read mcp");
  const rp = JSON.parse(rh.stdout || "{}");
  if (rp.mapped !== "host_mail_read" || rp.product_tool_residual !== false) throw new Error(JSON.stringify(rp).slice(0,200));
  if ((rp.mail_read||{}).pretend_live === true) throw new Error("pretend_live");
  if (!(rp.mail_read||{}).path) throw new Error("mail_read payload: " + JSON.stringify(rp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-mail-read.json", JSON.stringify({ ok: true, ...rp }, null, 2));
  console.log("mcp_call mail_read short-circuit ok", rp.mapped, (rp.mail_read||{}).mode, (rp.mail_read||{}).thread_id);
  const readAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.read_mail_thread|{\"id\":\"t-alias-1\"}" }]);
  const rah = readAlias.find((r) => r && r.kind === "mcp_call");
  const rap = JSON.parse((rah && rah.stdout) || "{}");
  if (rap.mapped !== "host_mail_read" || rap.product_tool_residual !== false) throw new Error(JSON.stringify(rap).slice(0,200));
  console.log("mcp_call read_mail_thread alias short-circuit ok", rap.mapped, (rap.mail_read||{}).thread_id);
  const getMsg = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.get_message|{\"message_id\":\"t-get-1\"}" }]);
  const gmh = getMsg.find((r) => r && r.kind === "mcp_call");
  const gmp = JSON.parse((gmh && gmh.stdout) || "{}");
  if (gmp.mapped !== "host_mail_read" || gmp.product_tool_residual !== false) throw new Error(JSON.stringify(gmp).slice(0,200));
  console.log("mcp_call get_message alias short-circuit ok", gmp.mapped, (gmp.mail_read||{}).thread_id);
  // Skill/export product short-circuit → host_skill_write / host_export_pack (no pretend_shared / secret echo)
  const skills = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.author_skill|{\"name\":\"mcp-author-skill\",\"description\":\"mcp smoke\",\"body\":\"Do the MCP thing.\"}" }]);
  const skh = skills.find((r) => r && r.kind === "mcp_call");
  if (!skh || !skh.ok) throw new Error("author_skill mcp");
  const skp = JSON.parse(skh.stdout || "{}");
  if (skp.mapped !== "host_skill_write" || skp.product_tool_residual !== false) throw new Error(JSON.stringify(skp).slice(0,200));
  if ((skp.skill_write||{}).pretend_shared === true) throw new Error("pretend_shared");
  if ((skp.skill_write||{}).persisted !== true) throw new Error("skill persisted: " + JSON.stringify(skp).slice(0,200));
  if (!(skp.skill_write||{}).path && !(skp.skill_write||{}).meta_path) throw new Error("skill payload: " + JSON.stringify(skp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-skill-write.json", JSON.stringify({ ok: true, ...skp }, null, 2));
  console.log("mcp_call author_skill short-circuit ok", skp.mapped, (skp.skill_write||{}).mode, (skp.skill_write||{}).path);
  const lfd = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.learn_from_demo|{\"title\":\"mcp-lfd\",\"steps_csv\":\"click:Cart,type:Buy\"}" }]);
  const lfh = lfd.find((r) => r && r.kind === "mcp_call");
  const lfp = JSON.parse((lfh && lfh.stdout) || "{}");
  if (lfp.mapped !== "host_skill_write" || lfp.product_tool_residual !== false) throw new Error(JSON.stringify(lfp).slice(0,200));
  if ((lfp.skill_write||{}).pretend_shared === true) throw new Error("pretend_shared lfd");
  console.log("mcp_call learn_from_demo alias short-circuit ok", lfp.mapped, (lfp.skill_write||{}).name);
  const swAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.skill_write|{\"name\":\"mcp-sw-alias\",\"description\":\"alias\",\"body\":\"alias body\"}" }]);
  const swah = swAlias.find((r) => r && r.kind === "mcp_call");
  const swap = JSON.parse((swah && swah.stdout) || "{}");
  if (swap.mapped !== "host_skill_write" || swap.product_tool_residual !== false) throw new Error(JSON.stringify(swap).slice(0,200));
  console.log("mcp_call skill_write alias short-circuit ok", swap.mapped, (swap.skill_write||{}).mode);
  const exports = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.export_bot_template|{\"bot_id\":\"mcp-bot-smoke\",\"name\":\"McpSmokeBot\"}" }]);
  const exh = exports.find((r) => r && r.kind === "mcp_call");
  if (!exh || !exh.ok) throw new Error("export_bot_template mcp");
  const exp = JSON.parse(exh.stdout || "{}");
  if (exp.mapped !== "host_export_pack" || exp.product_tool_residual !== false) throw new Error(JSON.stringify(exp).slice(0,200));
  if ((exp.export_pack||{}).secrets_stripped !== true) throw new Error("secrets_stripped: " + JSON.stringify(exp).slice(0,200));
  if ((exp.export_pack||{}).pretend_secrets_included === true) throw new Error("pretend_secrets_included");
  if (!(exp.export_pack||{}).path && !(exp.export_pack||{}).meta_path) throw new Error("export payload: " + JSON.stringify(exp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-export-pack.json", JSON.stringify({ ok: true, ...exp }, null, 2));
  console.log("mcp_call export_bot_template short-circuit ok", exp.mapped, (exp.export_pack||{}).mode, (exp.export_pack||{}).path);
  const epAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.export_pack|{\"bot_id\":\"mcp-pack-alias\",\"kind\":\"shareable-template\"}" }]);
  const epah = epAlias.find((r) => r && r.kind === "mcp_call");
  const epap = JSON.parse((epah && epah.stdout) || "{}");
  if (epap.mapped !== "host_export_pack" || epap.product_tool_residual !== false) throw new Error(JSON.stringify(epap).slice(0,200));
  if ((epap.export_pack||{}).pretend_secrets_included === true) throw new Error("pretend_secrets alias");
  console.log("mcp_call export_pack alias short-circuit ok", epap.mapped, (epap.export_pack||{}).mode);
  // code_changes/apply_patch + source_control/create_pr product short-circuit (gates stay honest)
  delete process.env.BITBOT_CODE_APPLY;
  delete process.env.BITBOT_CODE_COMMIT;
  delete process.env.BITBOT_CODE_PUSH;
  delete process.env.BITBOT_GIT_BIN;
  delete process.env.BITBOT_GH_CREATE_PR;
  delete process.env.BITBOT_GH_PR_CREATE;
  delete process.env.BITBOT_GH_BIN;
  const patches = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.apply_patch|{\"path\":\"README.mbt.md\"}" }]);
  const ph = patches.find((r) => r && r.kind === "mcp_call");
  if (!ph || !ph.ok) throw new Error("apply_patch mcp");
  const pp = JSON.parse(ph.stdout || "{}");
  if (pp.mapped !== "host_code_changes" || pp.product_tool_residual !== false) throw new Error(JSON.stringify(pp).slice(0,200));
  if ((pp.code_changes||{}).pretend_committed === true) throw new Error("pretend_committed");
  if ((pp.code_changes||{}).pretend_pushed === true) throw new Error("pretend_pushed");
  if ((pp.code_changes||{}).applied === true) throw new Error("ungated applied");
  if ((pp.code_changes||{}).code_apply_residual !== true) throw new Error("code_apply_residual: " + JSON.stringify(pp.code_changes||{}).slice(0,200));
  if (!(pp.code_changes||{}).path) throw new Error("code_changes payload: " + JSON.stringify(pp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-apply-patch.json", JSON.stringify({ ok: true, ...pp }, null, 2));
  console.log("mcp_call apply_patch short-circuit ok", pp.mapped, (pp.code_changes||{}).code_apply_residual, (pp.code_changes||{}).path);
  const codeAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.code_changes|{\"path\":\"README.mbt.md\"}" }]);
  const cahCode = codeAlias.find((r) => r && r.kind === "mcp_call");
  const capCode = JSON.parse((cahCode && cahCode.stdout) || "{}");
  if (capCode.mapped !== "host_code_changes" || capCode.product_tool_residual !== false) throw new Error(JSON.stringify(capCode).slice(0,200));
  console.log("mcp_call code_changes alias short-circuit ok", capCode.mapped, (capCode.code_changes||{}).code_apply_residual);
  const slashPatch = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.code_changes/apply_patch|{\"path\":\"README.mbt.md\"}" }]);
  const sph = slashPatch.find((r) => r && r.kind === "mcp_call");
  const spp = JSON.parse((sph && sph.stdout) || "{}");
  if (spp.mapped !== "host_code_changes" || spp.product_tool_residual !== false) throw new Error(JSON.stringify(spp).slice(0,200));
  console.log("mcp_call code_changes/apply_patch short-circuit ok", spp.mapped, (spp.code_changes||{}).code_apply_residual);
  const prs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.create_pr|{}" }]);
  const prh = prs.find((r) => r && r.kind === "mcp_call");
  if (!prh || !prh.ok) throw new Error("create_pr mcp");
  const prp = JSON.parse(prh.stdout || "{}");
  if (prp.mapped !== "host_source_control" || prp.product_tool_residual !== false) throw new Error(JSON.stringify(prp).slice(0,200));
  if ((prp.source_control||{}).pretend_remote_pr === true) throw new Error("pretend_remote_pr");
  if ((prp.source_control||{}).remote_pr_residual !== true) throw new Error("remote_pr_residual: " + JSON.stringify(prp.source_control||{}).slice(0,200));
  if (!(prp.source_control||{}).path && !(prp.source_control||{}).status_path) throw new Error("source_control payload: " + JSON.stringify(prp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-create-pr.json", JSON.stringify({ ok: true, ...prp }, null, 2));
  console.log("mcp_call create_pr short-circuit ok", prp.mapped, (prp.source_control||{}).mode, (prp.source_control||{}).remote_pr_residual);
  const slashPr = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.source_control/create_pr|{}" }]);
  const sprh = slashPr.find((r) => r && r.kind === "mcp_call");
  const sprp = JSON.parse((sprh && sprh.stdout) || "{}");
  if (sprp.mapped !== "host_source_control" || sprp.product_tool_residual !== false) throw new Error(JSON.stringify(sprp).slice(0,200));
  if ((sprp.source_control||{}).pretend_remote_pr === true) throw new Error("pretend_remote_pr slash");
  console.log("mcp_call source_control/create_pr short-circuit ok", sprp.mapped, (sprp.source_control||{}).remote_pr_residual);
  // list_workflows / cold_mail / send_on_behalf / identity_browser product short-circuit
  const wfs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.list_workflows|{\"names\":[\"mcp-wf-a\",\"mcp-wf-b\"]}" }]);
  const wfh = wfs.find((r) => r && r.kind === "mcp_call");
  if (!wfh || !wfh.ok) throw new Error("list_workflows mcp");
  const wfp = JSON.parse(wfh.stdout || "{}");
  if (wfp.mapped !== "host_workflow_list" || wfp.product_tool_residual !== false) throw new Error(JSON.stringify(wfp).slice(0,200));
  if ((wfp.workflow_list||{}).pretend_shared === true) throw new Error("pretend_shared");
  if (!(wfp.workflow_list||{}).path || !(wfp.workflow_list||{}).catalog_path) throw new Error("workflow_list payload: " + JSON.stringify(wfp).slice(0,200));
  if (!((wfp.workflow_list||{}).count >= 1)) throw new Error("workflow count: " + JSON.stringify(wfp.workflow_list||{}).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-list-workflows.json", JSON.stringify({ ok: true, ...wfp }, null, 2));
  console.log("mcp_call list_workflows short-circuit ok", wfp.mapped, (wfp.workflow_list||{}).mode, (wfp.workflow_list||{}).count);
  const wfAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.user_workflows|{\"name\":\"mcp-alias-wf\"}" }]);
  const wfah = wfAlias.find((r) => r && r.kind === "mcp_call");
  const wfap = JSON.parse((wfah && wfah.stdout) || "{}");
  if (wfap.mapped !== "host_workflow_list" || wfap.product_tool_residual !== false) throw new Error(JSON.stringify(wfap).slice(0,200));
  console.log("mcp_call user_workflows alias short-circuit ok", wfap.mapped, (wfap.workflow_list||{}).count);
  const wfSlash = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.workflows_list|{\"workflows\":\"mcp-slash-a,mcp-slash-b\"}" }]);
  const wfsh = wfSlash.find((r) => r && r.kind === "mcp_call");
  const wfsp = JSON.parse((wfsh && wfsh.stdout) || "{}");
  if (wfsp.mapped !== "host_workflow_list" || wfsp.product_tool_residual !== false) throw new Error(JSON.stringify(wfsp).slice(0,200));
  console.log("mcp_call workflows_list alias short-circuit ok", wfsp.mapped, (wfsp.workflow_list||{}).count);
  delete process.env.BITBOT_MAIL_SEND;
  delete process.env.BITBOT_COLD_MAIL_API_URL;
  delete process.env.BITBOT_COLD_MAIL_TOKEN;
  delete process.env.BITBOT_ONBEHALF_MAIL_API_URL;
  delete process.env.BITBOT_ONBEHALF_MAIL_TOKEN;
  const colds = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.cold_mail|{\"to\":\"mcp-cold@example.com\",\"subject\":\"MCP Cold\",\"body\":\"hello cold\",\"unsubscribe\":\"mailto:u@example.com\"}" }]);
  const coldh = colds.find((r) => r && r.kind === "mcp_call");
  if (!coldh || !coldh.ok) throw new Error("cold_mail mcp");
  const coldp = JSON.parse(coldh.stdout || "{}");
  if (coldp.mapped !== "host_mail_send" || coldp.product_tool_residual !== false) throw new Error(JSON.stringify(coldp).slice(0,200));
  if ((coldp.mail_send||{}).provider !== "cold") throw new Error("cold provider: " + JSON.stringify(coldp.mail_send||{}).slice(0,200));
  if ((coldp.mail_send||{}).pretend_sent === true) throw new Error("pretend_sent cold");
  if ((coldp.mail_send||{}).live_mail_residual !== true) throw new Error("live_mail_residual must stay gated: " + JSON.stringify(coldp.mail_send||{}).slice(0,200));
  if (!(coldp.mail_send||{}).eml_path && !(coldp.mail_send||{}).path) throw new Error("cold_mail payload: " + JSON.stringify(coldp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-cold-mail.json", JSON.stringify({ ok: true, ...coldp }, null, 2));
  console.log("mcp_call cold_mail short-circuit ok", coldp.mapped, (coldp.mail_send||{}).mode, (coldp.mail_send||{}).live_mail_residual);
  const sobs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.send_on_behalf|{\"to\":\"mcp-sob@example.com\",\"subject\":\"MCP SOB\",\"body\":\"hello sob\"}" }]);
  const sobh = sobs.find((r) => r && r.kind === "mcp_call");
  if (!sobh || !sobh.ok) throw new Error("send_on_behalf mcp");
  const sobp = JSON.parse(sobh.stdout || "{}");
  if (sobp.mapped !== "host_mail_send" || sobp.product_tool_residual !== false) throw new Error(JSON.stringify(sobp).slice(0,200));
  if ((sobp.mail_send||{}).provider !== "onbehalf") throw new Error("onbehalf provider: " + JSON.stringify(sobp.mail_send||{}).slice(0,200));
  if ((sobp.mail_send||{}).pretend_sent === true) throw new Error("pretend_sent sob");
  if ((sobp.mail_send||{}).live_mail_residual !== true) throw new Error("live_mail_residual must stay gated sob: " + JSON.stringify(sobp.mail_send||{}).slice(0,200));
  if (!(sobp.mail_send||{}).eml_path && !(sobp.mail_send||{}).path) throw new Error("send_on_behalf payload: " + JSON.stringify(sobp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-send-on-behalf.json", JSON.stringify({ ok: true, ...sobp }, null, 2));
  console.log("mcp_call send_on_behalf short-circuit ok", sobp.mapped, (sobp.mail_send||{}).mode, (sobp.mail_send||{}).live_mail_residual);
  const ids = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.identity_browser|{}" }]);
  const idh = ids.find((r) => r && r.kind === "mcp_call");
  if (!idh || !idh.ok) throw new Error("identity_browser mcp");
  const idp = JSON.parse(idh.stdout || "{}");
  if (idp.mapped !== "host_identity_browser" || idp.product_tool_residual !== false) throw new Error(JSON.stringify(idp).slice(0,200));
  if ((idp.identity_browser||{}).connected === true) throw new Error("never pretend Connected");
  if ((idp.identity_browser||{}).pretend_connected_slack === true) throw new Error("pretend_connected_slack");
  if ((idp.identity_browser||{}).connector !== "identity-browser") throw new Error("connector: " + JSON.stringify(idp.identity_browser||{}).slice(0,200));
  if ((idp.identity_browser||{}).mode !== "identity_browser_switch") throw new Error("mode: " + JSON.stringify(idp.identity_browser||{}).slice(0,200));
  if (!(idp.identity_browser||{}).session_path || !(idp.identity_browser||{}).user_data_dir) throw new Error("identity payload: " + JSON.stringify(idp).slice(0,200));
  if ((idp.identity_browser||{}).switched !== true) throw new Error("switched: " + JSON.stringify(idp.identity_browser||{}).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-identity-browser.json", JSON.stringify({ ok: true, ...idp }, null, 2));
  console.log("mcp_call identity_browser short-circuit ok", idp.mapped, (idp.identity_browser||{}).mode, (idp.identity_browser||{}).connected);
  const idAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.switch_identity_browser|{}" }]);
  const idah = idAlias.find((r) => r && r.kind === "mcp_call");
  const idap = JSON.parse((idah && idah.stdout) || "{}");
  if (idap.mapped !== "host_identity_browser" || idap.product_tool_residual !== false) throw new Error(JSON.stringify(idap).slice(0,200));
  if ((idap.identity_browser||{}).connected === true) throw new Error("never pretend Connected alias");
  if ((idap.identity_browser||{}).pretend_connected_slack === true) throw new Error("pretend_connected_slack alias");
  console.log("mcp_call switch_identity_browser alias short-circuit ok", idap.mapped, (idap.identity_browser||{}).connected);
  // load_skill / claim_inbox / fill_credential / list_credentials product short-circuit
  const loads = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.load_skill|{\"task\":\"mcp-load-skill\",\"loaded_count\":2}" }]);
  const loadh = loads.find((r) => r && r.kind === "mcp_call");
  if (!loadh || !loadh.ok) throw new Error("load_skill mcp");
  const loadp = JSON.parse(loadh.stdout || "{}");
  if (loadp.mapped !== "host_skill_load" || loadp.product_tool_residual !== false) throw new Error(JSON.stringify(loadp).slice(0,200));
  if ((loadp.skill_load||{}).mode !== "host_skill_load") throw new Error("skill_load mode: " + JSON.stringify(loadp.skill_load||{}).slice(0,200));
  if ((loadp.skill_load||{}).pretend_loaded === true) throw new Error("pretend_loaded");
  if (!(loadp.skill_load||{}).path) throw new Error("skill_load path: " + JSON.stringify(loadp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-load-skill.json", JSON.stringify({ ok: true, ...loadp }, null, 2));
  console.log("mcp_call load_skill short-circuit ok", loadp.mapped, (loadp.skill_load||{}).mode, (loadp.skill_load||{}).path);
  const loadAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.skill_load|{\"name\":\"mcp-skill-alias\",\"count\":1}" }]);
  const loada = loadAlias.find((r) => r && r.kind === "mcp_call");
  const loadap = JSON.parse((loada && loada.stdout) || "{}");
  if (loadap.mapped !== "host_skill_load" || loadap.product_tool_residual !== false) throw new Error(JSON.stringify(loadap).slice(0,200));
  console.log("mcp_call skill_load alias short-circuit ok", loadap.mapped, (loadap.skill_load||{}).task);
  delete process.env.BITBOT_MAIL_CLAIM_API_URL;
  delete process.env.BITBOT_MAIL_CLAIM_TOKEN;
  delete process.env.BITBOT_MAIL_CLAIM_POST;
  const claims = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.claim_inbox|{\"local_part\":\"mcpclaim\",\"address\":\"mcpclaim@bitbot.local\"}" }]);
  const claimh = claims.find((r) => r && r.kind === "mcp_call");
  if (!claimh || !claimh.ok) throw new Error("claim_inbox mcp");
  const claimp = JSON.parse(claimh.stdout || "{}");
  if (claimp.mapped !== "host_mail_claim_inbox" || claimp.product_tool_residual !== false) throw new Error(JSON.stringify(claimp).slice(0,200));
  if ((claimp.mail_claim||{}).pretend_claimed === true) throw new Error("pretend_claimed");
  if ((claimp.mail_claim||{}).live_mail_claim_residual !== true) throw new Error("live_mail_claim_residual must stay gated: " + JSON.stringify(claimp.mail_claim||{}).slice(0,200));
  if (!((claimp.mail_claim||{}).claimed_count >= 1)) throw new Error("claimed_count: " + JSON.stringify(claimp.mail_claim||{}).slice(0,200));
  if (!(claimp.mail_claim||{}).path && !(claimp.mail_claim||{}).fixture_path) throw new Error("mail_claim payload: " + JSON.stringify(claimp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-claim-inbox.json", JSON.stringify({ ok: true, ...claimp }, null, 2));
  console.log("mcp_call claim_inbox short-circuit ok", claimp.mapped, (claimp.mail_claim||{}).mode, (claimp.mail_claim||{}).live_mail_claim_residual);
  const claimAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.mail_claim_inbox|{\"local_part\":\"mcpclaim2\"}" }]);
  const claima = claimAlias.find((r) => r && r.kind === "mcp_call");
  const claimap = JSON.parse((claima && claima.stdout) || "{}");
  if (claimap.mapped !== "host_mail_claim_inbox" || claimap.product_tool_residual !== false) throw new Error(JSON.stringify(claimap).slice(0,200));
  if ((claimap.mail_claim||{}).live_mail_claim_residual !== true) throw new Error("live_mail_claim_residual alias gated");
  console.log("mcp_call mail_claim_inbox alias short-circuit ok", claimap.mapped, (claimap.mail_claim||{}).local_part);
  const claimMail = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.claim_mail|{\"inbox\":\"mcpclaim3\"}" }]);
  const claimmh = claimMail.find((r) => r && r.kind === "mcp_call");
  const claimmp = JSON.parse((claimmh && claimmh.stdout) || "{}");
  if (claimmp.mapped !== "host_mail_claim_inbox" || claimmp.product_tool_residual !== false) throw new Error(JSON.stringify(claimmp).slice(0,200));
  console.log("mcp_call claim_mail alias short-circuit ok", claimmp.mapped, (claimmp.mail_claim||{}).live_mail_claim_residual);
  const credLists = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.list_credentials|{}" }]);
  const clh = credLists.find((r) => r && r.kind === "mcp_call");
  if (!clh || !clh.ok) throw new Error("list_credentials mcp");
  const clp = JSON.parse(clh.stdout || "{}");
  if (clp.mapped !== "host_credential_list" || clp.product_tool_residual !== false) throw new Error(JSON.stringify(clp).slice(0,200));
  if (clp.secret_echoed === true || (clp.credential_list||{}).secret_echoed === true) throw new Error("secret_echoed list");
  if (clp.pretend_secret_echo === true || (clp.credential_list||{}).pretend_secret_echo === true) throw new Error("pretend_secret_echo list");
  if (!((clp.credential_list||{}).count >= 1)) throw new Error("credential_list count: " + JSON.stringify(clp.credential_list||{}).slice(0,200));
  if (/vault:secret/i.test(JSON.stringify(clp))) throw new Error("secret leak list");
  require("fs").writeFileSync("/tmp/bitbot-mcp-list-credentials.json", JSON.stringify({ ok: true, ...clp }, null, 2));
  console.log("mcp_call list_credentials short-circuit ok", clp.mapped, (clp.credential_list||{}).mode, (clp.credential_list||{}).count);
  const credListAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.credential_list|{}" }]);
  const clah = credListAlias.find((r) => r && r.kind === "mcp_call");
  const clap = JSON.parse((clah && clah.stdout) || "{}");
  if (clap.mapped !== "host_credential_list" || clap.product_tool_residual !== false) throw new Error(JSON.stringify(clap).slice(0,200));
  console.log("mcp_call credential_list alias short-circuit ok", clap.mapped, (clap.credential_list||{}).count);
  const fills = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.fill_credential|{\"fill_handle\":\"mcp-fill-1\",\"domain\":\"login.example.test\",\"username\":\"mcp@example.test\"}" }]);
  const fillh = fills.find((r) => r && r.kind === "mcp_call");
  if (!fillh || !fillh.ok) throw new Error("fill_credential mcp");
  const fillp = JSON.parse(fillh.stdout || "{}");
  if (fillp.mapped !== "host_credential_fill" || fillp.product_tool_residual !== false) throw new Error(JSON.stringify(fillp).slice(0,200));
  if (fillp.secret_echoed === true || (fillp.credential_fill||{}).secret_echoed === true) throw new Error("secret_echoed fill");
  if (fillp.pretend_secret_echo === true || (fillp.credential_fill||{}).pretend_secret_echo === true) throw new Error("pretend_secret_echo fill");
  if (fillp.signin_fill_residual !== true || (fillp.credential_fill||{}).signin_fill_residual !== true) throw new Error("signin_fill_residual must stay true: " + JSON.stringify(fillp).slice(0,200));
  if ((fillp.credential_fill||{}).pretend_secret_view === true) throw new Error("pretend_secret_view");
  if (!(fillp.credential_fill||{}).path || !(fillp.credential_fill||{}).vault_path) throw new Error("fill payload: " + JSON.stringify(fillp).slice(0,200));
  if (/vault:secret/i.test(JSON.stringify(fillp))) throw new Error("secret leak fill");
  require("fs").writeFileSync("/tmp/bitbot-mcp-fill-credential.json", JSON.stringify({ ok: true, ...fillp }, null, 2));
  console.log("mcp_call fill_credential short-circuit ok", fillp.mapped, (fillp.credential_fill||{}).mode, fillp.signin_fill_residual);
  const fillAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.credential_fill|{\"handle\":\"mcp-fill-2\",\"domain\":\"login.example.test\",\"user\":\"alias@example.test\"}" }]);
  const filla = fillAlias.find((r) => r && r.kind === "mcp_call");
  const fillap = JSON.parse((filla && filla.stdout) || "{}");
  if (fillap.mapped !== "host_credential_fill" || fillap.product_tool_residual !== false) throw new Error(JSON.stringify(fillap).slice(0,200));
  if (fillap.signin_fill_residual !== true) throw new Error("signin_fill_residual alias");
  if (fillap.secret_echoed === true) throw new Error("secret_echoed alias");
  console.log("mcp_call credential_fill alias short-circuit ok", fillap.mapped, (fillap.credential_fill||{}).mode, fillap.signin_fill_residual);
  // spawn_subagent / create_teammate / room_turn / send_to_agent product short-circuit
  const subs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.spawn_subagent|{\"id\":\"sub-mcp-smoke\",\"prompt\":\"mcp subagent smoke\"}" }]);
  const subh = subs.find((r) => r && r.kind === "mcp_call");
  if (!subh || !subh.ok) throw new Error("spawn_subagent mcp");
  const subp = JSON.parse(subh.stdout || "{}");
  if (subp.mapped !== "host_subagent_run" || subp.product_tool_residual !== false) throw new Error(JSON.stringify(subp).slice(0,200));
  if ((subp.subagent||{}).pretend_completed === true) throw new Error("pretend_completed");
  if (!(subp.subagent||{}).path) throw new Error("subagent path: " + JSON.stringify(subp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-spawn-subagent.json", JSON.stringify({ ok: true, ...subp }, null, 2));
  console.log("mcp_call spawn_subagent short-circuit ok", subp.mapped, (subp.subagent||{}).mode, (subp.subagent||{}).path);
  const subAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.subagent_run|{\"id\":\"sub-mcp-alias\",\"prompt\":\"alias sub\"}" }]);
  const subah = subAlias.find((r) => r && r.kind === "mcp_call");
  const subap = JSON.parse((subah && subah.stdout) || "{}");
  if (subap.mapped !== "host_subagent_run" || subap.product_tool_residual !== false) throw new Error(JSON.stringify(subap).slice(0,200));
  console.log("mcp_call subagent_run alias short-circuit ok", subap.mapped, (subap.subagent||{}).mode);
  const tms = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.create_teammate|{\"id\":\"asst-mcp-smoke\",\"name\":\"McpSmoke\",\"role\":\"executor\"}" }]);
  const tmh = tms.find((r) => r && r.kind === "mcp_call");
  if (!tmh || !tmh.ok) throw new Error("create_teammate mcp");
  const tmp = JSON.parse(tmh.stdout || "{}");
  if (tmp.mapped !== "host_teammate_create" || tmp.product_tool_residual !== false) throw new Error(JSON.stringify(tmp).slice(0,200));
  if ((tmp.teammate||{}).pretend_created === true) throw new Error("pretend_created");
  if ((tmp.teammate||{}).appears_in_members !== true) throw new Error("appears_in_members: " + JSON.stringify(tmp.teammate||{}).slice(0,200));
  if (!(tmp.teammate||{}).path) throw new Error("teammate path: " + JSON.stringify(tmp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-create-teammate.json", JSON.stringify({ ok: true, ...tmp }, null, 2));
  console.log("mcp_call create_teammate short-circuit ok", tmp.mapped, (tmp.teammate||{}).mode, (tmp.teammate||{}).appears_in_members);
  const tmAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.teammate_create|{\"id\":\"asst-mcp-alias\",\"name\":\"Alias\",\"role\":\"researcher\"}" }]);
  const tmah = tmAlias.find((r) => r && r.kind === "mcp_call");
  const tmap = JSON.parse((tmah && tmah.stdout) || "{}");
  if (tmap.mapped !== "host_teammate_create" || tmap.product_tool_residual !== false) throw new Error(JSON.stringify(tmap).slice(0,200));
  console.log("mcp_call teammate_create alias short-circuit ok", tmap.mapped, (tmap.teammate||{}).mode);
  const rooms = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.room_turn|{\"room\":\"mcp-room\",\"body\":\"hello room\"}" }]);
  const roomh = rooms.find((r) => r && r.kind === "mcp_call");
  if (!roomh || !roomh.ok) throw new Error("room_turn mcp");
  const roomp = JSON.parse(roomh.stdout || "{}");
  if (roomp.mapped !== "host_room_turn" || roomp.product_tool_residual !== false) throw new Error(JSON.stringify(roomp).slice(0,200));
  if ((roomp.room_turn||{}).pretend_private_dm === true) throw new Error("pretend_private_dm");
  if ((roomp.room_turn||{}).is_room !== true) throw new Error("is_room: " + JSON.stringify(roomp.room_turn||{}).slice(0,200));
  if (!(roomp.room_turn||{}).path) throw new Error("room_turn path: " + JSON.stringify(roomp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-room-turn.json", JSON.stringify({ ok: true, ...roomp }, null, 2));
  console.log("mcp_call room_turn short-circuit ok", roomp.mapped, (roomp.room_turn||{}).mode, (roomp.room_turn||{}).member_count);
  const agentSends = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.send_to_agent|{\"to_id\":\"asst-mcp-smoke\",\"body\":\"mcp wake\"}" }]);
  const sendh = agentSends.find((r) => r && r.kind === "mcp_call");
  if (!sendh || !sendh.ok) throw new Error("send_to_agent mcp");
  const sendp = JSON.parse(sendh.stdout || "{}");
  if (sendp.mapped !== "host_send_to_agent" || sendp.product_tool_residual !== false) throw new Error(JSON.stringify(sendp).slice(0,200));
  if ((sendp.send_to_agent||{}).pretend_delivered === true) throw new Error("pretend_delivered");
  if ((sendp.send_to_agent||{}).routed !== true) throw new Error("routed: " + JSON.stringify(sendp.send_to_agent||{}).slice(0,200));
  if (!(sendp.send_to_agent||{}).path) throw new Error("send_to_agent path: " + JSON.stringify(sendp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-send-to-agent.json", JSON.stringify({ ok: true, ...sendp }, null, 2));
  console.log("mcp_call send_to_agent short-circuit ok", sendp.mapped, (sendp.send_to_agent||{}).mode, (sendp.send_to_agent||{}).status);
  // launch_cloud_agent / deliver_cloud_artifact product short-circuit (remote residuals stay gated)
  delete process.env.BITBOT_CLOUD_API_URL;
  delete process.env.BITBOT_CURSOR_CLOUD_TOKEN;
  delete process.env.BITBOT_CLOUD_API_TOKEN;
  delete process.env.BITBOT_CLOUD_ARTIFACT_FETCH;
  const clouds = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.launch_cloud_agent|{\"bc_id\":\"bc-mcp-smoke\",\"prompt\":\"mcp cloud smoke\"}" }]);
  const cloudh = clouds.find((r) => r && r.kind === "mcp_call");
  if (!cloudh || !cloudh.ok) throw new Error("launch_cloud_agent mcp");
  const cloudp = JSON.parse(cloudh.stdout || "{}");
  if (cloudp.mapped !== "host_cloud_agent_launch" || cloudp.product_tool_residual !== false) throw new Error(JSON.stringify(cloudp).slice(0,200));
  if ((cloudp.cloud_launch||{}).pretend_remote_cloud === true) throw new Error("pretend_remote_cloud");
  if ((cloudp.cloud_launch||{}).remote_cloud_residual !== true) throw new Error("remote_cloud_residual must stay gated: " + JSON.stringify(cloudp.cloud_launch||{}).slice(0,200));
  if (!(cloudp.cloud_launch||{}).path) throw new Error("cloud_launch path: " + JSON.stringify(cloudp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-launch-cloud.json", JSON.stringify({ ok: true, ...cloudp }, null, 2));
  console.log("mcp_call launch_cloud_agent short-circuit ok", cloudp.mapped, (cloudp.cloud_launch||{}).mode, (cloudp.cloud_launch||{}).remote_cloud_residual);
  const cloudAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.cloud_agent_launch|{\"bc_id\":\"bc-mcp-alias\",\"prompt\":\"alias cloud\"}" }]);
  const cloudah = cloudAlias.find((r) => r && r.kind === "mcp_call");
  const cloudap = JSON.parse((cloudah && cloudah.stdout) || "{}");
  if (cloudap.mapped !== "host_cloud_agent_launch" || cloudap.product_tool_residual !== false) throw new Error(JSON.stringify(cloudap).slice(0,200));
  if ((cloudap.cloud_launch||{}).remote_cloud_residual !== true) throw new Error("remote_cloud_residual alias gated");
  console.log("mcp_call cloud_agent_launch alias short-circuit ok", cloudap.mapped, (cloudap.cloud_launch||{}).bc_id);
  const arts = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.deliver_cloud_artifact|{\"bc_id\":\"bc-mcp-smoke\",\"dest\":\"mcp-cloud-smoke.md\"}" }]);
  const arth = arts.find((r) => r && r.kind === "mcp_call");
  if (!arth || !arth.ok) throw new Error("deliver_cloud_artifact mcp");
  const artp = JSON.parse(arth.stdout || "{}");
  if (artp.mapped !== "host_cloud_artifact_deliver" || artp.product_tool_residual !== false) throw new Error(JSON.stringify(artp).slice(0,200));
  if ((artp.cloud_artifact||{}).pretend_remote_fetch === true) throw new Error("pretend_remote_fetch");
  if ((artp.cloud_artifact||{}).pretend_delivered === true) throw new Error("pretend_delivered artifact");
  // from_session after launch closes remote_cloud_artifact_residual; without session it stays gated
  if (!(artp.cloud_artifact||{}).path && !(artp.cloud_artifact||{}).meta_path) throw new Error("cloud_artifact path: " + JSON.stringify(artp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-deliver-cloud.json", JSON.stringify({ ok: true, ...artp }, null, 2));
  console.log("mcp_call deliver_cloud_artifact short-circuit ok", artp.mapped, (artp.cloud_artifact||{}).mode, (artp.cloud_artifact||{}).remote_cloud_artifact_residual);
  const artAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.cloud_artifact_deliver|{\"artifact\":\"bc-mcp-alias\",\"dest\":\"mcp-cloud-alias.md\"}" }]);
  const artah = artAlias.find((r) => r && r.kind === "mcp_call");
  const artap = JSON.parse((artah && artah.stdout) || "{}");
  if (artap.mapped !== "host_cloud_artifact_deliver" || artap.product_tool_residual !== false) throw new Error(JSON.stringify(artap).slice(0,200));
  console.log("mcp_call cloud_artifact_deliver alias short-circuit ok", artap.mapped, (artap.cloud_artifact||{}).mode);
  // voice_start / voice_relay / voice_end product short-circuit (STT/TTS/end-match residuals stay gated)
  delete process.env.BITBOT_VOICE_STT;
  delete process.env.BITBOT_STT_BIN;
  delete process.env.BITBOT_ESPEAK_BIN;
  const voices = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.voice_start|{\"call_id\":\"mcp-voice-smoke\"}" }]);
  const voiceh = voices.find((r) => r && r.kind === "mcp_call");
  if (!voiceh || !voiceh.ok) throw new Error("voice_start mcp");
  const voicep = JSON.parse(voiceh.stdout || "{}");
  if (voicep.mapped !== "host_voice_session" || voicep.product_tool_residual !== false) throw new Error(JSON.stringify(voicep).slice(0,200));
  if ((voicep.voice_session||{}).pretend_live === true) throw new Error("pretend_live");
  if ((voicep.voice_session||{}).pretend_media === true) throw new Error("pretend_media voice");
  if ((voicep.voice_session||{}).voice_stt_residual !== true) throw new Error("voice_stt_residual must stay gated: " + JSON.stringify(voicep.voice_session||{}).slice(0,200));
  if ((voicep.voice_session||{}).voice_tts_residual !== true) throw new Error("voice_tts_residual must stay gated: " + JSON.stringify(voicep.voice_session||{}).slice(0,200));
  if (!(voicep.voice_session||{}).path) throw new Error("voice_session path: " + JSON.stringify(voicep).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-voice-start.json", JSON.stringify({ ok: true, ...voicep }, null, 2));
  console.log("mcp_call voice_start short-circuit ok", voicep.mapped, (voicep.voice_session||{}).mode, (voicep.voice_session||{}).voice_stt_residual);
  const voiceAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.voice_session|{\"call_id\":\"mcp-voice-alias\"}" }]);
  const voiceah = voiceAlias.find((r) => r && r.kind === "mcp_call");
  const voiceap = JSON.parse((voiceah && voiceah.stdout) || "{}");
  if (voiceap.mapped !== "host_voice_session" || voiceap.product_tool_residual !== false) throw new Error(JSON.stringify(voiceap).slice(0,200));
  console.log("mcp_call voice_session alias short-circuit ok", voiceap.mapped, (voiceap.voice_session||{}).call_id);
  const relays = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.voice_relay|{\"call_id\":\"mcp-voice-smoke\",\"text\":\"mcp relay hello\"}" }]);
  const relayh = relays.find((r) => r && r.kind === "mcp_call");
  if (!relayh || !relayh.ok) throw new Error("voice_relay mcp");
  const relayp = JSON.parse(relayh.stdout || "{}");
  if (relayp.mapped !== "host_voice_relay" || relayp.product_tool_residual !== false) throw new Error(JSON.stringify(relayp).slice(0,200));
  if ((relayp.voice_relay||{}).pretend_silent === true) throw new Error("pretend_silent");
  if ((relayp.voice_relay||{}).voice_stt_residual !== true) throw new Error("voice_stt_residual relay gated: " + JSON.stringify(relayp.voice_relay||{}).slice(0,200));
  if (typeof (relayp.voice_relay||{}).voice_tts_residual !== "boolean") throw new Error("voice_tts_residual missing");
  if (!(relayp.voice_relay||{}).path) throw new Error("voice_relay path: " + JSON.stringify(relayp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-voice-relay.json", JSON.stringify({ ok: true, ...relayp }, null, 2));
  console.log("mcp_call voice_relay short-circuit ok", relayp.mapped, (relayp.voice_relay||{}).mode, (relayp.voice_relay||{}).voice_stt_residual, (relayp.voice_relay||{}).voice_tts_residual);
  const ends = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.voice_end|{\"call_id\":\"mcp-voice-smoke\",\"summary\":\"mcp voice ended\"}" }]);
  const endh = ends.find((r) => r && r.kind === "mcp_call");
  if (!endh || !endh.ok) throw new Error("voice_end mcp");
  const endp = JSON.parse(endh.stdout || "{}");
  if (endp.mapped !== "host_voice_end_write" || endp.product_tool_residual !== false) throw new Error(JSON.stringify(endp).slice(0,200));
  if ((endp.voice_end||{}).pretend_still_live === true) throw new Error("pretend_still_live");
  // Matched session from voice_start closes match residual; unmatched would stay true.
  if ((endp.voice_end||{}).matched !== true || (endp.voice_end||{}).voice_end_match_residual !== false) {
    throw new Error("voice_end match expected after voice_start: " + JSON.stringify(endp.voice_end||{}).slice(0,200));
  }
  if (!(endp.voice_end||{}).path) throw new Error("voice_end path: " + JSON.stringify(endp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-voice-end.json", JSON.stringify({ ok: true, ...endp }, null, 2));
  console.log("mcp_call voice_end short-circuit ok", endp.mapped, (endp.voice_end||{}).mode, (endp.voice_end||{}).voice_end_match_residual);
  const endMiss = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.voice_end_write|{\"call_id\":\"mcp-voice-missing\",\"summary\":\"unmatched\"}" }]);
  const endmh = endMiss.find((r) => r && r.kind === "mcp_call");
  const endmp = JSON.parse((endmh && endmh.stdout) || "{}");
  if (endmp.mapped !== "host_voice_end_write" || endmp.product_tool_residual !== false) throw new Error(JSON.stringify(endmp).slice(0,200));
  if ((endmp.voice_end||{}).matched !== false || (endmp.voice_end||{}).voice_end_match_residual !== true) {
    throw new Error("voice_end unmatched residual must stay gated: " + JSON.stringify(endmp.voice_end||{}).slice(0,200));
  }
  console.log("mcp_call voice_end unmatched residual ok", endmp.mapped, (endmp.voice_end||{}).mode, (endmp.voice_end||{}).voice_end_match_residual);
  // Media product short-circuit → executeMediaProductEffect (generate_image/video/watch/chart)
  const imgs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.generate_image|{\"prompt\":\"MCP aurora smoke\"}" }]);
  const ih = imgs.find((r) => r && r.kind === "mcp_call");
  if (!ih || !ih.ok) throw new Error("generate_image mcp");
  const ip = JSON.parse(ih.stdout || "{}");
  if (ip.mapped !== "host_generate_image" || ip.product_tool_residual !== false) throw new Error(JSON.stringify(ip).slice(0,200));
  if ((ip.media||{}).pretend_media === true) throw new Error("pretend_media image");
  if (!(ip.media||{}).media_path || !(ip.media||{}).png_magic_ok) throw new Error("image payload: " + JSON.stringify(ip).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-gen-image.json", JSON.stringify({ ok: true, ...ip }, null, 2));
  console.log("mcp_call generate_image short-circuit ok", ip.mapped, (ip.media||{}).media_path);
  const imgAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.make_image|{\"prompt\":\"alias image\"}" }]);
  const iah = imgAlias.find((r) => r && r.kind === "mcp_call");
  const iap = JSON.parse((iah && iah.stdout) || "{}");
  if (iap.mapped !== "host_generate_image" || iap.product_tool_residual !== false) throw new Error(JSON.stringify(iap).slice(0,200));
  console.log("mcp_call make_image alias short-circuit ok", iap.mapped, (iap.media||{}).mode);
  const vids = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.generate_video|{\"prompt\":\"MCP clip smoke\"}" }]);
  const vh = vids.find((r) => r && r.kind === "mcp_call");
  if (!vh || !vh.ok) throw new Error("generate_video mcp");
  const vp = JSON.parse(vh.stdout || "{}");
  if (vp.mapped !== "host_generate_video" || vp.product_tool_residual !== false) throw new Error(JSON.stringify(vp).slice(0,200));
  if ((vp.media||{}).pretend_media === true) throw new Error("pretend_media video");
  if (!(vp.media||{}).media_path) throw new Error("video payload: " + JSON.stringify(vp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-gen-video.json", JSON.stringify({ ok: true, ...vp }, null, 2));
  console.log("mcp_call generate_video short-circuit ok", vp.mapped, (vp.media||{}).media_path);
  const vidAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.gen_video|{\"prompt\":\"alias video\"}" }]);
  const vah = vidAlias.find((r) => r && r.kind === "mcp_call");
  const vap = JSON.parse((vah && vah.stdout) || "{}");
  if (vap.mapped !== "host_generate_video" || vap.product_tool_residual !== false) throw new Error(JSON.stringify(vap).slice(0,200));
  console.log("mcp_call gen_video alias short-circuit ok", vap.mapped, (vap.media||{}).mode);
  const watchVid = (vp.media||{}).media_path;
  const watches = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.watch_video|{\"video\":" + JSON.stringify(watchVid) + "}" }]);
  const wh = watches.find((r) => r && r.kind === "mcp_call");
  if (!wh || !wh.ok) throw new Error("watch_video mcp");
  const wp = JSON.parse(wh.stdout || "{}");
  if (wp.mapped !== "host_watch_video" || wp.product_tool_residual !== false) throw new Error(JSON.stringify(wp).slice(0,200));
  if ((wp.media||{}).pretend_media === true) throw new Error("pretend_media watch");
  if (!(wp.media||{}).frame_path || !(wp.media||{}).png_magic_ok) throw new Error("watch payload: " + JSON.stringify(wp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-watch-video.json", JSON.stringify({ ok: true, ...wp }, null, 2));
  console.log("mcp_call watch_video short-circuit ok", wp.mapped, (wp.media||{}).frame_path);
  const watchAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.extract_frame|{\"video\":" + JSON.stringify(watchVid) + "}" }]);
  const wahh = watchAlias.find((r) => r && r.kind === "mcp_call");
  const wap = JSON.parse((wahh && wahh.stdout) || "{}");
  if (wap.mapped !== "host_watch_video" || wap.product_tool_residual !== false) throw new Error(JSON.stringify(wap).slice(0,200));
  console.log("mcp_call extract_frame alias short-circuit ok", wap.mapped, (wap.media||{}).frame_path);
  const charts = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.structured_chart|{\"series\":{\"alpha\":4,\"beta\":9,\"gamma\":6}}" }]);
  const chh = charts.find((r) => r && r.kind === "mcp_call");
  if (!chh || !chh.ok) throw new Error("structured_chart mcp");
  const chp = JSON.parse(chh.stdout || "{}");
  if (chp.mapped !== "host_structured_chart" || chp.product_tool_residual !== false) throw new Error(JSON.stringify(chp).slice(0,200));
  if ((chp.media||{}).pretend_media === true) throw new Error("pretend_media chart");
  if (!(chp.media||{}).media_path || !(chp.media||{}).png_magic_ok) throw new Error("chart payload: " + JSON.stringify(chp).slice(0,200));
  if (!((chp.media||{}).series) || (chp.media||{}).series.alpha !== 4) throw new Error("chart series: " + JSON.stringify((chp.media||{}).series));
  require("fs").writeFileSync("/tmp/bitbot-mcp-chart.json", JSON.stringify({ ok: true, ...chp }, null, 2));
  console.log("mcp_call structured_chart short-circuit ok", chp.mapped, (chp.media||{}).media_path);
  const chartAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.make_chart|{\"alpha\":2,\"beta\":5}" }]);
  const cah = chartAlias.find((r) => r && r.kind === "mcp_call");
  const cap = JSON.parse((cah && cah.stdout) || "{}");
  if (cap.mapped !== "host_structured_chart" || cap.product_tool_residual !== false) throw new Error(JSON.stringify(cap).slice(0,200));
  console.log("mcp_call make_chart alias short-circuit ok", cap.mapped, (cap.media||{}).mode);
  // webfetch / screenshot / computer_use(+shop) / device / machines / copy / react / routine / box_doctor
  const wfetches = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.webfetch|{\"url\":\"https://example.com\"}" }]);
  const wfhMcp = wfetches.find((r) => r && r.kind === "mcp_call");
  if (!wfhMcp || !wfhMcp.ok) throw new Error("webfetch mcp");
  const wfpMcp = JSON.parse(wfhMcp.stdout || "{}");
  if (wfpMcp.mapped !== "host_webfetch" || wfpMcp.product_tool_residual !== false) throw new Error(JSON.stringify(wfpMcp).slice(0,200));
  if ((wfpMcp.webfetch||{}).pretend_fetched === true) throw new Error("pretend_fetched");
  if (typeof (wfpMcp.webfetch||{}).public_fallback_residual !== "boolean") throw new Error("public_fallback_residual missing");
  if (!(wfpMcp.webfetch||{}).path) throw new Error("webfetch path: " + JSON.stringify(wfpMcp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-webfetch.json", JSON.stringify({ ok: true, ...wfpMcp }, null, 2));
  console.log("mcp_call webfetch short-circuit ok", wfpMcp.mapped, (wfpMcp.webfetch||{}).mode, (wfpMcp.webfetch||{}).public_fallback_residual);
  const wfFetchAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.web_fetch|{\"url\":\"https://example.com\"}" }]);
  const wfahMcp = wfFetchAlias.find((r) => r && r.kind === "mcp_call");
  const wfapMcp = JSON.parse((wfahMcp && wfahMcp.stdout) || "{}");
  if (wfapMcp.mapped !== "host_webfetch" || wfapMcp.product_tool_residual !== false) throw new Error(JSON.stringify(wfapMcp).slice(0,200));
  console.log("mcp_call web_fetch alias short-circuit ok", wfapMcp.mapped, (wfapMcp.webfetch||{}).mode);
  const shots = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.screenshot|{\"agent\":\"mcp-smoke\"}" }]);
  const shoth = shots.find((r) => r && r.kind === "mcp_call");
  if (!shoth || !shoth.ok) throw new Error("screenshot mcp");
  const shotpMcp = JSON.parse(shoth.stdout || "{}");
  if (shotpMcp.mapped !== "host_screenshot" || shotpMcp.product_tool_residual !== false) throw new Error(JSON.stringify(shotpMcp).slice(0,200));
  if ((shotpMcp.screenshot||{}).pretend_frame === true) throw new Error("pretend_frame");
  if (typeof (shotpMcp.screenshot||{}).screenshot_residual !== "boolean") throw new Error("screenshot_residual missing");
  if (!(shotpMcp.screenshot||{}).path) throw new Error("screenshot path: " + JSON.stringify(shotpMcp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-screenshot.json", JSON.stringify({ ok: true, ...shotpMcp }, null, 2));
  console.log("mcp_call screenshot short-circuit ok", shotpMcp.mapped, (shotpMcp.screenshot||{}).mode, (shotpMcp.screenshot||{}).screenshot_residual);
  const cus = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.computer_use|{\"command\":\"mcp-cu-smoke-no-url\"}" }]);
  const cuh = cus.find((r) => r && r.kind === "mcp_call");
  if (!cuh || !cuh.ok) throw new Error("computer_use mcp");
  const cupMcp = JSON.parse(cuh.stdout || "{}");
  if (cupMcp.mapped !== "host_computer_use" || cupMcp.product_tool_residual !== false) throw new Error(JSON.stringify(cupMcp).slice(0,200));
  if (((cupMcp.computer_use||{}).outcome||{}).pretend_purchased === true) throw new Error("pretend_purchased cu");
  if (typeof ((cupMcp.computer_use||{}).outcome||{}).ocr_residual !== "boolean" && typeof ((cupMcp.computer_use||{}).gui||{}).os_window_automation_residual !== "boolean") {
    // Nested residuals may live on snap computer_use summary or payload outcome/gui.
    const cuSum = cupMcp.computer_use || {};
    if (typeof cuSum.ocr_residual !== "boolean" && typeof cuSum.os_window_automation_residual !== "boolean") {
      throw new Error("cu nested residual missing: " + JSON.stringify(cuSum).slice(0,200));
    }
  }
  require("fs").writeFileSync("/tmp/bitbot-mcp-computer-use.json", JSON.stringify({ ok: true, ...cupMcp }, null, 2));
  console.log("mcp_call computer_use short-circuit ok", cupMcp.mapped, (cupMcp.computer_use||{}).mode || ((cupMcp.computer_use||{}).outcome||{}).summary);
  const shopCus = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.shop_retail|{\"command\":\"shopping:site-playbooks-target :: mcp shop smoke\"}" }]);
  const shopCuh = shopCus.find((r) => r && r.kind === "mcp_call");
  if (!shopCuh || !shopCuh.ok) throw new Error("shop_retail mcp");
  const shopCup = JSON.parse(shopCuh.stdout || "{}");
  if (shopCup.mapped !== "host_computer_use" || shopCup.product_tool_residual !== false) throw new Error(JSON.stringify(shopCup).slice(0,200));
  if (((shopCup.computer_use||{}).outcome||{}).pretend_purchased === true) throw new Error("pretend_purchased shop");
  const shopFam = ((shopCup.computer_use||{}).outcome||{}).vertical_family || (shopCup.computer_use||{}).vertical_family;
  if (shopFam && shopFam !== "shopping") throw new Error("shop vertical_family: " + shopFam);
  console.log("mcp_call shop_retail alias short-circuit ok", shopCup.mapped, shopFam || "shopping");
  // travel_book / order_food share host_computer_use map (shop_* / travel_* / food_* prefixes); skip extra CU runs.
  const dtls = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.device_tools_list|{\"machine_id\":\"mcp-ios\",\"machine_kind\":\"ios\",\"tools\":\"camera=ask,mic=deny\"}" }]);
  const dtlh = dtls.find((r) => r && r.kind === "mcp_call");
  if (!dtlh || !dtlh.ok) throw new Error("device_tools_list mcp");
  const dtlpMcp = JSON.parse(dtlh.stdout || "{}");
  if (dtlpMcp.mapped !== "host_device_tools_list" || dtlpMcp.product_tool_residual !== false) throw new Error(JSON.stringify(dtlpMcp).slice(0,200));
  if ((dtlpMcp.device_tools_list||{}).pretend_granted === true) throw new Error("pretend_granted tools");
  if (!((dtlpMcp.device_tools_list||{}).count >= 1)) throw new Error("device_tools count: " + JSON.stringify(dtlpMcp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-device-tools-list.json", JSON.stringify({ ok: true, ...dtlpMcp }, null, 2));
  console.log("mcp_call device_tools_list short-circuit ok", dtlpMcp.mapped, (dtlpMcp.device_tools_list||{}).count);
  const dts = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.device_tool|{\"machine_id\":\"mcp-ios\",\"tool\":\"camera\"}" }]);
  const dth = dts.find((r) => r && r.kind === "mcp_call");
  if (!dth || !dth.ok) throw new Error("device_tool mcp");
  const dtpMcp = JSON.parse(dth.stdout || "{}");
  if (dtpMcp.mapped !== "host_device_tool" || dtpMcp.product_tool_residual !== false) throw new Error(JSON.stringify(dtpMcp).slice(0,200));
  if (typeof (dtpMcp.device_tool||{}).device_tool_residual !== "boolean") throw new Error("device_tool_residual missing");
  require("fs").writeFileSync("/tmp/bitbot-mcp-device-tool.json", JSON.stringify({ ok: true, ...dtpMcp }, null, 2));
  console.log("mcp_call device_tool short-circuit ok", dtpMcp.mapped, (dtpMcp.device_tool||{}).mode, (dtpMcp.device_tool||{}).device_tool_residual);
  const mls = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.machines_list|{\"host_kind\":\"desktop\",\"host_id\":\"mcp-host\",\"machines\":\"desk-1:desktop:connected,phone-1:ios:disconnected\"}" }]);
  const mlh = mls.find((r) => r && r.kind === "mcp_call");
  if (!mlh || !mlh.ok) throw new Error("machines_list mcp");
  const mlpMcp = JSON.parse(mlh.stdout || "{}");
  if (mlpMcp.mapped !== "host_machines_list" || mlpMcp.product_tool_residual !== false) throw new Error(JSON.stringify(mlpMcp).slice(0,200));
  if ((mlpMcp.machines_list||{}).pretend_all_connected === true) throw new Error("pretend_all_connected");
  if (!((mlpMcp.machines_list||{}).count >= 1)) throw new Error("machines count");
  require("fs").writeFileSync("/tmp/bitbot-mcp-machines-list.json", JSON.stringify({ ok: true, ...mlpMcp }, null, 2));
  console.log("mcp_call machines_list short-circuit ok", mlpMcp.mapped, (mlpMcp.machines_list||{}).count);
  const mlAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.list_machines|{\"host_id\":\"mcp-alias\"}" }]);
  const mlah = mlAlias.find((r) => r && r.kind === "mcp_call");
  const mlapMcp = JSON.parse((mlah && mlah.stdout) || "{}");
  if (mlapMcp.mapped !== "host_machines_list" || mlapMcp.product_tool_residual !== false) throw new Error(JSON.stringify(mlapMcp).slice(0,200));
  console.log("mcp_call list_machines alias short-circuit ok", mlapMcp.mapped, (mlapMcp.machines_list||{}).count);
  fs.mkdirSync("uploads", { recursive: true });
  fs.writeFileSync("uploads/mcp-copy-src.txt", "mcp copy short-circuit\n");
  const c2s = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.copy_to_box|{\"machine_id\":\"remote-1\",\"src\":\"uploads/mcp-copy-src.txt\",\"dest\":\"uploads/mcp-copy-dest.txt\"}" }]);
  const c2h = c2s.find((r) => r && r.kind === "mcp_call");
  if (!c2h || !c2h.ok) throw new Error("copy_to_box mcp");
  const c2p = JSON.parse(c2h.stdout || "{}");
  if (c2p.mapped !== "host_copy_to_box" || c2p.product_tool_residual !== false) throw new Error(JSON.stringify(c2p).slice(0,200));
  if ((c2p.copy_box||{}).pretend_remote_machine === true) throw new Error("pretend_remote_machine");
  if ((c2p.copy_box||{}).cross_machine_copy_residual !== true) throw new Error("cross_machine_copy_residual must stay gated: " + JSON.stringify(c2p.copy_box||{}).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-copy-to-box.json", JSON.stringify({ ok: true, ...c2p }, null, 2));
  console.log("mcp_call copy_to_box short-circuit ok", c2p.mapped, (c2p.copy_box||{}).mode, (c2p.copy_box||{}).cross_machine_copy_residual);
  try { fs.unlinkSync("uploads/mcp-copy-from-dest.txt"); } catch (_) {}
  const cfs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.copy_from_box|{\"machine_id\":\"remote-1\",\"src\":\"uploads/mcp-copy-src.txt\",\"dest\":\"uploads/mcp-copy-from-dest.txt\",\"overwrite\":\"allow\"}" }]);
  const cfh = cfs.find((r) => r && r.kind === "mcp_call");
  if (!cfh || !cfh.ok) throw new Error("copy_from_box mcp");
  const cfpMcp = JSON.parse(cfh.stdout || "{}");
  if (cfpMcp.mapped !== "host_copy_from_box" || cfpMcp.product_tool_residual !== false) throw new Error(JSON.stringify(cfpMcp).slice(0,200));
  if ((cfpMcp.copy_box||{}).cross_machine_copy_residual !== true) throw new Error("copy_from residual gated");
  console.log("mcp_call copy_from_box short-circuit ok", cfpMcp.mapped, (cfpMcp.copy_box||{}).mode, (cfpMcp.copy_box||{}).cross_machine_copy_residual);
  // Unique message_id so re-runs do not toggle an existing active pill off.
  const reactMsgId = "msg-mcp-smoke-" + Date.now().toString(36);
  const reacts = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.react_message|" + JSON.stringify({ message_id: reactMsgId, emoji: "🎉" }) }]);
  const reacth = reacts.find((r) => r && r.kind === "mcp_call");
  if (!reacth || !reacth.ok) throw new Error("react_message mcp");
  const reactpMcp = JSON.parse(reacth.stdout || "{}");
  if (reactpMcp.mapped !== "host_react_message" || reactpMcp.product_tool_residual !== false) throw new Error(JSON.stringify(reactpMcp).slice(0,200));
  if ((reactpMcp.react_message||{}).pretend_pill === true) throw new Error("pretend_pill");
  if ((reactpMcp.react_message||{}).visible_pill !== true) throw new Error("visible_pill: " + JSON.stringify(reactpMcp.react_message||{}).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-react.json", JSON.stringify({ ok: true, ...reactpMcp }, null, 2));
  console.log("mcp_call react_message short-circuit ok", reactpMcp.mapped, (reactpMcp.react_message||{}).emoji);
  const routs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.routine_schedule|{\"id\":\"mcp-r\",\"cron\":\"@daily\",\"prompt\":\"mcp routine smoke\"}" }]);
  const routh = routs.find((r) => r && r.kind === "mcp_call");
  if (!routh || !routh.ok) throw new Error("routine_schedule mcp");
  const routpMcp = JSON.parse(routh.stdout || "{}");
  if (routpMcp.mapped !== "host_routine_schedule" || routpMcp.product_tool_residual !== false) throw new Error(JSON.stringify(routpMcp).slice(0,200));
  if ((routpMcp.routine_schedule||{}).pretend_scheduled === true) throw new Error("pretend_scheduled");
  if ((routpMcp.routine_schedule||{}).stored !== true) throw new Error("stored: " + JSON.stringify(routpMcp.routine_schedule||{}).slice(0,200));
  if (typeof (routpMcp.routine_schedule||{}).long_lived_cron_residual !== "boolean") throw new Error("long_lived_cron_residual missing");
  require("fs").writeFileSync("/tmp/bitbot-mcp-routine.json", JSON.stringify({ ok: true, ...routpMcp }, null, 2));
  console.log("mcp_call routine_schedule short-circuit ok", routpMcp.mapped, (routpMcp.routine_schedule||{}).mode, (routpMcp.routine_schedule||{}).long_lived_cron_residual);
  const routAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.create_routine|{\"id\":\"mcp-r2\",\"cron\":\"@hourly\",\"prompt\":\"alias routine\"}" }]);
  const routah = routAlias.find((r) => r && r.kind === "mcp_call");
  const routapMcp = JSON.parse((routah && routah.stdout) || "{}");
  if (routapMcp.mapped !== "host_routine_schedule" || routapMcp.product_tool_residual !== false) throw new Error(JSON.stringify(routapMcp).slice(0,200));
  console.log("mcp_call create_routine alias short-circuit ok", routapMcp.mapped, (routapMcp.routine_schedule||{}).id);
  const docs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.box_doctor|{}" }]);
  const doch = docs.find((r) => r && r.kind === "mcp_call");
  if (!doch || !doch.ok) throw new Error("box_doctor mcp");
  const docpMcp = JSON.parse(doch.stdout || "{}");
  if (docpMcp.mapped !== "host_box_doctor" || docpMcp.product_tool_residual !== false) throw new Error(JSON.stringify(docpMcp).slice(0,200));
  if ((docpMcp.box_doctor||{}).pretend_healthy === true) throw new Error("pretend_healthy");
  if (typeof (docpMcp.box_doctor||{}).box_doctor_bin_residual !== "boolean") throw new Error("box_doctor_bin_residual missing");
  if (!(docpMcp.box_doctor||{}).path) throw new Error("box_doctor path");
  require("fs").writeFileSync("/tmp/bitbot-mcp-box-doctor.json", JSON.stringify({ ok: true, ...docpMcp }, null, 2));
  console.log("mcp_call box_doctor short-circuit ok", docpMcp.mapped, (docpMcp.box_doctor||{}).mode, (docpMcp.box_doctor||{}).box_doctor_bin_residual);
  // box_env / box_clock / package_install / shell / fs_list / fs_read / shared_box_fs / journal_* / shared_memory_*
  const boxEnvRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.box_env|{}" }]);
  const boxEnvH = boxEnvRuns.find((r) => r && r.kind === "mcp_call");
  if (!boxEnvH || !boxEnvH.ok) throw new Error("box_env mcp");
  const boxEnvP = JSON.parse(boxEnvH.stdout || "{}");
  if (boxEnvP.mapped !== "host_box_env" || boxEnvP.product_tool_residual !== false) throw new Error(JSON.stringify(boxEnvP).slice(0,200));
  if ((boxEnvP.box_env||{}).pretend_runtime === true) throw new Error("pretend_runtime");
  if (!(boxEnvP.box_env||{}).path) throw new Error("box_env path");
  require("fs").writeFileSync("/tmp/bitbot-mcp-box-env.json", JSON.stringify({ ok: true, ...boxEnvP }, null, 2));
  console.log("mcp_call box_env short-circuit ok", boxEnvP.mapped, (boxEnvP.box_env||{}).mode, (boxEnvP.box_env||{}).runtime);
  const boxClockRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.box_clock|{}" }]);
  const boxClockH = boxClockRuns.find((r) => r && r.kind === "mcp_call");
  if (!boxClockH || !boxClockH.ok) throw new Error("box_clock mcp");
  const boxClockP = JSON.parse(boxClockH.stdout || "{}");
  if (boxClockP.mapped !== "host_box_clock" || boxClockP.product_tool_residual !== false) throw new Error(JSON.stringify(boxClockP).slice(0,200));
  if ((boxClockP.box_clock||{}).pretend_aligned === true) throw new Error("pretend_aligned");
  if (!(boxClockP.box_clock||{}).path) throw new Error("box_clock path");
  require("fs").writeFileSync("/tmp/bitbot-mcp-box-clock.json", JSON.stringify({ ok: true, ...boxClockP }, null, 2));
  console.log("mcp_call box_clock short-circuit ok", boxClockP.mapped, (boxClockP.box_clock||{}).mode, (boxClockP.box_clock||{}).user_iana);
  const pkgInstRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.package_install|{\"pm\":\"npm\",\"pkgs\":\"left-pad@1.3.0\",\"via\":\"shell\"}" }]);
  const pkgInstH = pkgInstRuns.find((r) => r && r.kind === "mcp_call");
  if (!pkgInstH || !pkgInstH.ok) throw new Error("package_install mcp");
  const pkgInstP = JSON.parse(pkgInstH.stdout || "{}");
  if (pkgInstP.mapped !== "host_package_install" || pkgInstP.product_tool_residual !== false) throw new Error(JSON.stringify(pkgInstP).slice(0,200));
  if ((pkgInstP.package_install||{}).pretend_installed === true) throw new Error("pretend_installed");
  if ((pkgInstP.package_install||{}).via_shell !== true) throw new Error("via_shell: " + JSON.stringify(pkgInstP.package_install||{}).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-package-install.json", JSON.stringify({ ok: true, ...pkgInstP }, null, 2));
  console.log("mcp_call package_install short-circuit ok", pkgInstP.mapped, (pkgInstP.package_install||{}).mode, (pkgInstP.package_install||{}).pm);
  const pkgAliasRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.install_package|{\"pm\":\"npm\",\"pkgs\":\"is-arrayish@0.3.2\",\"via\":\"shell\"}" }]);
  const pkgAliasH = pkgAliasRuns.find((r) => r && r.kind === "mcp_call");
  const pkgAliasP = JSON.parse((pkgAliasH && pkgAliasH.stdout) || "{}");
  if (pkgAliasP.mapped !== "host_package_install" || pkgAliasP.product_tool_residual !== false) throw new Error(JSON.stringify(pkgAliasP).slice(0,200));
  console.log("mcp_call install_package alias short-circuit ok", pkgAliasP.mapped, (pkgAliasP.package_install||{}).pm);
  // Shell: approval honesty — without approved, map closes residual but does not pretend-run.
  const shellNeedRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.shell|{\"command\":\"echo mcp-shell-needs-approval\"}" }]);
  const shellNeedH = shellNeedRuns.find((r) => r && r.kind === "mcp_call");
  if (!shellNeedH || !shellNeedH.ok) throw new Error("shell needs-approval mcp");
  const shellNeedP = JSON.parse(shellNeedH.stdout || "{}");
  if (shellNeedP.mapped !== "host_shell" || shellNeedP.product_tool_residual !== false) throw new Error(JSON.stringify(shellNeedP).slice(0,200));
  if ((shellNeedP.shell||{}).pretend_approved === true) throw new Error("pretend_approved needs");
  if ((shellNeedP.shell||{}).needs_approval !== true || (shellNeedP.shell||{}).ran === true) {
    throw new Error("shell approval honesty: " + JSON.stringify(shellNeedP.shell||{}).slice(0,200));
  }
  console.log("mcp_call shell needs-approval short-circuit ok", shellNeedP.mapped, (shellNeedP.shell||{}).mode);
  const shellOkRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.shell|{\"command\":\"echo mcp-shell-approved\",\"approved\":true}" }]);
  const shellOkH = shellOkRuns.find((r) => r && r.kind === "mcp_call");
  if (!shellOkH || !shellOkH.ok) throw new Error("shell approved mcp");
  const shellOkP = JSON.parse(shellOkH.stdout || "{}");
  if (shellOkP.mapped !== "host_shell" || shellOkP.product_tool_residual !== false) throw new Error(JSON.stringify(shellOkP).slice(0,200));
  if ((shellOkP.shell||{}).pretend_approved === true) throw new Error("pretend_approved ok");
  if ((shellOkP.shell||{}).ran !== true) throw new Error("shell ran: " + JSON.stringify(shellOkP.shell||{}).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-shell.json", JSON.stringify({ ok: true, ...shellOkP }, null, 2));
  console.log("mcp_call shell approved short-circuit ok", shellOkP.mapped, (shellOkP.shell||{}).mode, (shellOkP.shell||{}).ran);
  const fsListRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.fs_list|{\"path\":\"docs\"}" }]);
  const fsListH = fsListRuns.find((r) => r && r.kind === "mcp_call");
  if (!fsListH || !fsListH.ok) throw new Error("fs_list mcp");
  const fsListP = JSON.parse(fsListH.stdout || "{}");
  if (fsListP.mapped !== "host_fs_list" || fsListP.product_tool_residual !== false) throw new Error(JSON.stringify(fsListP).slice(0,200));
  if ((fsListP.fs_list||{}).pretend_listing === true) throw new Error("pretend_listing");
  if (!((fsListP.fs_list||{}).count >= 1)) throw new Error("fs_list count");
  require("fs").writeFileSync("/tmp/bitbot-mcp-fs-list.json", JSON.stringify({ ok: true, ...fsListP }, null, 2));
  console.log("mcp_call fs_list short-circuit ok", fsListP.mapped, (fsListP.fs_list||{}).mode, (fsListP.fs_list||{}).count);
  const fsListAliasRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.listdir|{\"path\":\"docs\"}" }]);
  const fsListAliasH = fsListAliasRuns.find((r) => r && r.kind === "mcp_call");
  const fsListAliasP = JSON.parse((fsListAliasH && fsListAliasH.stdout) || "{}");
  if (fsListAliasP.mapped !== "host_fs_list" || fsListAliasP.product_tool_residual !== false) throw new Error(JSON.stringify(fsListAliasP).slice(0,200));
  console.log("mcp_call listdir alias short-circuit ok", fsListAliasP.mapped, (fsListAliasP.fs_list||{}).count);
  const fsReadRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.fs_read|{\"path\":\"README.mbt.md\"}" }]);
  const fsReadH = fsReadRuns.find((r) => r && r.kind === "mcp_call");
  if (!fsReadH || !fsReadH.ok) throw new Error("fs_read mcp");
  const fsReadP = JSON.parse(fsReadH.stdout || "{}");
  if (fsReadP.mapped !== "host_fs_read" || fsReadP.product_tool_residual !== false) throw new Error(JSON.stringify(fsReadP).slice(0,200));
  if ((fsReadP.fs_read||{}).pretend_contents === true) throw new Error("pretend_contents");
  if (!((fsReadP.fs_read||{}).bytes >= 1)) throw new Error("fs_read bytes");
  require("fs").writeFileSync("/tmp/bitbot-mcp-fs-read.json", JSON.stringify({ ok: true, ...fsReadP }, null, 2));
  console.log("mcp_call fs_read short-circuit ok", fsReadP.mapped, (fsReadP.fs_read||{}).mode, (fsReadP.fs_read||{}).bytes);
  const fsReadAliasRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.read_file|{\"path\":\"README.mbt.md\"}" }]);
  const fsReadAliasH = fsReadAliasRuns.find((r) => r && r.kind === "mcp_call");
  const fsReadAliasP = JSON.parse((fsReadAliasH && fsReadAliasH.stdout) || "{}");
  if (fsReadAliasP.mapped !== "host_fs_read" || fsReadAliasP.product_tool_residual !== false) throw new Error(JSON.stringify(fsReadAliasP).slice(0,200));
  console.log("mcp_call read_file alias short-circuit ok", fsReadAliasP.mapped, (fsReadAliasP.fs_read||{}).bytes);
  const sharedFsRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.shared_box_fs|{}" }]);
  const sharedFsH = sharedFsRuns.find((r) => r && r.kind === "mcp_call");
  if (!sharedFsH || !sharedFsH.ok) throw new Error("shared_box_fs mcp");
  const sharedFsP = JSON.parse(sharedFsH.stdout || "{}");
  if (sharedFsP.mapped !== "host_shared_box_fs" || sharedFsP.product_tool_residual !== false) throw new Error(JSON.stringify(sharedFsP).slice(0,200));
  if ((sharedFsP.shared_box_fs||{}).pretend_shared === true) throw new Error("pretend_shared");
  if ((sharedFsP.shared_box_fs||{}).shared_fs !== true) throw new Error("shared_fs");
  require("fs").writeFileSync("/tmp/bitbot-mcp-shared-box-fs.json", JSON.stringify({ ok: true, ...sharedFsP }, null, 2));
  console.log("mcp_call shared_box_fs short-circuit ok", sharedFsP.mapped, (sharedFsP.shared_box_fs||{}).mode);
  const jAppendRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.journal_append|{\"date\":\"2026-10-18\",\"event_id\":\"mcp-j-append\",\"body\":\"mcp journal append smoke\"}" }]);
  const jAppendH = jAppendRuns.find((r) => r && r.kind === "mcp_call");
  if (!jAppendH || !jAppendH.ok) throw new Error("journal_append mcp");
  const jAppendP = JSON.parse(jAppendH.stdout || "{}");
  if (jAppendP.mapped !== "host_journal_append" || jAppendP.product_tool_residual !== false) throw new Error(JSON.stringify(jAppendP).slice(0,200));
  if ((jAppendP.journal_append||{}).pretend_stored === true) throw new Error("pretend_stored journal");
  if ((jAppendP.journal_append||{}).stored !== true) throw new Error("journal stored");
  require("fs").writeFileSync("/tmp/bitbot-mcp-journal-append.json", JSON.stringify({ ok: true, ...jAppendP }, null, 2));
  console.log("mcp_call journal_append short-circuit ok", jAppendP.mapped, (jAppendP.journal_append||{}).mode);
  const jQueryRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.journal_query|{\"from_date\":\"2026-10-01\",\"to_date\":\"2026-10-31\"}" }]);
  const jQueryH = jQueryRuns.find((r) => r && r.kind === "mcp_call");
  if (!jQueryH || !jQueryH.ok) throw new Error("journal_query mcp");
  const jQueryP = JSON.parse(jQueryH.stdout || "{}");
  if (jQueryP.mapped !== "host_journal_query" || jQueryP.product_tool_residual !== false) throw new Error(JSON.stringify(jQueryP).slice(0,200));
  if ((jQueryP.journal_query||{}).pretend_hits === true) throw new Error("pretend_hits");
  if (typeof (jQueryP.journal_query||{}).hit_count !== "number") throw new Error("hit_count");
  require("fs").writeFileSync("/tmp/bitbot-mcp-journal-query.json", JSON.stringify({ ok: true, ...jQueryP }, null, 2));
  console.log("mcp_call journal_query short-circuit ok", jQueryP.mapped, (jQueryP.journal_query||{}).mode, (jQueryP.journal_query||{}).hit_count);
  const memPutRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.shared_memory_put|{\"scope\":\"mcp-smoke\",\"key\":\"k1\",\"value\":\"v-mcp-smoke\"}" }]);
  const memPutH = memPutRuns.find((r) => r && r.kind === "mcp_call");
  if (!memPutH || !memPutH.ok) throw new Error("shared_memory_put mcp");
  const memPutP = JSON.parse(memPutH.stdout || "{}");
  if (memPutP.mapped !== "host_shared_memory_put" || memPutP.product_tool_residual !== false) throw new Error(JSON.stringify(memPutP).slice(0,200));
  if ((memPutP.shared_memory_put||{}).pretend_stored === true) throw new Error("pretend_stored mem");
  if ((memPutP.shared_memory_put||{}).stored !== true) throw new Error("mem stored");
  require("fs").writeFileSync("/tmp/bitbot-mcp-shared-memory-put.json", JSON.stringify({ ok: true, ...memPutP }, null, 2));
  console.log("mcp_call shared_memory_put short-circuit ok", memPutP.mapped, (memPutP.shared_memory_put||{}).mode);
  const memReadRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.shared_memory_read|{\"scope\":\"mcp-smoke\",\"key\":\"k1\"}" }]);
  const memReadH = memReadRuns.find((r) => r && r.kind === "mcp_call");
  if (!memReadH || !memReadH.ok) throw new Error("shared_memory_read mcp");
  const memReadP = JSON.parse(memReadH.stdout || "{}");
  if (memReadP.mapped !== "host_shared_memory_read" || memReadP.product_tool_residual !== false) throw new Error(JSON.stringify(memReadP).slice(0,200));
  if ((memReadP.shared_memory_read||{}).found !== true) throw new Error("mem found: " + JSON.stringify(memReadP.shared_memory_read||{}).slice(0,200));
  if ((memReadP.shared_memory_read||{}).pretend_cross_scope === true) throw new Error("pretend_cross_scope");
  require("fs").writeFileSync("/tmp/bitbot-mcp-shared-memory-read.json", JSON.stringify({ ok: true, ...memReadP }, null, 2));
  console.log("mcp_call shared_memory_read short-circuit ok", memReadP.mapped, (memReadP.shared_memory_read||{}).mode, (memReadP.shared_memory_read||{}).found);
  // Optional live residual close via existing calendar/purchase/gmail mocks
  // Clear connector token files so env API URL/token win (file api_url overrides env).
  try { fs.unlinkSync("data/connectors/purchase_token.json"); } catch (_) {}
  try { fs.unlinkSync("data/connectors/calendar_token.json"); } catch (_) {}
  try { fs.unlinkSync("data/connectors/gmail_token.json"); } catch (_) {}
  // Ports 18804/18805/18806 avoid CU/channel mocks and leftover 18786/18787 listeners.
  const calMock = startMock(18804, "calendar", "smoke-mcp-cal");
  const payMock = startMock(18805, "purchase", "smoke-mcp-pay");
  const gmailMock = startMock(18806, "gmail", "smoke-mcp-gmail");
  await sleep(500);
  try {
    process.env.BITBOT_CALENDAR_API_URL = "http://127.0.0.1:18804";
    process.env.BITBOT_CALENDAR_TOKEN = "smoke-mcp-cal";
    const liveCal = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.create_event|{\"title\":\"LiveMCP\",\"when\":\"tomorrow-6pm\"}" }]);
    const lch = liveCal.find((r) => r && r.kind === "mcp_call");
    const lcp = JSON.parse((lch && lch.stdout) || "{}");
    if (lcp.mapped !== "host_schedule_meeting" || lcp.product_tool_residual !== false) throw new Error(JSON.stringify(lcp).slice(0,200));
    if ((lcp.schedule||{}).live_calendar_residual !== false || (lcp.schedule||{}).mode !== "calendar_live") {
      throw new Error("calendar live residual: " + JSON.stringify(lcp.schedule||{}).slice(0,200));
    }
    console.log("mcp_call calendar live residual close ok", (lcp.schedule||{}).mode, (lcp.schedule||{}).live_calendar_residual);
    process.env.BITBOT_PURCHASE_LIVE = "1";
    process.env.BITBOT_PURCHASE_TOKEN = "smoke-mcp-pay";
    process.env.BITBOT_PURCHASE_API_URL = "http://127.0.0.1:18805";
    const liveBuy = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.purchase_item|{\"item\":\"LiveMCPWidget\",\"cents\":777}" }]);
    const lbh = liveBuy.find((r) => r && r.kind === "mcp_call");
    const lbp = JSON.parse((lbh && lbh.stdout) || "{}");
    if (lbp.mapped !== "host_purchase" || lbp.product_tool_residual !== false) throw new Error(JSON.stringify(lbp).slice(0,200));
    if ((lbp.purchase||{}).live_paid_residual !== false || (lbp.purchase||{}).mode !== "live_charge") {
      throw new Error("purchase live residual: " + JSON.stringify(lbp.purchase||{}).slice(0,200));
    }
    if ((lbp.purchase||{}).pretend_paid === true) throw new Error("pretend_paid live");
    console.log("mcp_call purchase live residual close ok", (lbp.purchase||{}).mode, (lbp.purchase||{}).live_paid_residual);
    process.env.BITBOT_GMAIL_API_BASE = "http://127.0.0.1:18806";
    process.env.BITBOT_GMAIL_TOKEN = "smoke-mcp-gmail";
    process.env.BITBOT_MAIL_SEND = "1";
    const liveSend = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.send_mail|{\"to\":\"live-mcp@example.com\",\"subject\":\"LiveMCP\",\"body\":\"sent\"}" }]);
    const lsh = liveSend.find((r) => r && r.kind === "mcp_call");
    const lsp = JSON.parse((lsh && lsh.stdout) || "{}");
    if (lsp.mapped !== "host_mail_send" || lsp.product_tool_residual !== false) throw new Error(JSON.stringify(lsp).slice(0,200));
    if ((lsp.mail_send||{}).live_mail_residual !== false || (lsp.mail_send||{}).mode !== "live_gmail") {
      throw new Error("mail_send live residual: " + JSON.stringify(lsp.mail_send||{}).slice(0,200));
    }
    if ((lsp.mail_send||{}).pretend_sent === true) throw new Error("pretend_sent live");
    console.log("mcp_call mail_send live residual close ok", (lsp.mail_send||{}).mode, (lsp.mail_send||{}).live_mail_residual);
    const liveRead = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.mail_read|{\"thread_id\":\"t-invoice-1\"}" }]);
    const lrh = liveRead.find((r) => r && r.kind === "mcp_call");
    const lrp = JSON.parse((lrh && lrh.stdout) || "{}");
    if (lrp.mapped !== "host_mail_read" || lrp.product_tool_residual !== false) throw new Error(JSON.stringify(lrp).slice(0,200));
    if ((lrp.mail_read||{}).live_mail_residual !== false || (lrp.mail_read||{}).mode !== "gmail_live") {
      throw new Error("mail_read live residual: " + JSON.stringify(lrp.mail_read||{}).slice(0,200));
    }
    if ((lrp.mail_read||{}).pretend_live === true) throw new Error("pretend_live live");
    console.log("mcp_call mail_read live residual close ok", (lrp.mail_read||{}).mode, (lrp.mail_read||{}).live_mail_residual);
  } finally {
    try { calMock.kill(); } catch (_) {}
    try { payMock.kill(); } catch (_) {}
    try { gmailMock.kill(); } catch (_) {}
    delete process.env.BITBOT_CALENDAR_API_URL;
    delete process.env.BITBOT_CALENDAR_TOKEN;
    delete process.env.BITBOT_PURCHASE_LIVE;
    delete process.env.BITBOT_PURCHASE_TOKEN;
    delete process.env.BITBOT_PURCHASE_API_URL;
    delete process.env.BITBOT_GMAIL_API_BASE;
    delete process.env.BITBOT_GMAIL_TOKEN;
    delete process.env.BITBOT_MAIL_SEND;
  }
  // NON-DEFERRED mcp residual-CLOSE (gates+mocks; not True-only asserts)
  // 1) apply_patch: BITBOT_CODE_APPLY (+ optional COMMIT/PUSH + GIT_BIN)
  const readmeTarget = path.join(process.cwd(), "README.mbt.md");
  stripHostAppliedMarker(readmeTarget);
  process.env.BITBOT_CODE_APPLY = "1";
  delete process.env.BITBOT_CODE_COMMIT;
  delete process.env.BITBOT_CODE_PUSH;
  delete process.env.BITBOT_GIT_BIN;
  delete process.env.BITBOT_GIT_MOCK_LOG_DIR;
  const applyCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.apply_patch|{\"path\":\"README.mbt.md\"}" }]);
  const applyCloseH = applyCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!applyCloseH || !applyCloseH.ok) throw new Error("apply_patch residual close mcp");
  const applyCloseP = JSON.parse(applyCloseH.stdout || "{}");
  if (applyCloseP.mapped !== "host_code_changes" || applyCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(applyCloseP).slice(0, 200));
  }
  if ((applyCloseP.code_changes || {}).code_apply_residual !== false) {
    throw new Error("code_apply_residual must close: " + JSON.stringify(applyCloseP.code_changes || {}).slice(0, 200));
  }
  if ((applyCloseP.code_changes || {}).applied !== true) throw new Error("applied expected");
  if ((applyCloseP.code_changes || {}).git_commit_residual !== true) {
    throw new Error("git_commit_residual after apply-only: " + JSON.stringify(applyCloseP.code_changes || {}).slice(0, 200));
  }
  if ((applyCloseP.code_changes || {}).pretend_committed === true) throw new Error("pretend_committed apply");
  require("fs").writeFileSync("/tmp/bitbot-mcp-apply-close.json", JSON.stringify({ ok: true, ...applyCloseP }, null, 2));
  console.log("mcp_call apply_patch residual close ok", applyCloseP.mapped, (applyCloseP.code_changes || {}).code_apply_residual, (applyCloseP.code_changes || {}).git_commit_residual);
  stripHostAppliedMarker(readmeTarget);
  require("child_process").execSync("rm -rf /tmp/bitbot-mcp-git-mock /tmp/bitbot-mcp-git-mock-push && mkdir -p /tmp/bitbot-mcp-git-mock /tmp/bitbot-mcp-git-mock-push");
  process.env.BITBOT_CODE_APPLY = "1";
  process.env.BITBOT_CODE_COMMIT = "1";
  process.env.BITBOT_GIT_BIN = path.join(process.cwd(), "scripts/host_git_mock.sh");
  process.env.BITBOT_GIT_MOCK_LOG_DIR = "/tmp/bitbot-mcp-git-mock";
  delete process.env.BITBOT_CODE_PUSH;
  const commitCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.apply_patch|{\"path\":\"README.mbt.md\"}" }]);
  const commitCloseH = commitCloseRuns.find((r) => r && r.kind === "mcp_call");
  const commitCloseP = JSON.parse((commitCloseH && commitCloseH.stdout) || "{}");
  if ((commitCloseP.code_changes || {}).code_apply_residual !== false) throw new Error("commit close code_apply");
  if ((commitCloseP.code_changes || {}).git_commit_residual !== false) {
    throw new Error("git_commit_residual must close: " + JSON.stringify(commitCloseP.code_changes || {}).slice(0, 200));
  }
  if ((commitCloseP.code_changes || {}).git_push_residual !== true) {
    throw new Error("git_push_residual after commit: " + JSON.stringify(commitCloseP.code_changes || {}).slice(0, 200));
  }
  if ((commitCloseP.code_changes || {}).pretend_committed === true) throw new Error("pretend_committed commit");
  console.log("mcp_call apply_patch commit residual close ok", (commitCloseP.code_changes || {}).commit_sha, (commitCloseP.code_changes || {}).git_commit_residual, (commitCloseP.code_changes || {}).git_push_residual);
  stripHostAppliedMarker(readmeTarget);
  process.env.BITBOT_CODE_PUSH = "1";
  process.env.BITBOT_GIT_MOCK_LOG_DIR = "/tmp/bitbot-mcp-git-mock-push";
  const pushCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.apply_patch|{\"path\":\"README.mbt.md\"}" }]);
  const pushCloseH = pushCloseRuns.find((r) => r && r.kind === "mcp_call");
  const pushCloseP = JSON.parse((pushCloseH && pushCloseH.stdout) || "{}");
  if ((pushCloseP.code_changes || {}).code_apply_residual !== false) throw new Error("push close code_apply");
  if ((pushCloseP.code_changes || {}).git_commit_residual !== false) throw new Error("push close git_commit");
  if ((pushCloseP.code_changes || {}).git_push_residual !== false) {
    throw new Error("git_push_residual must close: " + JSON.stringify(pushCloseP.code_changes || {}).slice(0, 200));
  }
  if ((pushCloseP.code_changes || {}).pretend_pushed === true) throw new Error("pretend_pushed");
  console.log("mcp_call apply_patch push residual close ok", (pushCloseP.code_changes || {}).commit_sha, (pushCloseP.code_changes || {}).git_push_residual);
  stripHostAppliedMarker(readmeTarget);
  delete process.env.BITBOT_CODE_APPLY;
  delete process.env.BITBOT_CODE_COMMIT;
  delete process.env.BITBOT_CODE_PUSH;
  delete process.env.BITBOT_GIT_BIN;
  delete process.env.BITBOT_GIT_MOCK_LOG_DIR;
  // 2) create_pr: BITBOT_GH_CREATE_PR + BITBOT_GH_PR_CREATE + BITBOT_GH_BIN mock
  require("child_process").execSync("rm -rf /tmp/bitbot-mcp-gh-mock && mkdir -p /tmp/bitbot-mcp-gh-mock");
  process.env.BITBOT_GH_CREATE_PR = "1";
  process.env.BITBOT_GH_PR_CREATE = "1";
  process.env.BITBOT_GH_BIN = path.join(process.cwd(), "scripts/host_gh_mock.sh");
  process.env.BITBOT_GH_MOCK_LOG_DIR = "/tmp/bitbot-mcp-gh-mock";
  const prCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.create_pr|{}" }]);
  const prCloseH = prCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!prCloseH || !prCloseH.ok) throw new Error("create_pr residual close mcp");
  const prCloseP = JSON.parse(prCloseH.stdout || "{}");
  if (prCloseP.mapped !== "host_source_control" || prCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(prCloseP).slice(0, 200));
  }
  if ((prCloseP.source_control || {}).remote_pr_residual !== false) {
    throw new Error("remote_pr_residual must close: " + JSON.stringify(prCloseP.source_control || {}).slice(0, 240));
  }
  if ((prCloseP.source_control || {}).gh_pr_create_residual !== false) {
    throw new Error("gh_pr_create_residual must close: " + JSON.stringify(prCloseP.source_control || {}).slice(0, 240));
  }
  if ((prCloseP.source_control || {}).pretend_remote_pr === true) throw new Error("pretend_remote_pr close");
  require("fs").writeFileSync("/tmp/bitbot-mcp-create-pr-close.json", JSON.stringify({ ok: true, ...prCloseP }, null, 2));
  console.log("mcp_call create_pr residual close ok", prCloseP.mapped, (prCloseP.source_control || {}).remote_pr_residual, (prCloseP.source_control || {}).gh_pr_create_residual);
  delete process.env.BITBOT_GH_CREATE_PR;
  delete process.env.BITBOT_GH_PR_CREATE;
  delete process.env.BITBOT_GH_BIN;
  delete process.env.BITBOT_GH_MOCK_LOG_DIR;
  // 3) claim_inbox: mail_claim mock closes live_mail_claim_residual; empty keeps true
  // Ports 18807/18808 avoid calendar/purchase/gmail mcp live (18804-18806).
  const claimCloseMock = startMock(18807, "mail_claim", "smoke-mcp-claim");
  const claimEmptyMock = startMock(18808, "mail_claim", "smoke-mcp-claim-empty", true);
  await sleep(500);
  try {
    process.env.BITBOT_MAIL_CLAIM_API_URL = "http://127.0.0.1:18807";
    process.env.BITBOT_MAIL_CLAIM_TOKEN = "smoke-mcp-claim";
    process.env.BITBOT_MAIL_CLAIM_POST = "1";
    const claimCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.claim_inbox|{\"local_part\":\"mcpclaimlive\",\"address\":\"mcpclaimlive@bitbot.local\"}" }]);
    const claimCloseH = claimCloseRuns.find((r) => r && r.kind === "mcp_call");
    if (!claimCloseH || !claimCloseH.ok) throw new Error("claim_inbox residual close mcp");
    const claimCloseP = JSON.parse(claimCloseH.stdout || "{}");
    if (claimCloseP.mapped !== "host_mail_claim_inbox" || claimCloseP.product_tool_residual !== false) {
      throw new Error(JSON.stringify(claimCloseP).slice(0, 200));
    }
    if ((claimCloseP.mail_claim || {}).live_mail_claim_residual !== false) {
      throw new Error("live_mail_claim_residual must close: " + JSON.stringify(claimCloseP.mail_claim || {}).slice(0, 240));
    }
    if (!((claimCloseP.mail_claim || {}).claimed_count >= 1)) {
      throw new Error("claimed_count live: " + JSON.stringify(claimCloseP.mail_claim || {}).slice(0, 200));
    }
    if ((claimCloseP.mail_claim || {}).pretend_claimed === true) throw new Error("pretend_claimed close");
    require("fs").writeFileSync("/tmp/bitbot-mcp-claim-close.json", JSON.stringify({ ok: true, ...claimCloseP }, null, 2));
    console.log("mcp_call claim_inbox residual close ok", claimCloseP.mapped, (claimCloseP.mail_claim || {}).mode, (claimCloseP.mail_claim || {}).live_mail_claim_residual);
    process.env.BITBOT_MAIL_CLAIM_API_URL = "http://127.0.0.1:18808";
    process.env.BITBOT_MAIL_CLAIM_TOKEN = "smoke-mcp-claim-empty";
    process.env.BITBOT_MAIL_CLAIM_POST = "1";
    const claimEmptyRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.claim_inbox|{\"local_part\":\"mcpclaimempty\",\"address\":\"mcpclaimempty@bitbot.local\"}" }]);
    const claimEmptyH = claimEmptyRuns.find((r) => r && r.kind === "mcp_call");
    const claimEmptyP = JSON.parse((claimEmptyH && claimEmptyH.stdout) || "{}");
    if (claimEmptyP.mapped !== "host_mail_claim_inbox" || claimEmptyP.product_tool_residual !== false) {
      throw new Error(JSON.stringify(claimEmptyP).slice(0, 200));
    }
    if ((claimEmptyP.mail_claim || {}).live_mail_claim_residual !== true) {
      throw new Error("empty inbox must keep live_mail_claim_residual: " + JSON.stringify(claimEmptyP.mail_claim || {}).slice(0, 240));
    }
    if ((claimEmptyP.mail_claim || {}).claimed_count !== 0) {
      throw new Error("empty claimed_count: " + JSON.stringify(claimEmptyP.mail_claim || {}).slice(0, 200));
    }
    console.log("mcp_call claim_inbox empty residual open ok", (claimEmptyP.mail_claim || {}).mode, (claimEmptyP.mail_claim || {}).claimed_count, (claimEmptyP.mail_claim || {}).live_mail_claim_residual);
  } finally {
    try { claimCloseMock.kill(); } catch (_) {}
    try { claimEmptyMock.kill(); } catch (_) {}
    delete process.env.BITBOT_MAIL_CLAIM_API_URL;
    delete process.env.BITBOT_MAIL_CLAIM_TOKEN;
    delete process.env.BITBOT_MAIL_CLAIM_POST;
  }
  // 4) launch_cloud_agent + deliver_cloud_artifact with cloud mock
  // Port 18809 avoids mail_claim mcp close (18807/18808) and cal/pay/gmail (18804-18806).
  const cloudCloseMock = startMock(18809, "cloud", "smoke-mcp-cloud");
  await sleep(500);
  try {
    process.env.BITBOT_CLOUD_API_URL = "http://127.0.0.1:18809";
    process.env.BITBOT_CURSOR_CLOUD_TOKEN = "smoke-mcp-cloud";
    delete process.env.BITBOT_CLOUD_API_TOKEN;
    delete process.env.BITBOT_CLOUD_ARTIFACT_FETCH;
    const cloudCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.launch_cloud_agent|{\"bc_id\":\"bc-mcp-close\",\"prompt\":\"mcp cloud residual close\"}" }]);
    const cloudCloseH = cloudCloseRuns.find((r) => r && r.kind === "mcp_call");
    if (!cloudCloseH || !cloudCloseH.ok) throw new Error("launch_cloud_agent residual close mcp");
    const cloudCloseP = JSON.parse(cloudCloseH.stdout || "{}");
    if (cloudCloseP.mapped !== "host_cloud_agent_launch" || cloudCloseP.product_tool_residual !== false) {
      throw new Error(JSON.stringify(cloudCloseP).slice(0, 200));
    }
    if ((cloudCloseP.cloud_launch || {}).remote_cloud_residual !== false) {
      throw new Error("remote_cloud_residual must close: " + JSON.stringify(cloudCloseP.cloud_launch || {}).slice(0, 240));
    }
    if ((cloudCloseP.cloud_launch || {}).pretend_remote_cloud === true) throw new Error("pretend_remote_cloud close");
    require("fs").writeFileSync("/tmp/bitbot-mcp-cloud-close.json", JSON.stringify({ ok: true, ...cloudCloseP }, null, 2));
    console.log("mcp_call launch_cloud_agent residual close ok", cloudCloseP.mapped, (cloudCloseP.cloud_launch || {}).mode, (cloudCloseP.cloud_launch || {}).remote_cloud_residual);
    process.env.BITBOT_CLOUD_ARTIFACT_FETCH = "1";
    const artCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.deliver_cloud_artifact|{\"bc_id\":\"bc-mcp-close\",\"dest\":\"mcp-cloud-close.md\"}" }]);
    const artCloseH = artCloseRuns.find((r) => r && r.kind === "mcp_call");
    if (!artCloseH || !artCloseH.ok) throw new Error("deliver_cloud_artifact residual close mcp");
    const artCloseP = JSON.parse(artCloseH.stdout || "{}");
    if (artCloseP.mapped !== "host_cloud_artifact_deliver" || artCloseP.product_tool_residual !== false) {
      throw new Error(JSON.stringify(artCloseP).slice(0, 200));
    }
    if ((artCloseP.cloud_artifact || {}).remote_cloud_artifact_residual !== false) {
      throw new Error("remote_cloud_artifact_residual must close: " + JSON.stringify(artCloseP.cloud_artifact || {}).slice(0, 240));
    }
    if ((artCloseP.cloud_artifact || {}).pretend_remote_fetch === true) throw new Error("pretend_remote_fetch close");
    require("fs").writeFileSync("/tmp/bitbot-mcp-cloud-art-close.json", JSON.stringify({ ok: true, ...artCloseP }, null, 2));
    console.log("mcp_call deliver_cloud_artifact residual close ok", artCloseP.mapped, (artCloseP.cloud_artifact || {}).mode, (artCloseP.cloud_artifact || {}).remote_cloud_artifact_residual);
  } finally {
    try { cloudCloseMock.kill(); } catch (_) {}
    delete process.env.BITBOT_CLOUD_API_URL;
    delete process.env.BITBOT_CURSOR_CLOUD_TOKEN;
    delete process.env.BITBOT_CLOUD_API_TOKEN;
    delete process.env.BITBOT_CLOUD_ARTIFACT_FETCH;
  }
  // 5) voice_start/relay: BITBOT_STT_BIN + BITBOT_ESPEAK_BIN close STT/TTS residuals
  require("child_process").execSync("rm -rf /tmp/bitbot-mcp-stt-mock /tmp/bitbot-mcp-espeak-mock && mkdir -p /tmp/bitbot-mcp-stt-mock /tmp/bitbot-mcp-espeak-mock");
  process.env.BITBOT_STT_BIN = path.join(process.cwd(), "scripts/host_stt_mock.sh");
  process.env.BITBOT_ESPEAK_BIN = path.join(process.cwd(), "scripts/host_espeak_mock.sh");
  process.env.BITBOT_STT_MOCK_LOG_DIR = "/tmp/bitbot-mcp-stt-mock";
  process.env.BITBOT_ESPEAK_MOCK_LOG_DIR = "/tmp/bitbot-mcp-espeak-mock";
  delete process.env.BITBOT_VOICE_STT;
  const voiceCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.voice_start|{\"call_id\":\"mcp-voice-close\"}" }]);
  const voiceCloseH = voiceCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!voiceCloseH || !voiceCloseH.ok) throw new Error("voice_start residual close mcp");
  const voiceCloseP = JSON.parse(voiceCloseH.stdout || "{}");
  if (voiceCloseP.mapped !== "host_voice_session" || voiceCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(voiceCloseP).slice(0, 200));
  }
  if ((voiceCloseP.voice_session || {}).voice_stt_residual !== false) {
    throw new Error("voice_stt_residual must close: " + JSON.stringify(voiceCloseP.voice_session || {}).slice(0, 240));
  }
  if ((voiceCloseP.voice_session || {}).voice_tts_residual !== false) {
    throw new Error("voice_tts_residual must close: " + JSON.stringify(voiceCloseP.voice_session || {}).slice(0, 240));
  }
  if ((voiceCloseP.voice_session || {}).pretend_live === true) throw new Error("pretend_live voice close");
  require("fs").writeFileSync("/tmp/bitbot-mcp-voice-close.json", JSON.stringify({ ok: true, ...voiceCloseP }, null, 2));
  console.log("mcp_call voice_start residual close ok", voiceCloseP.mapped, (voiceCloseP.voice_session || {}).voice_stt_residual, (voiceCloseP.voice_session || {}).voice_tts_residual);
  // $stt forces STT on session WAV (typed text alone keeps voice_stt_residual).
  const relayCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.voice_relay|{\"call_id\":\"mcp-voice-close\",\"text\":\"$stt\"}" }]);
  const relayCloseH = relayCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!relayCloseH || !relayCloseH.ok) throw new Error("voice_relay residual close mcp");
  const relayCloseP = JSON.parse(relayCloseH.stdout || "{}");
  if (relayCloseP.mapped !== "host_voice_relay" || relayCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(relayCloseP).slice(0, 200));
  }
  if ((relayCloseP.voice_relay || {}).voice_stt_residual !== false) {
    throw new Error("voice_stt_residual relay must close: " + JSON.stringify(relayCloseP.voice_relay || {}).slice(0, 240));
  }
  if ((relayCloseP.voice_relay || {}).voice_tts_residual !== false) {
    throw new Error("voice_tts_residual relay must close: " + JSON.stringify(relayCloseP.voice_relay || {}).slice(0, 240));
  }
  if ((relayCloseP.voice_relay || {}).pretend_silent === true) throw new Error("pretend_silent relay close");
  require("fs").writeFileSync("/tmp/bitbot-mcp-voice-relay-close.json", JSON.stringify({ ok: true, ...relayCloseP }, null, 2));
  console.log("mcp_call voice_relay residual close ok", relayCloseP.mapped, (relayCloseP.voice_relay || {}).voice_stt_residual, (relayCloseP.voice_relay || {}).voice_tts_residual);
  delete process.env.BITBOT_STT_BIN;
  delete process.env.BITBOT_ESPEAK_BIN;
  delete process.env.BITBOT_STT_MOCK_LOG_DIR;
  delete process.env.BITBOT_ESPEAK_MOCK_LOG_DIR;
  // 6) copy_to_box / copy_from_box: BITBOT_COPYBOX_REMOTE + BITBOT_SCP_BIN closes cross_machine_copy_residual
  require("child_process").execSync("rm -rf /tmp/bitbot-mcp-scp-to /tmp/bitbot-mcp-scp-from && mkdir -p /tmp/bitbot-mcp-scp-to /tmp/bitbot-mcp-scp-from uploads");
  fs.writeFileSync("uploads/mcp-copy-close-src.txt", "mcp copy residual close\n");
  try { fs.unlinkSync("uploads/mcp-copy-close-dest.txt"); } catch (_) {}
  try { fs.unlinkSync("uploads/mcp-copy-close-from-dest.txt"); } catch (_) {}
  process.env.BITBOT_COPYBOX_REMOTE = "1";
  process.env.BITBOT_COPYBOX_SSH = "smoke@127.0.0.1";
  process.env.BITBOT_SCP_BIN = path.join(process.cwd(), "scripts/host_scp_mock.sh");
  process.env.BITBOT_SCP_MOCK_LOG_DIR = "/tmp/bitbot-mcp-scp-to";
  const copyToCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.copy_to_box|{\"machine_id\":\"remote-close\",\"src\":\"uploads/mcp-copy-close-src.txt\",\"dest\":\"uploads/mcp-copy-close-dest.txt\"}" }]);
  const copyToCloseH = copyToCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!copyToCloseH || !copyToCloseH.ok) throw new Error("copy_to_box residual close mcp");
  const copyToCloseP = JSON.parse(copyToCloseH.stdout || "{}");
  if (copyToCloseP.mapped !== "host_copy_to_box" || copyToCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(copyToCloseP).slice(0, 200));
  }
  if ((copyToCloseP.copy_box || {}).cross_machine_copy_residual !== false) {
    throw new Error("cross_machine_copy_residual must close: " + JSON.stringify(copyToCloseP.copy_box || {}).slice(0, 240));
  }
  if ((copyToCloseP.copy_box || {}).pretend_remote_machine === true) throw new Error("pretend_remote_machine copy_to close");
  if (((copyToCloseP.copy_box || {}).remote || {}).ok !== true) {
    throw new Error("copy_to remote.ok: " + JSON.stringify((copyToCloseP.copy_box || {}).remote || {}).slice(0, 200));
  }
  require("fs").writeFileSync("/tmp/bitbot-mcp-copy-to-close.json", JSON.stringify({ ok: true, ...copyToCloseP }, null, 2));
  console.log("mcp_call copy_to_box residual close ok", copyToCloseP.mapped, (copyToCloseP.copy_box || {}).cross_machine_copy_residual, ((copyToCloseP.copy_box || {}).remote || {}).scp_bin);
  process.env.BITBOT_SCP_MOCK_LOG_DIR = "/tmp/bitbot-mcp-scp-from";
  const copyFromCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.copy_from_box|{\"machine_id\":\"remote-close\",\"src\":\"uploads/mcp-copy-close-src.txt\",\"dest\":\"uploads/mcp-copy-close-from-dest.txt\",\"overwrite\":\"allow\"}" }]);
  const copyFromCloseH = copyFromCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!copyFromCloseH || !copyFromCloseH.ok) throw new Error("copy_from_box residual close mcp");
  const copyFromCloseP = JSON.parse(copyFromCloseH.stdout || "{}");
  if (copyFromCloseP.mapped !== "host_copy_from_box" || copyFromCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(copyFromCloseP).slice(0, 200));
  }
  if ((copyFromCloseP.copy_box || {}).cross_machine_copy_residual !== false) {
    throw new Error("copy_from cross_machine_copy_residual must close: " + JSON.stringify(copyFromCloseP.copy_box || {}).slice(0, 240));
  }
  if ((copyFromCloseP.copy_box || {}).pretend_remote_machine === true) throw new Error("pretend_remote_machine copy_from close");
  if (((copyFromCloseP.copy_box || {}).remote || {}).ok !== true) {
    throw new Error("copy_from remote.ok: " + JSON.stringify((copyFromCloseP.copy_box || {}).remote || {}).slice(0, 200));
  }
  require("fs").writeFileSync("/tmp/bitbot-mcp-copy-from-close.json", JSON.stringify({ ok: true, ...copyFromCloseP }, null, 2));
  console.log("mcp_call copy_from_box residual close ok", copyFromCloseP.mapped, (copyFromCloseP.copy_box || {}).cross_machine_copy_residual, ((copyFromCloseP.copy_box || {}).remote || {}).scp_bin);
  delete process.env.BITBOT_COPYBOX_REMOTE;
  delete process.env.BITBOT_COPYBOX_SSH;
  delete process.env.BITBOT_SCP_BIN;
  delete process.env.BITBOT_SCP_MOCK_LOG_DIR;
  // 7) screenshot: BITBOT_SCREENSHOT_FIXTURE=1 closes screenshot_residual (no live DISPLAY)
  const savedDisplayClose = process.env.DISPLAY;
  delete process.env.DISPLAY;
  process.env.BITBOT_SCREENSHOT_FIXTURE = "1";
  const shotFxCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.screenshot|{\"agent\":\"mcp-fx-close\"}" }]);
  const shotFxCloseH = shotFxCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!shotFxCloseH || !shotFxCloseH.ok) throw new Error("screenshot residual close mcp");
  const shotFxCloseP = JSON.parse(shotFxCloseH.stdout || "{}");
  if (shotFxCloseP.mapped !== "host_screenshot" || shotFxCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(shotFxCloseP).slice(0, 200));
  }
  if ((shotFxCloseP.screenshot || {}).screenshot_residual !== false) {
    throw new Error("screenshot_residual must close: " + JSON.stringify(shotFxCloseP.screenshot || {}).slice(0, 240));
  }
  if ((shotFxCloseP.screenshot || {}).has_frame !== true) throw new Error("fixture has_frame");
  if ((shotFxCloseP.screenshot || {}).tool !== "fixture") {
    throw new Error("fixture tool: " + JSON.stringify(shotFxCloseP.screenshot || {}).slice(0, 200));
  }
  if ((shotFxCloseP.screenshot || {}).pretend_frame === true || (shotFxCloseP.screenshot || {}).pretend_live === true) {
    throw new Error("pretend screenshot close");
  }
  require("fs").writeFileSync("/tmp/bitbot-mcp-screenshot-close.json", JSON.stringify({ ok: true, ...shotFxCloseP }, null, 2));
  console.log("mcp_call screenshot residual close ok", shotFxCloseP.mapped, (shotFxCloseP.screenshot || {}).tool, (shotFxCloseP.screenshot || {}).screenshot_residual);
  delete process.env.BITBOT_SCREENSHOT_FIXTURE;
  if (savedDisplayClose !== undefined) process.env.DISPLAY = savedDisplayClose;
  // 8) routine_schedule: BITBOT_ROUTINE_LONG_LIVED=1 closes long_lived_cron_residual
  process.env.BITBOT_ROUTINE_LONG_LIVED = "1";
  const routLlCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.routine_schedule|{\"id\":\"mcp-r-ll-close\",\"cron\":\"@daily\",\"prompt\":\"mcp routine residual close\"}" }]);
  const routLlCloseH = routLlCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!routLlCloseH || !routLlCloseH.ok) throw new Error("routine_schedule residual close mcp");
  const routLlCloseP = JSON.parse(routLlCloseH.stdout || "{}");
  if (routLlCloseP.mapped !== "host_routine_schedule" || routLlCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(routLlCloseP).slice(0, 200));
  }
  if ((routLlCloseP.routine_schedule || {}).long_lived_cron_residual !== false) {
    throw new Error("long_lived_cron_residual must close: " + JSON.stringify(routLlCloseP.routine_schedule || {}).slice(0, 240));
  }
  if ((routLlCloseP.routine_schedule || {}).stored !== true) {
    throw new Error("routine stored close: " + JSON.stringify(routLlCloseP.routine_schedule || {}).slice(0, 200));
  }
  if ((routLlCloseP.routine_schedule || {}).pretend_scheduled === true) throw new Error("pretend_scheduled close");
  require("fs").writeFileSync("/tmp/bitbot-mcp-routine-close.json", JSON.stringify({ ok: true, ...routLlCloseP }, null, 2));
  console.log("mcp_call routine_schedule residual close ok", routLlCloseP.mapped, (routLlCloseP.routine_schedule || {}).id, (routLlCloseP.routine_schedule || {}).long_lived_cron_residual);
  delete process.env.BITBOT_ROUTINE_LONG_LIVED;
  // 9) get_balance / finance_*: BITBOT_FINANCE_API_URL + TOKEN → live_finance_residual false
  // Ports 18810/18811/18812 avoid cloud close (18809) and cal/pay/gmail (18804-18806).
  try { fs.unlinkSync("data/connectors/finance_token.json"); } catch (_) {}
  try { fs.unlinkSync("data/connectors/job_token.json"); } catch (_) {}
  try { fs.unlinkSync("data/connectors/x_token.json"); } catch (_) {}
  const finCloseMock = startMock(18810, "finance", "smoke-mcp-fin");
  const jobCloseMock = startMock(18811, "job", "smoke-mcp-job");
  const xCloseMock = startMock(18812, "x", "smoke-mcp-x");
  await sleep(500);
  try {
    process.env.BITBOT_FINANCE_API_URL = "http://127.0.0.1:18810";
    process.env.BITBOT_FINANCE_TOKEN = "smoke-mcp-fin";
    const finCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.get_balance|{}" }]);
    const finCloseH = finCloseRuns.find((r) => r && r.kind === "mcp_call");
    if (!finCloseH || !finCloseH.ok) throw new Error("get_balance residual close mcp");
    const finCloseP = JSON.parse(finCloseH.stdout || "{}");
    if (finCloseP.mapped !== "host_finance_call" || finCloseP.product_tool_residual !== false) {
      throw new Error(JSON.stringify(finCloseP).slice(0, 200));
    }
    if ((finCloseP.finance || {}).live_finance_residual !== false || (finCloseP.finance || {}).mode !== "finance_live") {
      throw new Error("live_finance_residual must close: " + JSON.stringify(finCloseP.finance || {}).slice(0, 240));
    }
    if ((finCloseP.finance || {}).pretend_live === true) throw new Error("pretend_live finance close");
    require("fs").writeFileSync("/tmp/bitbot-mcp-finance-close.json", JSON.stringify({ ok: true, ...finCloseP }, null, 2));
    console.log("mcp_call get_balance residual close ok", finCloseP.mapped, (finCloseP.finance || {}).mode, (finCloseP.finance || {}).live_finance_residual);
    const finStarCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.finance_list_accounts|{}" }]);
    const finStarCloseH = finStarCloseRuns.find((r) => r && r.kind === "mcp_call");
    if (!finStarCloseH || !finStarCloseH.ok) throw new Error("finance_* residual close mcp");
    const finStarCloseP = JSON.parse(finStarCloseH.stdout || "{}");
    if (finStarCloseP.mapped !== "host_finance_call" || finStarCloseP.product_tool_residual !== false) {
      throw new Error(JSON.stringify(finStarCloseP).slice(0, 200));
    }
    if ((finStarCloseP.finance || {}).live_finance_residual !== false || (finStarCloseP.finance || {}).mode !== "finance_live") {
      throw new Error("finance_* live_finance_residual must close: " + JSON.stringify(finStarCloseP.finance || {}).slice(0, 240));
    }
    console.log("mcp_call finance_* residual close ok", finStarCloseP.mapped, (finStarCloseP.finance || {}).mode, (finStarCloseP.finance || {}).live_finance_residual, (finStarCloseP.finance || {}).tool || finStarCloseP.tool);
    // 10) search_jobs: BITBOT_JOB_API_URL + TOKEN → live_job_residual false
    process.env.BITBOT_JOB_API_URL = "http://127.0.0.1:18811";
    process.env.BITBOT_JOB_TOKEN = "smoke-mcp-job";
    const jobCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.search_jobs|{\"q\":\"engineer\"}" }]);
    const jobCloseH = jobCloseRuns.find((r) => r && r.kind === "mcp_call");
    if (!jobCloseH || !jobCloseH.ok) throw new Error("search_jobs residual close mcp");
    const jobCloseP = JSON.parse(jobCloseH.stdout || "{}");
    if (jobCloseP.mapped !== "host_job_search" || jobCloseP.product_tool_residual !== false) {
      throw new Error(JSON.stringify(jobCloseP).slice(0, 200));
    }
    if ((jobCloseP.job_search || {}).live_job_residual !== false || (jobCloseP.job_search || {}).mode !== "job_live") {
      throw new Error("live_job_residual must close: " + JSON.stringify(jobCloseP.job_search || {}).slice(0, 240));
    }
    if ((jobCloseP.job_search || {}).pretend_applied === true) throw new Error("pretend_applied job close");
    if (!((jobCloseP.job_search || {}).hit_count >= 1)) {
      throw new Error("job hit_count close: " + JSON.stringify(jobCloseP.job_search || {}).slice(0, 200));
    }
    require("fs").writeFileSync("/tmp/bitbot-mcp-job-close.json", JSON.stringify({ ok: true, ...jobCloseP }, null, 2));
    console.log("mcp_call search_jobs residual close ok", jobCloseP.mapped, (jobCloseP.job_search || {}).mode, (jobCloseP.job_search || {}).live_job_residual);
    // 11) search_posts / x_search: BITBOT_X_API_BASE + BEARER → live_x_residual false
    process.env.BITBOT_X_API_BASE = "http://127.0.0.1:18812";
    process.env.BITBOT_X_BEARER = "smoke-mcp-x";
    delete process.env.BITBOT_X_TOKEN;
    const xCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.search_posts|{\"q\":\"smoke-close\"}" }]);
    const xCloseH = xCloseRuns.find((r) => r && r.kind === "mcp_call");
    if (!xCloseH || !xCloseH.ok) throw new Error("search_posts residual close mcp");
    const xCloseP = JSON.parse(xCloseH.stdout || "{}");
    if (xCloseP.mapped !== "host_x_search" || xCloseP.product_tool_residual !== false) {
      throw new Error(JSON.stringify(xCloseP).slice(0, 200));
    }
    if ((xCloseP.x_search || {}).live_x_residual !== false || (xCloseP.x_search || {}).mode !== "x_live") {
      throw new Error("live_x_residual must close: " + JSON.stringify(xCloseP.x_search || {}).slice(0, 240));
    }
    if ((xCloseP.x_search || {}).pretend_live === true) throw new Error("pretend_live x close");
    if (!((xCloseP.x_search || {}).hit_count >= 1)) {
      throw new Error("x hit_count close: " + JSON.stringify(xCloseP.x_search || {}).slice(0, 200));
    }
    require("fs").writeFileSync("/tmp/bitbot-mcp-x-close.json", JSON.stringify({ ok: true, ...xCloseP }, null, 2));
    console.log("mcp_call search_posts residual close ok", xCloseP.mapped, (xCloseP.x_search || {}).mode, (xCloseP.x_search || {}).live_x_residual);
    const xAliasCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.x_search|{\"q\":\"alias-close\"}" }]);
    const xAliasCloseH = xAliasCloseRuns.find((r) => r && r.kind === "mcp_call");
    if (!xAliasCloseH || !xAliasCloseH.ok) throw new Error("x_search residual close mcp");
    const xAliasCloseP = JSON.parse(xAliasCloseH.stdout || "{}");
    if (xAliasCloseP.mapped !== "host_x_search" || xAliasCloseP.product_tool_residual !== false) {
      throw new Error(JSON.stringify(xAliasCloseP).slice(0, 200));
    }
    if ((xAliasCloseP.x_search || {}).live_x_residual !== false || (xAliasCloseP.x_search || {}).mode !== "x_live") {
      throw new Error("x_search live_x_residual must close: " + JSON.stringify(xAliasCloseP.x_search || {}).slice(0, 240));
    }
    console.log("mcp_call x_search residual close ok", xAliasCloseP.mapped, (xAliasCloseP.x_search || {}).mode, (xAliasCloseP.x_search || {}).live_x_residual);
  } finally {
    try { finCloseMock.kill(); } catch (_) {}
    try { jobCloseMock.kill(); } catch (_) {}
    try { xCloseMock.kill(); } catch (_) {}
    delete process.env.BITBOT_FINANCE_API_URL;
    delete process.env.BITBOT_FINANCE_TOKEN;
    delete process.env.BITBOT_JOB_API_URL;
    delete process.env.BITBOT_JOB_TOKEN;
    delete process.env.BITBOT_X_API_BASE;
    delete process.env.BITBOT_X_BEARER;
    delete process.env.BITBOT_X_TOKEN;
  }
  // 12) Optional fill_credential + BITBOT_CREDENTIAL_FILL_MOCK=1 → credential_browser_fill_residual false; signin_fill_residual stays true
  // Do NOT close password/OS dialog / IdP signin_fill (deferred).
  process.env.BITBOT_CREDENTIAL_FILL_MOCK = "1";
  delete process.env.BITBOT_CREDENTIAL_BROWSER_FILL;
  const fillMockCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.fill_credential|{\"fill_handle\":\"mcp-fill-close\",\"domain\":\"login.example.test\",\"username\":\"mcp-close@example.test\"}" }]);
  const fillMockCloseH = fillMockCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!fillMockCloseH || !fillMockCloseH.ok) throw new Error("fill_credential residual close mcp");
  const fillMockCloseP = JSON.parse(fillMockCloseH.stdout || "{}");
  if (fillMockCloseP.mapped !== "host_credential_fill" || fillMockCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(fillMockCloseP).slice(0, 200));
  }
  if ((fillMockCloseP.credential_fill || {}).credential_browser_fill_residual !== false) {
    throw new Error("credential_browser_fill_residual must close: " + JSON.stringify(fillMockCloseP.credential_fill || {}).slice(0, 240));
  }
  if (fillMockCloseP.signin_fill_residual !== true || (fillMockCloseP.credential_fill || {}).signin_fill_residual !== true) {
    throw new Error("signin_fill_residual must stay true: " + JSON.stringify(fillMockCloseP).slice(0, 240));
  }
  if ((fillMockCloseP.credential_fill || {}).mode !== "host_credential_fill_username_mock") {
    throw new Error("fill mock mode: " + JSON.stringify(fillMockCloseP.credential_fill || {}).slice(0, 200));
  }
  if (fillMockCloseP.secret_echoed === true || (fillMockCloseP.credential_fill || {}).secret_echoed === true) {
    throw new Error("secret_echoed fill close");
  }
  if (/vault:secret/i.test(JSON.stringify(fillMockCloseP))) throw new Error("secret leak fill close");
  require("fs").writeFileSync("/tmp/bitbot-mcp-fill-close.json", JSON.stringify({ ok: true, ...fillMockCloseP }, null, 2));
  console.log("mcp_call fill_credential residual close ok", fillMockCloseP.mapped, (fillMockCloseP.credential_fill || {}).mode, (fillMockCloseP.credential_fill || {}).credential_browser_fill_residual, fillMockCloseP.signin_fill_residual);
  delete process.env.BITBOT_CREDENTIAL_FILL_MOCK;
  // 13) computer_use: BITBOT_CU_OCR + TESSERACT_BIN + CU_NATIVE_ACT + XDOTOOL_BIN → ocr_residual + os_window_automation_residual false
  // Do NOT touch IdP/signin_fill/OS dialogs or invent password fill.
  require("child_process").execSync("rm -rf /tmp/bitbot-mcp-tesseract-close /tmp/bitbot-mcp-xdotool-close && mkdir -p /tmp/bitbot-mcp-tesseract-close /tmp/bitbot-mcp-xdotool-close");
  process.env.BITBOT_CU_OCR = "1";
  process.env.BITBOT_TESSERACT_BIN = path.join(process.cwd(), "scripts/host_tesseract_mock.sh");
  process.env.BITBOT_TESSERACT_MOCK_LOG_DIR = "/tmp/bitbot-mcp-tesseract-close";
  process.env.BITBOT_CU_NATIVE_ACT = "1";
  process.env.BITBOT_XDOTOOL_BIN = path.join(process.cwd(), "scripts/host_xdotool_mock.sh");
  process.env.BITBOT_XDOTOOL_MOCK_LOG_DIR = "/tmp/bitbot-mcp-xdotool-close";
  const cuOcrActCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.computer_use|{\"command\":\"computer use open https://example.com click:40,40\"}" }]);
  const cuOcrActCloseH = cuOcrActCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!cuOcrActCloseH || !cuOcrActCloseH.ok) throw new Error("computer_use residual close mcp");
  const cuOcrActCloseP = JSON.parse(cuOcrActCloseH.stdout || "{}");
  if (cuOcrActCloseP.mapped !== "host_computer_use" || cuOcrActCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(cuOcrActCloseP).slice(0, 200));
  }
  const cuOcrActOc = (cuOcrActCloseP.computer_use || {}).outcome || {};
  const cuOcrActGui = (cuOcrActCloseP.computer_use || {}).gui || {};
  const cuOcrActVp = cuOcrActGui.vision_plan || {};
  const cuOcrActVision = cuOcrActVp.vision || {};
  const cuOcrClosed =
    cuOcrActOc.ocr_residual === false ||
    cuOcrActVision.ocr_residual === false ||
    cuOcrActVp.ocr_residual === false;
  if (!cuOcrClosed) {
    throw new Error("ocr_residual must close: " + JSON.stringify({ outcome: cuOcrActOc, vision_plan: cuOcrActVp }).slice(0, 280));
  }
  const cuOsAutoClosed =
    cuOcrActGui.os_window_automation_residual === false ||
    ((cuOcrActGui.native_os_act || {}).os_window_automation_residual === false) ||
    cuOcrActOc.os_window_automation_residual === false;
  if (!cuOsAutoClosed) {
    throw new Error("os_window_automation_residual must close: " + JSON.stringify({ gui: cuOcrActGui, outcome: cuOcrActOc }).slice(0, 280));
  }
  if (cuOcrActOc.pretend_purchased === true) throw new Error("pretend_purchased cu close");
  if (!fs.existsSync("/tmp/bitbot-mcp-tesseract-close/last-ocr.json")) throw new Error("tesseract mock log missing");
  if (!fs.existsSync("/tmp/bitbot-mcp-xdotool-close/last-xdotool.json")) throw new Error("xdotool mock log missing");
  require("fs").writeFileSync("/tmp/bitbot-mcp-cu-ocr-act-close.json", JSON.stringify({ ok: true, ...cuOcrActCloseP }, null, 2));
  console.log("mcp_call computer_use residual close ok", cuOcrActCloseP.mapped, "ocr_residual", false, "os_window_automation_residual", false);
  delete process.env.BITBOT_CU_OCR;
  delete process.env.BITBOT_TESSERACT_BIN;
  delete process.env.BITBOT_TESSERACT_MOCK_LOG_DIR;
  delete process.env.BITBOT_CU_NATIVE_ACT;
  delete process.env.BITBOT_XDOTOOL_BIN;
  delete process.env.BITBOT_XDOTOOL_MOCK_LOG_DIR;
  // 14) device_tool camera/mic: data/device fixtures → device_capture_residual + device_tool_residual false
  fs.mkdirSync("data/device", { recursive: true });
  const camFxPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  fs.writeFileSync("data/device/camera.png", camFxPng);
  const micFxWav = Buffer.alloc(52);
  micFxWav.write("RIFF", 0); micFxWav.writeUInt32LE(44, 4); micFxWav.write("WAVE", 8);
  micFxWav.write("fmt ", 12); micFxWav.writeUInt32LE(16, 16); micFxWav.writeUInt16LE(1, 20);
  micFxWav.writeUInt16LE(1, 22); micFxWav.writeUInt32LE(8000, 24); micFxWav.writeUInt32LE(8000, 28);
  micFxWav.writeUInt16LE(1, 32); micFxWav.writeUInt16LE(8, 34);
  micFxWav.write("data", 36); micFxWav.writeUInt32LE(8, 40);
  fs.writeFileSync("data/device/mic.wav", micFxWav);
  const dtCamCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.device_tool|{\"machine_id\":\"mcp-dev-close\",\"tool\":\"camera\"}" }]);
  const dtCamCloseH = dtCamCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!dtCamCloseH || !dtCamCloseH.ok) throw new Error("device_tool camera residual close mcp");
  const dtCamCloseP = JSON.parse(dtCamCloseH.stdout || "{}");
  if (dtCamCloseP.mapped !== "host_device_tool" || dtCamCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(dtCamCloseP).slice(0, 200));
  }
  if ((dtCamCloseP.device_tool || {}).device_capture_residual !== false) {
    throw new Error("camera device_capture_residual must close: " + JSON.stringify(dtCamCloseP.device_tool || {}).slice(0, 240));
  }
  if ((dtCamCloseP.device_tool || {}).device_tool_residual !== false) {
    throw new Error("camera device_tool_residual must close: " + JSON.stringify(dtCamCloseP.device_tool || {}).slice(0, 240));
  }
  if (!((dtCamCloseP.device_tool || {}).executed === true || (dtCamCloseP.device_tool || {}).mode === "host_device_camera_fixture")) {
    throw new Error("camera fixture mode: " + JSON.stringify(dtCamCloseP.device_tool || {}).slice(0, 200));
  }
  require("fs").writeFileSync("/tmp/bitbot-mcp-device-camera-close.json", JSON.stringify({ ok: true, ...dtCamCloseP }, null, 2));
  console.log("mcp_call device_tool camera residual close ok", dtCamCloseP.mapped, (dtCamCloseP.device_tool || {}).mode, (dtCamCloseP.device_tool || {}).device_capture_residual, (dtCamCloseP.device_tool || {}).device_tool_residual);
  const dtMicCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.device_tool|{\"machine_id\":\"mcp-dev-close\",\"tool\":\"mic\"}" }]);
  const dtMicCloseH = dtMicCloseRuns.find((r) => r && r.kind === "mcp_call");
  if (!dtMicCloseH || !dtMicCloseH.ok) throw new Error("device_tool mic residual close mcp");
  const dtMicCloseP = JSON.parse(dtMicCloseH.stdout || "{}");
  if (dtMicCloseP.mapped !== "host_device_tool" || dtMicCloseP.product_tool_residual !== false) {
    throw new Error(JSON.stringify(dtMicCloseP).slice(0, 200));
  }
  if ((dtMicCloseP.device_tool || {}).device_capture_residual !== false) {
    throw new Error("mic device_capture_residual must close: " + JSON.stringify(dtMicCloseP.device_tool || {}).slice(0, 240));
  }
  if ((dtMicCloseP.device_tool || {}).device_tool_residual !== false) {
    throw new Error("mic device_tool_residual must close: " + JSON.stringify(dtMicCloseP.device_tool || {}).slice(0, 240));
  }
  if (!((dtMicCloseP.device_tool || {}).executed === true || (dtMicCloseP.device_tool || {}).mode === "host_device_mic_fixture")) {
    throw new Error("mic fixture mode: " + JSON.stringify(dtMicCloseP.device_tool || {}).slice(0, 200));
  }
  require("fs").writeFileSync("/tmp/bitbot-mcp-device-mic-close.json", JSON.stringify({ ok: true, ...dtMicCloseP }, null, 2));
  console.log("mcp_call device_tool mic residual close ok", dtMicCloseP.mapped, (dtMicCloseP.device_tool || {}).mode, (dtMicCloseP.device_tool || {}).device_capture_residual, (dtMicCloseP.device_tool || {}).device_tool_residual);
  // 15) webfetch: local mock docs-blocked → curl public fallback → public_fallback_residual false
  // Port 18813 avoids finance/job/x close (18810-18812) and cloud close (18809).
  const wfFbCloseMock = startMock(18813, "webfetch", "smoke-mcp-wf-fb");
  await sleep(500);
  try {
    const wfFbCloseRuns = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.webfetch|{\"url\":\"http://127.0.0.1:18813/docs-blocked\"}" }]);
    const wfFbCloseH = wfFbCloseRuns.find((r) => r && r.kind === "mcp_call");
    if (!wfFbCloseH || !wfFbCloseH.ok) throw new Error("webfetch residual close mcp");
    const wfFbCloseP = JSON.parse(wfFbCloseH.stdout || "{}");
    if (wfFbCloseP.mapped !== "host_webfetch" || wfFbCloseP.product_tool_residual !== false) {
      throw new Error(JSON.stringify(wfFbCloseP).slice(0, 200));
    }
    if ((wfFbCloseP.webfetch || {}).public_fallback_residual !== false) {
      throw new Error("public_fallback_residual must close: " + JSON.stringify(wfFbCloseP.webfetch || {}).slice(0, 240));
    }
    if ((wfFbCloseP.webfetch || {}).used_fallback !== true || (wfFbCloseP.webfetch || {}).fallback !== "curl") {
      throw new Error("webfetch fallback: " + JSON.stringify(wfFbCloseP.webfetch || {}).slice(0, 200));
    }
    if ((wfFbCloseP.webfetch || {}).pretend_fetched === true) throw new Error("pretend_fetched webfetch close");
    if ((wfFbCloseP.webfetch || {}).credential_bypass === true) throw new Error("credential_bypass webfetch close");
    if (!(wfFbCloseP.webfetch || {}).path) throw new Error("webfetch close path missing");
    require("fs").writeFileSync("/tmp/bitbot-mcp-webfetch-fb-close.json", JSON.stringify({ ok: true, ...wfFbCloseP }, null, 2));
    console.log("mcp_call webfetch residual close ok", wfFbCloseP.mapped, (wfFbCloseP.webfetch || {}).fallback, (wfFbCloseP.webfetch || {}).public_fallback_residual);
  } finally {
    try { wfFbCloseMock.kill(); } catch (_) {}
  }
})().catch((e)=>{console.error(e);process.exit(1);});
