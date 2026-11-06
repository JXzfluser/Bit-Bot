#!/usr/bin/env python3
"""apply_ui_simplify.py — 把「移动端远程控制 / 中转设置」按参考稿改成简洁形态。

这个脚本是**一次性迁移工具**，可重复运行（幂等）：先检查是否已完成，
已完成就跳过；没完成才改。之所以写成脚本而不是一串手工 Edit：
index.html 有两万行、三语字典分散在三处，手工按 find() 插词条很容易
把 zh-TW 那批塞进 zh-CN 块（第一版就是这么错的）。脚本里每处插入都
**按语言块边界定位并断言命中次数**，错了直接停，不留半套。

跑法：python3 scripts/apply_ui_simplify.py
"""
import io
import re
import sys

P = "hosts/desktop/index.html"


def read():
    return io.open(P, encoding="utf-8").read()


def write(s):
    io.open(P, "w", encoding="utf-8").write(s)


def must(cond, msg):
    if not cond:
        print("FAIL " + msg)
        sys.exit(1)


NEW_HTML = '''    <div id="mobile-control-modal" class="bb-modal" role="dialog" aria-modal="true" aria-labelledby="mc-title">
      <div class="bb-sheet bb-sheet-lg mc-sheet">
        <div class="bb-sheet-head mc-sheet-head">
          <div class="mc-heading">
            <span class="mc-heading-ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3.5" y="1.5" width="6" height="10.5" rx="1.6"/><path d="M6 10.6h1"/><path d="M11.5 6.2a3 3 0 0 1 0 5.1"/><path d="M13 4.2a5.4 5.4 0 0 1 0 9"/></svg></span>
            <div class="mc-heading-tx">
              <div class="bb-sheet-title" id="mc-title" data-i18n="mcTitle">移动端远程控制</div>
              <!-- MC-02 硬要求「6 位」写进主路说明：既保留备用路径，又不把它做成必经输入框。 -->
              <div class="mc-subtitle" id="mc-hint" data-i18n="mcHint">扫码或在手机上打开链接，即可远程控制当前工作区；6 位配对码仅作备用。</div>
            </div>
          </div>
          <button type="button" id="mc-close" class="bb-btn bb-close mc-x" aria-label="关闭" data-i18n="settingsClose">×</button>
        </div>

        <div class="mc-grid">
          <!-- 主区（左）：只做一件事 —— 扫码。状态一行、动作三个、码一张。 -->
          <section class="mc-card mc-scan" id="mc-pair-card">
            <div class="mc-card-head">
              <span class="mc-card-ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="4" y="1.5" width="8" height="13" rx="1.6"/><path d="M7 12.8h2"/></svg></span>
              <span class="mc-card-title" data-i18n="mcScanTitle">手机扫码连接</span>
            </div>
            <p class="mc-card-note" data-i18n="mcScanNote">用手机相机扫下面的码，在手机上打开这个工作区。</p>

            <div class="mc-state">
              <span id="mc-dot" class="mc-dot" data-state="off" aria-hidden="true"></span>
              <span id="mc-status" class="mc-status" data-i18n="mcReading">配对状态：读取中…</span>
              <button type="button" id="mc-enable-btn" class="bb-btn bb-btn-sm mc-state-btn" data-i18n="pairingBtnEnable">允许手机连接</button>
            </div>
            <div id="mc-scope-note" class="mc-note mc-scope" hidden></div>

            <div class="mc-fallback">
              <span data-i18n="mcFallback">扫不了？在手机上打开链接也行。</span>
              <div class="mc-actions">
                <button type="button" id="mc-qr-refresh" class="bb-btn bb-btn-sm" data-i18n="mcQrRefresh">刷新二维码</button>
                <button type="button" id="mc-copy-url-btn" class="bb-btn bb-btn-sm" disabled data-i18n="mcCopyUrl">复制链接</button>
              </div>
            </div>

            <div class="mc-qr-wrap" id="mc-qr-wrap">
              <div id="mc-qr" class="mc-qr" role="img" data-i18n-aria="mcQrAria" aria-label="配对二维码"></div>
              <div id="mc-qr-empty" class="mc-qr-empty" hidden data-i18n="mcQrEmpty">先点「允许手机连接」，这里才会出现二维码。</div>
            </div>
            <div id="mc-pair-note" class="mc-note" hidden></div>

            <!-- 6 位配对码：紧凑一行，作为扫码失败时的备用，不占主视觉。 -->
            <div class="pc-block mc-code-inline" id="mc-code-block">
              <div class="pc-head">
                <span class="pc-head-title" id="mc-code-title" data-i18n="mcCodeTitle">让手机自己找</span>
                <button type="button" id="mc-gen-btn" class="bb-btn bb-btn-sm" data-i18n="mcCodeGen">生成配对码</button>
              </div>
              <div class="pc-display" id="mc-code-display" hidden>
                <span class="pc-digits" id="mc-code"></span>
                <span class="pc-countdown" id="mc-countdown"></span>
              </div>
              <div class="pc-actions" id="mc-code-actions" hidden>
                <button type="button" id="mc-revoke-btn" class="bb-btn bb-btn-sm" data-i18n="mcCodeRevoke">立即作废</button>
              </div>
              <p class="pc-hint" data-i18n="mcCodeHint">手机只需点「连接 Desktop」并输入这 6 位数字：5 分钟内有效，用过一次即作废。</p>
            </div>
            <p class="mc-note mc-link-note" data-i18n="mcLinkNote">「复制链接」复制的是这台桌面的说明页：粘到手机浏览器里打开，会写明下一步该干什么；配对码仍然只在 App 里输。</p>
          </section>

          <!-- 次区（右）：渠道卡片。只列真跑通的三条（MC-07 禁止假入口）。 -->
          <section class="mc-card mc-channels" id="mc-channel-card">
            <div class="mc-card-head">
              <span class="mc-card-ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 4.5h12v7H6.5L3.5 14v-2.5H2z"/><path d="M5 8h6"/></svg></span>
              <span class="mc-card-title" data-i18n="mcChannelTitle">使用 Bot Channel</span>
            </div>
            <p class="mc-card-note" data-i18n="mcChannelNote">连接聊天 Bot，适合更长时间的移动端访问。</p>
            <div class="mc-ch-list">
              <div class="mc-ch" id="mc-ch-ding">
                <span class="mc-ch-ic mc-ch-ding" aria-hidden="true">钉</span>
                <div class="mc-ch-tx"><b data-i18n="mcChDingName">钉钉</b><small data-i18n="mcChDingNote">从钉钉群打开这个工作区。</small></div>
              </div>
              <div class="mc-ch" id="mc-ch-feishu">
                <span class="mc-ch-ic mc-ch-feishu" aria-hidden="true">飞</span>
                <div class="mc-ch-tx"><b data-i18n="mcChFeishuName">飞书</b><small data-i18n="mcChFeishuNote">从飞书打开这个工作区。</small></div>
              </div>
              <div class="mc-ch" id="mc-ch-wecom">
                <span class="mc-ch-ic mc-ch-wecom" aria-hidden="true">企</span>
                <div class="mc-ch-tx"><b data-i18n="mcChWecomName">企业微信</b><small data-i18n="mcChWecomNote">从企业微信打开这个工作区。</small></div>
              </div>
            </div>
            <!-- MC-07 门要它可点、且点了真落到「连接应用」的国内渠道卡。 -->
            <button type="button" id="mc-goto-channels" class="bb-btn bb-btn-sm bb-btn-primary mc-ch-go" data-i18n="mcGotoChannels">去配置</button>
            <!-- 图 2 的入口：机器人/连接管理，主区不放任何输入框。 -->
            <button type="button" id="mc-open-manager" class="bb-btn bb-btn-sm mc-manager-btn" data-i18n="mcManager">机器人管理</button>
          </section>
        </div>

        <!-- 高级：设备列表 / 跨网中转 / 手机端来源，默认折叠。
             这些能力一个没删，只是不再和「扫码」抢主视觉。 -->
        <details class="mc-advanced" id="mc-advanced">
          <summary data-i18n="mcAdvanced">高级设置</summary>
          <div class="mc-advanced-body">
            <section class="mc-card mc-adv-card" id="mc-roster-card">
              <div class="mc-card-title" id="mc-roster-title" data-i18n="mcRosterTitle">已登记的设备</div>
              <p class="mc-note" id="mc-roster-empty" data-i18n="mcRosterEmpty">还没有已登记的设备。手机配对成功后，会出现在这一栏。</p>
              <p class="mc-note" id="mc-roster-error" hidden></p>
              <ul class="mc-roster" id="mc-roster-list"></ul>
            </section>
            <section class="mc-card mc-adv-card" id="mc-relay-entry-card">
              <div class="mc-card-head">
                <span id="mc-relay-dot" class="mc-dot" data-state="off" aria-hidden="true"></span>
                <span class="mc-card-title" data-i18n="mcRelayTitle">跨网中转</span>
              </div>
              <div id="mc-relay-status" class="mc-status" data-i18n="mcRelayEmpty">尚未配置</div>
              <p class="mc-note" id="mc-relay-audit" hidden></p>
              <div class="mc-actions">
                <button type="button" id="mc-relay-open" class="bb-btn bb-btn-sm" data-i18n="mcRelayOpen">配置中转</button>
              </div>
            </section>
            <div class="mc-app mc-adv-card" id="mc-app-block">
              <div class="mc-card-title" data-i18n="mcAppTitle">手机端从哪来</div>
              <p class="mc-note" data-i18n="mcAppNote">安卓版目前是自己构建的安装包，还没上应用商店 —— 所以这里不给一个点了没反应的下载按钮。装好后打开 App，点「连接 Desktop」，输入上面这 6 位码就能连上。</p>
            </div>
          </div>
        </details>
      </div>
    </div>
'''

