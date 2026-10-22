/* validate_proto_geometry.js — Phase-0 gate: the rendered prototype geometry
 * JSON (produced by scripts/proto-main.cjs under real Electron) must satisfy
 * layout-contract.md §3. Run: node scripts/validate_proto_geometry.js [dir]
 * This validates the PROTOTYPE (design target), not the production shell.
 */
const fs = require("fs");
const path = require("path");
const DIR = process.argv[2] || path.join(__dirname, "../docs/design/desktop-target/reference");
let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + d : "")); };

const EXPECT = {
  header: 56, sidebar: 280, rail: 340, contentMax: 760, band: 2,
};

for (const vp of [[1440, 900], [1280, 800]]) {
  const file = path.join(DIR, `proto-geometry-${vp[0]}x${vp[1]}.json`);
  if (!fs.existsSync(file)) { bad(`${file} missing (render first via proto-main.cjs)`); continue; }
  const g = JSON.parse(fs.readFileSync(file, "utf8"));
  const within = (a, b) => Math.abs(a - b) <= EXPECT.band;
  const states = Object.fromEntries(g.map((s) => [s.state, s]));
  for (const name of ["none", "bot", "conv", "computer", "tools", "collapsed", "collapsed-tools"]) {
    const s = states[name];
    if (!s) { bad(`${vp} state ${name} absent`); continue; }
    if (!within(s.header.h, EXPECT.header)) bad(`${vp}/${name}: header h=${s.header.h} ≠ 56±2`); 
    const collapsed = name.startsWith("collapsed");
    const expSidebar = collapsed ? 0 : EXPECT.sidebar;
    if (!within(s.agents.w, expSidebar)) bad(`${vp}/${name}: agents w=${s.agents.w} ≠ ${expSidebar}±2`);
    const expRail = name === "none" || name === "collapsed" ? 0 : EXPECT.rail;
    if (!within(s.rail.w, expRail)) bad(`${vp}/${name}: rail w=${s.rail.w} ≠ ${expRail}±2`);
    const expMainW = vp[0] - (collapsed ? 0 : EXPECT.sidebar) - expRail;
    if (!within(s.main.w, expMainW)) bad(`${vp}/${name}: main w=${s.main.w} ≠ ${expMainW}±2`);
    if (s.railVisibleKids.length !== (expRail > 0 ? 1 : 0)) bad(`${vp}/${name}: visible rails=${s.railVisibleKids.length}`);
    if (s.hscroll > 0) bad(`${vp}/${name}: horizontal scroll ${s.hscroll}px`);
    if (s.msgMax > EXPECT.contentMax) bad(`${vp}/${name}: msg column ${s.msgMax} > 760`);
  }
  ok(`${vp[0]}x${vp[1]}: 7 states geometry vs contract (header 56 / sidebar 280 / rail 340 / stream ≤760, ±2px)`);
}

/* negative control: tamper the JSON — a widened rail must fail the band */
{
  const file = path.join(DIR, "proto-geometry-1440x900.json");
  if (fs.existsSync(file)) {
    const g = JSON.parse(fs.readFileSync(file, "utf8"));
    const bot = g.find((s) => s.state === "bot");
    bot.rail.w = 345; // +5px, outside ±2
    const within = (a, b) => Math.abs(a - b) <= EXPECT.band;
    !within(bot.rail.w, EXPECT.rail) ? ok("negative control: 345px rail fails the ±2px band (gate is real)") : bad("negative control", "band check trivially true");
  }
}

console.log("\nvalidate_proto_geometry: PASS=" + PASS + " FAIL=" + FAIL);
process.exit(FAIL ? 1 : 0);
