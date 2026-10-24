"use strict";

/**
 * Loopback inbound fixture for scripts/prove_p0_inbound_security.sh.
 * Writes the bound port to <tmpdir>/port and appends one JSON line per onTurn
 * to <tmpdir>/wakes.jsonl. Does not run MoonBit or a model.
 */

const fs = require("fs");
const path = require("path");
const { createCnInboundServer } = require("../hosts/shared/cn_inbound_server");

const tmp = process.argv[2];
if (!tmp) {
  process.stderr.write("usage: p0_inbound_fixture_server.js <tmpdir>\n");
  process.exit(2);
}
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo, { recursive: true });
const wakeFile = path.join(tmp, "wakes.jsonl");

const server = createCnInboundServer({
  repoRoot: repo,
  port: 0,
  host: "127.0.0.1",
  onTurn: async (prompt) => {
    fs.appendFileSync(
      wakeFile,
      JSON.stringify({ prompt: String(prompt || ""), at: Date.now() }) + "\n",
    );
    return {
      ok: true,
      messages: [{ role: "assistant", text: "ack" }],
      stdout: "",
    };
  },
});

server.start().then((st) => {
  fs.writeFileSync(path.join(tmp, "port"), String(st.port));
  fs.writeFileSync(path.join(tmp, "ready"), "1");
  process.stdout.write("ready " + st.port + "\n");
}).catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