# 三个语言块的**唯一定位锚**（值各不相同），新键插在它前面。
LANG_BLOCKS = [
    ("zh-CN", '        mcChDing: "钉钉 · 群机器人 Webhook",', '''        mcScanTitle: "手机扫码连接",
        mcScanNote: "用手机相机扫下面的码，在手机上打开这个工作区。",
        mcFallback: "扫不了？在手机上打开链接也行。",
        mcQrRefresh: "刷新二维码",
        mcQrEmpty: "先点「允许手机连接」，这里才会出现二维码。",
        mcQrTooLong: "地址太长，画不出二维码；请用「复制链接」。",
        mcQrAria: "配对二维码",
        mcManager: "机器人管理",
        mcAdvanced: "高级设置",
        mcChDingName: "钉钉",
        mcChDingNote: "从钉钉群打开这个工作区。",
        mcChFeishuName: "飞书",
        mcChFeishuNote: "从飞书打开这个工作区。",
        mcChWecomName: "企业微信",
        mcChWecomNote: "从企业微信打开这个工作区。",
'''),
    ("zh-TW", '        mcChDing: "釘釘 · 群組機器人 Webhook",', '''        mcScanTitle: "手機掃碼連線",
        mcScanNote: "用手機相機掃描下方的碼，在手機上開啟這個工作區。",
        mcFallback: "掃不了？在手機上開啟連結也行。",
        mcQrRefresh: "重新產生二維碼",
        mcQrEmpty: "先點「允許手機連線」，這裡才會出現二維碼。",
        mcQrTooLong: "位址太長，畫不出二維碼；請用「複製連結」。",
        mcQrAria: "配對二維碼",
        mcManager: "機器人管理",
        mcAdvanced: "進階設定",
        mcChDingName: "釘釘",
        mcChDingNote: "從釘釘群組開啟這個工作區。",
        mcChFeishuName: "飛書",
        mcChFeishuNote: "從飛書開啟這個工作區。",
        mcChWecomName: "企業微信",
        mcChWecomNote: "從企業微信開啟這個工作區。",
'''),
    ("en", '        mcChDing: "DingTalk · group robot Webhook",', '''        mcScanTitle: "Scan to connect",
        mcScanNote: "Scan the code with your phone camera to open this workspace.",
        mcFallback: "Cannot scan? Open the link on your phone instead.",
        mcQrRefresh: "Refresh code",
        mcQrEmpty: "Enable phone access to show the QR code.",
        mcQrTooLong: "Address too long for a QR code; use Copy link.",
        mcQrAria: "Pairing QR code",
        mcManager: "Bot management",
        mcAdvanced: "Advanced",
        mcChDingName: "DingTalk",
        mcChDingNote: "Open this workspace from DingTalk.",
        mcChFeishuName: "Feishu",
        mcChFeishuNote: "Open this workspace from Feishu.",
        mcChWecomName: "WeCom",
        mcChWecomNote: "Open this workspace from WeCom.",
'''),
]

