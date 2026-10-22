// Minimal Electron shell for Phase-0 prototype geometry screenshots.
// Usage: xvfb-run -a electron proto-main.cjs <windowW> <windowH> <outDir>
// Queries the prototype via ?panel=...&sidebar=... and dumps getBoundingClientRect
// geometry JSON per state, plus a full-page screenshot per state.
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const [W, H, OUT] = [Number(process.argv[2] || 1440), Number(process.argv[3] || 900), process.argv[4] || "."];
const PROTO = path.resolve(__dirname, "../docs/design/desktop-target/prototype.html");

const STATES = [
  { name: "none", qs: "?panel=none" },
  { name: "bot", qs: "?panel=bot" },
  { name: "conv", qs: "?panel=conv" },
  { name: "computer", qs: "?panel=computer" },
  { name: "tools", qs: "?panel=tools" },
  { name: "collapsed", qs: "?panel=none&sidebar=collapsed" },
  { name: "collapsed-tools", qs: "?panel=tools&sidebar=collapsed" },
];

async function probe(win) {
  return win.webContents.executeJavaScript(`(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null;
      const b = el.getBoundingClientRect(); return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}; };
    const msgW = Array.from(document.querySelectorAll("#log .msg")).map(e => +e.getBoundingClientRect().width.toFixed(1));
    return {
      panel: document.body.dataset.panel || "none",
      sidebar: document.body.dataset.sidebar || "expanded",
      header: r("header"), agents: r("aside"), main: r("#main"), composer: r("#composer"), rail: r("#rail"),
      log: r("#log"),
      msgMax: msgW.length ? Math.max(...msgW) : 0,
      hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      railVisibleKids: Array.from(document.querySelectorAll("#rail .rail-view")).filter(e => e.offsetWidth > 0).map(e => e.className),
    };
  })()`);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  for (const st of STATES) {
    const win = new BrowserWindow({
      width: W, height: H, show: true, frame: false, webSecurity: true,
      x: 0, y: 0, useContentSize: true,
    });
    await win.loadURL("file://" + PROTO + st.qs);
    await new Promise((r) => setTimeout(r, 350));
    const geo = await probe(win);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `proto-${W}x${H}-${st.name}.png`), img.toPNG());
    results.push({ state: st.name, ...geo });
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, `proto-geometry-${W}x${H}.json`), JSON.stringify(results, null, 2));
  console.log("proto-main: done " + results.length + " states @ " + W + "x" + H);
  app.quit();
});