QR_JS = '''    /* 二维码：编码 pairing.state() 给的**真实可打开**的 /pair 说明页，
       不是自定 scheme（Android 端没注册 deep link，扫 bitbot-relay:// 打不开）。
       没放开局域网 / 没地址时显示一句实话，绝不画一个扫了没反应的码。 */
    function mcPaintQr(st) {
      const box = document.getElementById("mc-qr");
      const empty = document.getElementById("mc-qr-empty");
      if (!box || !empty) return;
      const url = st && st.pair_page_url
        ? st.pair_page_url
        : (st && st.pair_base ? st.pair_base + "/pair" : "");
      const ready = Boolean(st && st.lan_open && url);
      const qr = window.BitBotQR;
      if (!ready || !qr || typeof qr.toSvg !== "function") {
        box.innerHTML = "";
        box.hidden = true;
        empty.hidden = false;
        return;
      }
      const svg = qr.toSvg(url, { border: 4, scale: 1 });
      if (!svg) {
        box.innerHTML = "";
        box.hidden = true;
        empty.hidden = false;
        empty.textContent = wavegT("mcQrTooLong");
        return;
      }
      box.innerHTML = svg; // toSvg 只由黑白模块拼成，URL 不进 DOM 文本
      box.hidden = false;
      empty.hidden = true;
    }

'''

BTN_JS = '''
    /* 刷新二维码：内容来自同一份 pairing.state()，不自己编地址。 */
    const mcQrRefresh = document.getElementById("mc-qr-refresh");
    if (mcQrRefresh) {
      mcQrRefresh.addEventListener("click", async () => {
        mcQrRefresh.disabled = true;
        try { await refreshMobileControl(); } finally { mcQrRefresh.disabled = false; }
      });
    }
    /* 「机器人管理」→ 图 2 的连接/机器人配置页（本项目即中转设置弹窗）。
       先关主弹窗避免两层叠着；openRelay 在 initRelaySettings 闭包内，
       这里转发点击到它已绑定的入口，不复制一份开关逻辑。 */
    const mcOpenManager = document.getElementById("mc-open-manager");
    if (mcOpenManager) {
      mcOpenManager.addEventListener("click", () => {
        closeMobileControl();
        const relayEntry = document.getElementById("mc-relay-open");
        if (relayEntry) relayEntry.click();
      });
    }
'''


RELAY_HTML = '''    <div id="relay-settings-modal" class="bb-modal" role="dialog" aria-modal="true" aria-labelledby="mc-relay-modal-title" style="display:none">
      <div class="bb-sheet bb-sheet-lg mc-sheet mc2-sheet">
        <div class="bb-sheet-head mc-sheet-head">
          <div class="mc-heading">
            <span class="mc-heading-ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 7h.01M8 7h.01M11 7h.01M5.5 10h5"/></svg></span>
            <div class="mc-heading-tx">
              <div class="bb-sheet-title" id="mc-relay-modal-title" data-i18n="mcManager">机器人管理</div>
              <div class="mc-subtitle" data-i18n="mc2Subtitle">选一个连接，点一下就能用；只有需要自定义时才展开高级设置。</div>
            </div>
          </div>
          <button type="button" id="mc-relay-close" class="bb-btn bb-close mc-x" aria-label="关闭" data-i18n="settingsClose">×</button>
        </div>

        <div class="mc2-layout">
          <!-- 左：连接对象列表。只列真有的两条路，不给「新建」假按钮。 -->
          <aside class="mc2-list" id="relay-manager-list">
            <div class="mc2-list-title" data-i18n="mc2ListTitle">连接</div>
            <button type="button" class="mc2-item is-active" data-mc2="lan" id="mc2-item-lan">
              <span class="mc2-item-ic" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="4" y="1.5" width="8" height="13" rx="1.6"/><path d="M7 12.8h2"/></svg></span>
              <span class="mc2-item-tx"><b data-i18n="mc2LanName">本机同网</b><small data-i18n="mc2LanMeta">和手机在同一个 Wi-Fi</small></span>
            </button>
            <button type="button" class="mc2-item" data-mc2="relay" id="mc2-item-relay">
              <span class="mc2-item-ic" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg></span>
              <span class="mc2-item-tx"><b data-i18n="mcRelayTitle">跨网中转</b><small data-i18n="mc2RelayMeta">手机用蜂窝网也能连</small></span>
            </button>
          </aside>

          <!-- 右：详情。主区没有输入框 —— 需要填的都在 <details> 里。 -->
          <div class="mc2-detail">
            <section class="mc2-panel" id="mc2-panel-lan">
              <div class="mc2-panel-head">
                <span class="mc-card-title" data-i18n="mc2LanTitle">扫一下就连上</span>
                <span id="mc2-lan-badge" class="mc2-badge" data-state="off" data-i18n="mc2NotReady">未就绪</span>
              </div>
              <p class="mc-card-note" data-i18n="mc2LanNote">手机相机扫下面的码，会打开这台桌面的连接说明页。</p>
              <div class="mc-qr-wrap">
                <div id="mc2-qr" class="mc-qr" role="img" data-i18n-aria="mcQrAria" aria-label="配对二维码"></div>
                <div id="mc2-qr-empty" class="mc-qr-empty" data-i18n="mcQrEmpty">先点「允许手机连接」，这里才会出现二维码。</div>
              </div>
              <div class="mc-actions">
                <button type="button" id="mc2-copy-link" class="bb-btn bb-btn-sm" data-i18n="mcCopyUrl">复制链接</button>
                <button type="button" id="mc2-refresh" class="bb-btn bb-btn-sm" data-i18n="mcQrRefresh">刷新二维码</button>
              </div>
              <p class="mc-note" data-i18n="mc2LanHint">扫不了就把链接发到手机，在浏览器里打开照着做。</p>
            </section>

            <section class="mc2-panel" id="mc2-panel-relay" hidden>
              <div class="mc2-panel-head">
                <span class="mc-card-title" data-i18n="mcRelayTitle">跨网中转</span>
                <span id="mc-relay-dot2" class="mc2-badge" data-state="off" data-i18n="mcRelayEmpty">尚未配置</span>
              </div>
              <p class="mc-card-note" data-i18n="mc2RelayNote">生成一段连接信息，复制到手机的「跨网配对」里粘上就好，不用逐项填。</p>
              <div id="mc-relay-status" class="mc-status" data-i18n="mcRelayEmpty">尚未配置</div>
              <p class="mc-note" id="mc-relay-audit" hidden></p>
              <div class="mc-actions">
                <button type="button" id="mc-relay-bootstrap" class="bb-btn bb-btn-sm bb-btn-primary" data-i18n="mc2GenAndCopy">生成并复制</button>
                <button type="button" id="mc-relay-disable" class="bb-btn bb-btn-sm" data-i18n="mcRelayDisable">关闭中转</button>
              </div>
              <!-- 跨网串是自定 scheme，Android 端没注册 deep link：如实说明「要粘贴」，
                   不画一个扫了打不开的假二维码。 -->
              <div id="mc-relay-bootstrap-box" class="mc2-string" style="display:none">
                <p class="mc-note" data-i18n="mcRelayBootstrapNote">把下面整段复制到手机「配对 → 跨网配对」里。它含这台桌面的手机凭证，请当密码对待，别发到群里。</p>
                <textarea id="mc-relay-bootstrap-text" class="bb-control" readonly rows="3"
                  style="width:100%;font:12px/1.4 ui-monospace,monospace;resize:vertical"></textarea>
                <div class="mc-actions">
                  <button type="button" id="mc-relay-bootstrap-copy" class="bb-btn bb-btn-sm" data-i18n="mcRelayBootstrapCopy">复制</button>
                </div>
              </div>
              <div id="mc-relay-note" class="mc-note" hidden></div>

              <!-- 高级：6 个字段一个没删，但默认折叠，常规用户根本不用看见。 -->
              <details class="mc-advanced mc2-advanced" id="mc2-relay-advanced">
                <summary data-i18n="mcAdvanced">高级设置</summary>
                <section class="mc-card mc-adv-card" id="mc-relay-card">
                  <p class="mc-note" data-i18n="mcRelayNote">公网 relay + NAT 后的桌面请选 reverse；两把凭证只填一次，之后留空即沿用。保存后自动重新登记，不用重启 app。</p>
                  <div class="mc-form mc2-form">
                    <label><span data-i18n="mcRelayHost">中转地址</span>
                      <input class="bb-control" id="mc-relay-host" type="text" autocomplete="off" spellcheck="false"></label>
                    <label><span data-i18n="mcRelayPort">端口</span>
                      <input class="bb-control" id="mc-relay-port" type="number" min="1" max="65535"></label>
                    <label><span data-i18n="mcRelayBoxId">盒子 ID</span>
                      <input class="bb-control" id="mc-relay-box" type="text" autocomplete="off" spellcheck="false"></label>
                    <label><span data-i18n="mcRelayMode">模式</span>
                      <select class="bb-control" id="mc-relay-mode">
                        <option value="reverse">reverse · 反向隧道（推荐）</option>
                        <option value="dial">dial · 主动拨（同网部署）</option>
                      </select></label>
                    <label><span data-i18n="mcRelayBoxToken">桌面凭证</span>
                      <input class="bb-control" id="mc-relay-box-token" type="password" autocomplete="new-password" data-i18n-ph="mcRelayKeep" placeholder="留空沿用"></label>
                    <label><span data-i18n="mcRelayClientToken">手机凭证</span>
                      <input class="bb-control" id="mc-relay-client-token" type="password" autocomplete="new-password" data-i18n-ph="mcRelayKeep" placeholder="留空沿用"></label>
                  </div>
                  <div class="mc-actions">
                    <button type="button" id="mc-relay-save" class="bb-btn bb-btn-sm bb-btn-primary" data-i18n="mcRelaySave">保存并生效</button>
                  </div>
                </section>
              </details>
            </section>
          </div>
        </div>
      </div>
    </div>
'''

# 中转页新增词条（三语各一份），锚点仍是各语言块唯一的 mcChDing 值
RELAY_KEYS = [
    ("zh-CN", '        mcChDing: "钉钉 · 群机器人 Webhook",', '''        mc2Subtitle: "选一个连接，点一下就能用；只有需要自定义时才展开高级设置。",
        mc2ListTitle: "连接",
        mc2LanName: "本机同网",
        mc2LanMeta: "和手机在同一个 Wi-Fi",
        mc2RelayMeta: "手机用蜂窝网也能连",
        mc2LanTitle: "扫一下就连上",
        mc2NotReady: "未就绪",
        mc2Ready: "已就绪",
        mc2LanNote: "手机相机扫下面的码，会打开这台桌面的连接说明页。",
        mc2LanHint: "扫不了就把链接发到手机，在浏览器里打开照着做。",
        mc2RelayNote: "生成一段连接信息，复制到手机的「跨网配对」里粘上就好，不用逐项填。",
        mc2GenAndCopy: "生成并复制",
'''),
    ("zh-TW", '        mcChDing: "釘釘 · 群組機器人 Webhook",', '''        mc2Subtitle: "選一個連線，點一下就能用；只有需要自訂時才展開進階設定。",
        mc2ListTitle: "連線",
        mc2LanName: "本機同網",
        mc2LanMeta: "和手機在同一個 Wi-Fi",
        mc2RelayMeta: "手機用行動網路也能連",
        mc2LanTitle: "掃一下就連上",
        mc2NotReady: "未就緒",
        mc2Ready: "已就緒",
        mc2LanNote: "手機相機掃描下方的碼，會開啟這台桌面的連線說明頁。",
        mc2LanHint: "掃不了就把連結傳到手機，在瀏覽器裡開啟照著做。",
        mc2RelayNote: "產生一段連線資訊，複製到手機的「跨網配對」貼上即可，不用逐項填。",
        mc2GenAndCopy: "產生並複製",
'''),
    ("en", '        mcChDing: "DingTalk · group robot Webhook",', '''        mc2Subtitle: "Pick a connection and go. Only open Advanced if you need custom settings.",
        mc2ListTitle: "Connections",
        mc2LanName: "Same Wi-Fi",
        mc2LanMeta: "Phone and desktop on one Wi-Fi",
        mc2RelayMeta: "Works over mobile data too",
        mc2LanTitle: "Scan to connect",
        mc2NotReady: "Not ready",
        mc2Ready: "Ready",
        mc2LanNote: "Scan with your phone camera to open this desktop's pairing page.",
        mc2LanHint: "Cannot scan? Send the link to your phone and open it.",
        mc2RelayNote: "Generate one string, paste it into Cross-network pairing on your phone. No fields to fill in.",
        mc2GenAndCopy: "Generate & copy",
'''),
]

STEP2_JS = '''
    /* ── 机器人/连接管理：左列表切详情，主区始终零输入框 ──────────────────
     * 二维码编码的是 pairing.state().pair_page_url（真能扫开的本地说明页），
     * 不是自定 scheme。跨网串只能复制粘贴：Android 端未注册 deep link，
     * 画成二维码就是扫了打不开的假入口。 */
    (function initManagerPanels() {
      const $ = (id) => document.getElementById(id);
      const items = Array.from(document.querySelectorAll(".mc2-item"));
      const panels = { lan: $("mc2-panel-lan"), relay: $("mc2-panel-relay") };
      const qrBox = $("mc2-qr"), qrEmpty = $("mc2-qr-empty"), badge = $("mc2-lan-badge");
      function paintManagerQr(st) {
        const url = st && st.pair_page_url
          ? st.pair_page_url : (st && st.pair_base ? st.pair_base + "/pair" : "");
        const qr = window.BitBotQR;
        const ready = Boolean(st && st.lan_open && url && qr && typeof qr.toSvg === "function");
        if (badge) {
          badge.dataset.state = ready ? "on" : "off";
          badge.textContent = wavegT(ready ? "mc2Ready" : "mc2NotReady");
        }
        if (!qrBox || !qrEmpty) return;
        if (!ready) { qrBox.innerHTML = ""; qrBox.hidden = true; qrEmpty.hidden = false; return; }
        const svg = qr.toSvg(url, { border: 4, scale: 1 });
        if (!svg) { qrBox.innerHTML = ""; qrBox.hidden = true; qrEmpty.hidden = false; return; }
        qrBox.innerHTML = svg; qrBox.hidden = false; qrEmpty.hidden = true;
      }
      async function refreshManagerQr() {
        try {
          const st = await window.bitbot.pairing.state();
          paintManagerQr(st && st.ok ? st : null);
        } catch (_) { paintManagerQr(null); }
      }
      function select(which) {
        for (const it of items) it.classList.toggle("is-active", it.dataset.mc2 === which);
        for (const k of Object.keys(panels)) if (panels[k]) panels[k].hidden = (k !== which);
        if (which === "lan") refreshManagerQr();
      }
      for (const it of items) it.addEventListener("click", () => select(it.dataset.mc2));
      const refreshBtn = $("mc2-refresh");
      if (refreshBtn) refreshBtn.addEventListener("click", refreshManagerQr);
      const copyBtn = $("mc2-copy-link");
      if (copyBtn) copyBtn.addEventListener("click", async () => {
        try { await window.bitbot.pairing.copy("page"); } catch (_) {}
      });
      // 弹窗打开时刷一次：openRelay 调 load()，这里挂同一个入口的 click 后置钩子
      const relayOpen = $("mc-relay-open");
      if (relayOpen) relayOpen.addEventListener("click", () => { select("lan"); refreshManagerQr(); });
      const managerOpen = $("mc-open-manager");
      if (managerOpen) managerOpen.addEventListener("click", () => { select("lan"); refreshManagerQr(); });
      // 「生成并复制」：沿用既有 bootstrap 按钮的真逻辑，再自动点一次复制
      const genCopy = $("mc-relay-bootstrap");
      if (genCopy) {
        genCopy.addEventListener("click", () => {
          setTimeout(() => {
            const copy = $("mc-relay-bootstrap-copy");
            const ta = $("mc-relay-bootstrap-text");
            if (copy && ta && ta.value) copy.click();
          }, 60);
        });
      }
      select("lan");
    })();
'''


def step2():
    """中转弹窗：列表 + 详情 + 高级折叠。幂等标记 id="relay-manager-list"。"""
    s = read()
    if 'id="relay-manager-list"' in s:
        print("step2 已完成，跳过")
        return
    a = s.index('    <div id="relay-settings-modal"')
    b = s.index('    <div id="agent-info-panel"', a)
    s = s[:a] + RELAY_HTML + "\n" + s[b:]

    # 新词条：按三语唯一锚点插入
    for label, anchor, ins in RELAY_KEYS:
        must(s.count(anchor) == 1, "step2 " + label + " 锚点不唯一")
        s = s.replace(anchor, ins + anchor, 1)

    # 面板切换 JS：插在 initRelaySettings IIFE 之后（找它的收尾）
    marker = "    /* ---------- 移动端远程控制弹窗（pairing-v1 的产品正门）--------------"
    must(s.count(marker) == 1, "step2 JS 插入锚点不唯一")
    s = s.replace(marker, STEP2_JS + "\n" + marker, 1)

    write(s)
    s2 = read()
    for k in ["mc2Subtitle", "mc2ListTitle", "mc2LanName", "mc2LanMeta",
              "mc2RelayMeta", "mc2LanTitle", "mc2NotReady", "mc2LanNote",
              "mc2LanHint", "mc2RelayNote", "mc2GenAndCopy", "mc2Ready"]:
        n = len(re.findall(r"\b" + k + r":", s2))
        must(n == 3, "step2 " + k + " 应 3 次，实际 " + str(n))
    # 6 个输入框 id 必须还在（initRelaySettings 依赖）
    for i in ["mc-relay-host", "mc-relay-port", "mc-relay-box", "mc-relay-mode",
              "mc-relay-box-token", "mc-relay-client-token", "mc-relay-save",
              "mc-relay-disable", "mc-relay-bootstrap", "mc-relay-bootstrap-text",
              "mc-relay-bootstrap-copy", "mc-relay-note", "mc-relay-status",
              "mc-relay-audit", "mc-relay-card", "mc-relay-close"]:
        must('id="' + i + '"' in s2, "step2 既有 id 丢了: " + i)
    print("step2 OK：列表+详情、主区零输入、6 字段进折叠、三语齐、既有 id 全保留")


def main():
    s = read()
    if 'id="mc-qr"' not in s:
        step1_body()
    else:
        print("step1 已完成，跳过")
    step2()


def step1_body():
    s = read()

    # ① vendor 引入
    anchor = '  <script src="./vendor/highlight.min.js"></script>\n'
    must(s.count(anchor) == 1, "vendor 引入锚点必须唯一")
    s = s.replace(anchor, anchor + '''  <!-- 离线二维码：把 pairing.state().pair_page_url 编成真能扫的码。
       不联网、不装 npm 包；正确性由 scripts/prove_qr_code.js 用 macOS Vision 真扫验证。 -->
  <script src="./vendor/qrcode.js"></script>
''', 1)

    # ② 主弹窗结构
    start = s.index('    <div id="mobile-control-modal" class="bb-modal"')
    end = s.index('    <!-- A3-14 独立的中转设置弹窗', start)
    s = s[:start] + NEW_HTML + s[end:]

    # ③ 二维码渲染函数 + refreshMobileControl 接线
    sig = '    async function refreshMobileControl() {\n'
    must(s.count(sig) == 1, "refreshMobileControl 签名必须唯一")
    s = s.replace(sig, QR_JS + sig, 1)
    call = '        mcSnapshot = st && st.ok ? st : null;\n'
    must(s.count(call) == 1, "mcSnapshot 赋值必须唯一")
    s = s.replace(call, call + '        mcPaintQr(mcSnapshot);\n', 1)
    failcall = '          mcPaintCode(null);\n          return;'
    must(s.count(failcall) == 1, "失败分支必须唯一")
    s = s.replace(failcall, '          mcPaintCode(null);\n          mcPaintQr(null);\n          return;', 1)

    # ④ 按钮事件
    closeanchor = '    if (mcCloseBtn) mcCloseBtn.addEventListener("click", () => closeMobileControl());\n'
    must(s.count(closeanchor) == 1, "mc-close 绑定必须唯一")
    s = s.replace(closeanchor, closeanchor + BTN_JS, 1)

    # ⑤ 主路说明 / 渠道说明改成简洁版（三语各一处）
    hint_repl = [
        ('        mcHint: "手机和桌面在同一个 Wi-Fi 下，输入 6 位配对码就能连上这台大脑，不需要手填长令牌。",',
         '        mcHint: "扫码或在手机上打开链接，即可远程控制当前工作区；6 位配对码仅作备用。",'),
        ('        mcHint: "手機和桌面在同一個 Wi-Fi 下，輸入 6 位配對碼就能連上這台大腦，不需要手填長權杖。",',
         '        mcHint: "掃碼或在手機上開啟連結，即可遠端控制目前工作區；6 位配對碼僅作備用。",'),
        ('        mcHint: "On the same Wi-Fi, the phone just types a 6-digit pairing code to reach this brain — no long token to paste.",',
         '        mcHint: "Scan the code or open the link on your phone to control this workspace; the 6-digit pairing code is a fallback.",'),
        ('        mcChannelNote: "下面三条是真跑通过的入站渠道。没列出的渠道目前没有适配器，这里不给点了没反应的入口。",',
         '        mcChannelNote: "连接聊天 Bot，适合更长时间的移动端访问。",'),
        ('        mcChannelNote: "下面三條是真跑通的入站渠道。沒列出的渠道目前沒有配接器，這裡不給點了沒反應的入口。",',
         '        mcChannelNote: "連接聊天 Bot，適合更長時間的行動端存取。",'),
    ]
    for a, b in hint_repl:
        must(s.count(a) == 1, "文案锚点必须唯一: " + a[:40])
        s = s.replace(a, b, 1)
    # en 的 mcChannelNote 是折行长串，用正则按 key 定位替换
    en_note = re.search(r'(        mcChannelNote: "The three below)[^\n]*\n', s)
    must(en_note is not None, "en mcChannelNote 找不到")
    s = s[:en_note.start()] + '        mcChannelNote: "Connect a chat Bot for longer mobile access.",\n' + s[en_note.end():]

    # ⑥ 三语新键：按各自唯一锚点插入，并断言插完全文里每个键恰好 3 次
    for label, anchor, ins in LANG_BLOCKS:
        must(s.count(anchor) == 1, label + " 锚点不唯一（会把词条插错语言块）")
        s = s.replace(anchor, ins + anchor, 1)

    write(s)

    # ⑦ 自检：每个新键恰好 3 次，且分别落在三个字典块里
    s2 = read()
    keys = re.findall(r'^        (mc(?:Scan|Qr|Fallback|Manager|Advanced|Ch\w+Name|Ch\w+Note)\w*):', ins, re.M)
    for k in ["mcScanTitle", "mcScanNote", "mcFallback", "mcQrRefresh", "mcQrEmpty",
              "mcQrTooLong", "mcQrAria", "mcManager", "mcAdvanced",
              "mcChDingName", "mcChFeishuName", "mcChWecomName"]:
        n = len(re.findall(r'\b' + k + r':', s2))
        must(n == 3, k + " 应恰好 3 次（三语各一），实际 " + str(n))

    # ⑧ 结构自检：所有既有 id 仍在（MC 门依赖）
    for i in ["mc-title", "mc-hint", "mc-dot", "mc-status", "mc-enable-btn",
              "mc-copy-url-btn", "mc-code-block", "mc-code-title", "mc-gen-btn",
              "mc-code", "mc-countdown", "mc-code-display", "mc-code-actions",
              "mc-revoke-btn", "mc-scope-note", "mc-pair-note", "mc-channel-card",
              "mc-ch-ding", "mc-ch-feishu", "mc-ch-wecom", "mc-goto-channels",
              "mc-roster-card", "mc-roster-title", "mc-roster-empty", "mc-roster-error",
              "mc-roster-list", "mc-relay-entry-card", "mc-relay-dot", "mc-relay-status",
              "mc-relay-audit", "mc-relay-open", "mc-app-block", "mc-close"]:
        must('id="' + i + '"' in s2, "既有 id 丢了: " + i)

    print("OK：结构重排 + 二维码接线 + 三语词条齐整 + 既有 id 全保留")


if __name__ == "__main__":
    main()
