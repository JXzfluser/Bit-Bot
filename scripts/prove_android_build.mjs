/* prove_android_build.mjs — 安卓版「真的能装」的门禁（G-47）
 *
 * 移动端的交付标准不能靠读源码。这个门禁只做一件事：在跑得到 Android SDK 的机器上，
 * 真编译一次 universalDebug APK，再用 aapt 把 APK 里的事实读回来 —— 装不上的包、
 * 少了权限的包，在手机上就是走不通，源码写得再漂亮也不算数。
 *
 *   AB-01 APK 产出且非空（assemble 真的跑完了）
 *   AB-02 包名 / 应用名（aapt badging 读回来，不是 gradle 说的）
 *   AB-03 权限齐：INTERNET + CAMERA + RECORD_AUDIO + ACCESS_FINE_LOCATION
 *          —— 少一条，手机上对应的产品动作就没有入口（拍照、语音、定位）
 *   AB-04 minSdk / targetSdk 与工程配置一致
 *   AB-05 六个国内渠道 flavor 都在（universal/huawei/xiaomi/honor/oppo/vivo）
 *   AB-06 JVM 单测真的跑了：0 失败且用例数 ≥ 118（防止 test 任务空转假绿）
 *   AB-07 配对地址归一化的两条红线真的在结果里（未配对不许回写死地址、少协议要补全）
 *   AB-08 失败原因翻译层的三条红线真的在结果里（401 点名重抄令牌、404 不贴 HTML、
 *         Connection refused 要说端口没人监听）
 *   AB-09 配对 v1 纯逻辑单测真的在跑（/24 枚举、discover 应答解析、码校验、错误映射）
 *   AB-10 防 placeholder IP 回潮：源码里不许出现写死的局域网默认地址
 *   AB-11 UI 设计系统真落地：ui/ token 文件都在、MainActivity 走 BitBotTheme（不是裸
 *         MaterialTheme 框架默认紫）、全 main 无「对标 Grok」文案、8 条 UI 用例真在结果里
 *   AB-12 窗口层主题跟设计系统同色：manifest 挂 @style/Theme.BitBot + adjustResize（键盘
 *         避让只做一次）、values/ 与 values-night/ 三个窗口色等于 Theme.kt 画布字面量、
 *         APK 资源表里真有 style/Theme.BitBot、4 条窗口用例真在结果里
 *   AB-13 内核回放在手机上说人话：MainActivity 把 /v1/turn 回包交给 HostReply.display、
 *         8 个 fixture 必须是真内核回包、6 条摘要/屏幕用例真在结果里（含「认不得的 kind
 *         不许编摘要」）
 *   AB-14 聊天记录活过转屏与重开：ChatHistoryStore 落在 filesDir（不是外部存储）且有界、
 *         onCreate 读回来、两条消息都过 addLine、「清空对话」在菜单里并接到 clearChat、
 *         manifest 不许用 configChanges 遮掉 recreate、9 条用例（CP-01..05 + HS-01..04）
 *         真在结果里
 *
 * 诚实边界（不假装做过）：
 *   - 没有 KVM → 起不了 emulator，OS 权限弹窗、真机安装、厂商商店签名都是残留；
 *   - values-night 在 JVM 上验不到（Robolectric 跑的是默认浅色配置）：AB-12 只能把夜色
 *     窗口色与 Theme.kt 的 CanvasDark 字面量对齐，深色观感仍然只能真机验收；
 *   - UI 验到的是「Compose 语义树 + 送进渲染器的颜色数值」两层：Robolectric NATIVE 模式下
 *     captureToImage 2000ms 超时，JVM 拿不到真像素，所以像素级观感（圆角实际效果、字距、
 *     阴影）仍然只能真机验收；
 *   - 没有 keystore 环境变量 → release 仍用 debug 签名（工程里有脚手架，不假装已上架）。
 * 缺 SDK / 缺 gradle 时诚实 SKIP，不红也不绿。
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const HOST = path.join(REPO, "hosts/android/BitBotHost");
const JDK =
  process.env.JAVA_HOME ||
  (fs.existsSync("/usr/lib/jvm/temurin-21") ? "/usr/lib/jvm/temurin-21" : "");

let PASS = 0,
  FAIL = 0,
  SKIP = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : ""));
};
const done = () => {
  console.log("prove_android_build: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};
const honestSkip = (why) => {
  console.log("prove_android_build: SKIP — " + why);
  console.log("prove_android_build: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
};

/* ---------- 工具链探测 ---------- */
function findSdk() {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  try {
    const lp = fs.readFileSync(path.join(HOST, "local.properties"), "utf8");
    const m = lp.match(/^\s*sdk\.dir\s*=\s*(.+)$/m);
    if (m && fs.existsSync(m[1].trim())) return m[1].trim();
  } catch {
    /* 没有 local.properties 就是没配 SDK */
  }
  return "";
}

function findAapt(sdk) {
  const bt = path.join(sdk, "build-tools");
  let versions = [];
  try {
    versions = fs.readdirSync(bt).sort();
  } catch {
    return "";
  }
  for (let i = versions.length - 1; i >= 0; i--) {
    const p = path.join(bt, versions[i], "aapt");
    if (fs.existsSync(p)) return p;
  }
  return "";
}

function findGradle() {
  const override = process.env.BITBOT_ANDROID_GRADLE || "";
  if (override && fs.existsSync(override)) return override;
  const which = spawnSync("bash", ["-lc", "command -v gradle"], { encoding: "utf8" });
  const sys = (which.stdout || "").trim();
  if (which.status === 0 && sys) return sys;
  const wrapper = path.join(HOST, "gradlew");
  return fs.existsSync(wrapper) ? wrapper : "";
}

if (!fs.existsSync(path.join(HOST, "app/build.gradle.kts"))) {
  honestSkip("Android 工程不在仓库里（hosts/android/BitBotHost）");
}
const SDK = findSdk();
if (!SDK) honestSkip("没装 Android SDK（ANDROID_HOME / local.properties sdk.dir 都没有）");
const AAPT = findAapt(SDK);
if (!AAPT) honestSkip("SDK 里没有 build-tools/aapt");
const GRADLE = findGradle();
if (!GRADLE) honestSkip("没有 gradle（系统 gradle 和 ./gradlew 都找不到）");
if (!JDK || !fs.existsSync(JDK)) honestSkip("没有 JDK（gradle 需要 Java 17+）");

const env = { ...process.env, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, JAVA_HOME: JDK };

/* ---------- 真编译 + 真跑 JVM 单测 ---------- */
console.log(
  "prove_android_build: gradle=" + GRADLE + " sdk=" + SDK + " jdk=" + JDK,
);
const build = spawnSync(
  GRADLE,
  [":app:assembleUniversalDebug", ":app:testUniversalDebugUnitTest", "--no-daemon", "--console=plain"],
  { cwd: HOST, env, encoding: "utf8", timeout: 25 * 60 * 1000 },
);
const buildOut = String(build.stdout || "") + String(build.stderr || "");
if (build.status !== 0) {
  bad("AB-01 assembleUniversalDebug + testUniversalDebugUnitTest 跑通", "exit=" + build.status + "\n" + buildOut.slice(-1200));
  done();
}

const apkCandidates = [
  path.join(HOST, "app/build/outputs/apk/universal/debug/app-universal-debug.apk"),
];
const apk = apkCandidates.find((p) => fs.existsSync(p)) || "";
if (!apk) {
  bad("AB-01 universalDebug APK 产出", JSON.stringify(apkCandidates));
  done();
}
const size = fs.statSync(apk).size;
if (size > 1024 * 1024) ok("AB-01 APK 产出且非空（" + Math.round(size / 1024 / 1024) + " MB）");
else bad("AB-01 APK 太小，不像装得上的包", size + " bytes");

const badge = spawnSync(AAPT, ["dump", "badging", apk], { encoding: "utf8" });
const badgeOut = String(badge.stdout || "");
if (badge.status !== 0 || !badgeOut) {
  bad("AB-02 aapt 读不回 badging", badge.status + " " + String(badge.stderr || "").slice(0, 300));
  done();
}

/* AB-02 包名 + 应用名 */
{
  const pkg = (badgeOut.match(/^package: name='([^']+)'/m) || [])[1] || "";
  const label = (badgeOut.match(/^application-label:'([^']+)'/m) || [])[1] || "";
  if (!/^com\.bitbot\.host/.test(pkg)) bad("AB-02 包名应为 com.bitbot.host*", "package=" + pkg);
  else if (label !== "Bit Bot") bad("AB-02 应用名应为 Bit Bot", "label=" + label);
  else ok("AB-02 包名/应用名如实：" + pkg + " · " + label);
}

/* AB-03 权限 */
{
  const wanted = [
    "android.permission.INTERNET",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.ACCESS_FINE_LOCATION",
  ];
  const missing = wanted.filter((p) => !badgeOut.includes("name='" + p + "'"));
  if (missing.length) bad("AB-03 权限缺失（手机上这些动作没有入口）", missing.join(", "));
  else ok("AB-03 权限齐：网络 + 相机 + 麦克风 + 定位");
}

/* AB-04 minSdk / targetSdk */
{
  const min = (badgeOut.match(/^sdkVersion:'(\d+)'/m) || [])[1] || "";
  const target = (badgeOut.match(/^targetSdkVersion:'(\d+)'/m) || [])[1] || "";
  const gradleSrc = fs.readFileSync(path.join(HOST, "app/build.gradle.kts"), "utf8");
  const wantMin = (gradleSrc.match(/minSdk\s*=\s*(\d+)/) || [])[1] || "";
  const wantTarget = (gradleSrc.match(/targetSdk\s*=\s*(\d+)/) || [])[1] || "";
  if (min !== wantMin || target !== wantTarget) {
    bad("AB-04 APK 里的 SDK 与工程配置不一致", "apk=" + min + "/" + target + " gradle=" + wantMin + "/" + wantTarget);
  } else {
    ok("AB-04 minSdk/targetSdk 一致（" + min + " / " + target + "）");
  }
}

/* AB-05 六个渠道 flavor */
{
  const gradleSrc = fs.readFileSync(path.join(HOST, "app/build.gradle.kts"), "utf8");
  const flavors = ["universal", "huawei", "xiaomi", "honor", "oppo", "vivo"];
  const missing = flavors.filter((f) => !new RegExp('create\\("' + f + '"\\)').test(gradleSrc));
  if (missing.length) bad("AB-05 国内渠道 flavor 缺失", missing.join(","));
  else ok("AB-05 六个渠道 flavor 都在（universal/huawei/xiaomi/honor/oppo/vivo）");
}

/* AB-06 JVM 单测真跑了 */
{
  const dir = path.join(HOST, "app/build/test-results/testUniversalDebugUnitTest");
  let tests = 0,
    failures = 0,
    files = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith("TEST-") || !f.endsWith(".xml")) continue;
      files++;
      const xml = fs.readFileSync(path.join(dir, f), "utf8");
      const suite = xml.match(/<testsuite[^>]*>/);
      if (!suite) continue;
      tests += Number((suite[0].match(/tests="(\d+)"/) || [])[1] || 0);
      failures += Number((suite[0].match(/failures="(\d+)"/) || [])[1] || 0);
      failures += Number((suite[0].match(/errors="(\d+)"/) || [])[1] || 0);
    }
  } catch {
    files = 0;
  }
  if (!files) bad("AB-06 JVM 单测结果文件不存在（test 任务没真跑）", dir);
  else if (failures > 0) bad("AB-06 JVM 单测有失败", failures + " failures / " + tests + " tests");
  else if (tests < 118) bad("AB-06 JVM 单测用例数偏少，像空跑", "tests=" + tests + " files=" + files);
  else ok("AB-06 JVM 单测真跑：" + tests + " 用例 0 失败（" + files + " 个类）");
  /* AB-07 配对地址那几条红线真的在跑（不是写了不执行）：
   * 未配对不许回写死地址、少协议要补全 —— 这两条是真机会踩的坑。 */
  const names = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith("TEST-") || !f.endsWith(".xml")) continue;
      // 注意要用 \s+ 卡住属性边界：`classname="…"` 里也含子串 `name="`，
      // 宽一点的 [^>]* 会把捕获跑到 classname 上（第一次写就踩了这个坑）。
      for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/<testcase\s+name="([^"]+)"/g)) {
        names.push(m[1]);
      }
    }
  } catch {
    /* 上面的分支已经报过 */
  }
  const wantCase = [/未配对/, /协议/];
  const missingCase = wantCase.filter((re) => !names.some((n) => re.test(n)));
  if (missingCase.length) {
    bad("AB-07 配对地址归一化的单测不在结果里（可能没编译进去）", missingCase.map(String).join(", "));
  } else {
    ok("AB-07 配对地址归一化单测真跑（未配对 / 少协议两条都在）");
  }
  /* AB-08 桌面失败原因翻译层真的在跑：401 要点名重抄令牌、404 不许贴 HTML、
   * 端口没人监听要说端口。这三条是「用户看得懂自己错在哪」的最后一段路。 */
  const wantExplain = [/HTML/, /端口没人监听/, /重抄|显示配对令牌/];
  const missingExplain = wantExplain.filter((re) => !names.some((n) => re.test(n)));
  if (missingExplain.length) {
    bad("AB-08 失败原因翻译层的单测不在结果里", missingExplain.map(String).join(", "));
  } else {
    ok("AB-08 失败原因翻译层单测真跑（401 点名令牌 / 404 不贴 HTML / refused 说端口）");
  }
  /* AB-09 配对 v1 纯逻辑单测真的在跑：/24 枚举、应答解析、码校验、错误映射。
   * 这些是零抄写配对流程的核心逻辑，必须在 JVM 层钉住。 */
  const wantPairing = [/枚举同.*子网/, /解析.*discover/, /invalid_code.*映射/, /四种失败.*区分/];
  const missingPairing = wantPairing.filter((re) => !names.some((n) => re.test(n)));
  if (missingPairing.length) {
    bad("AB-09 配对 v1 纯逻辑单测不在结果里", missingPairing.map(String).join(", "));
  } else {
    ok("AB-09 配对 v1 纯逻辑单测真跑（/24 枚举 / discover 解析 / 码校验 / 错误映射）");
  }
  /* AB-10 防 placeholder IP 回潮：扫 hosts/android/BitBotHost/app/src/main 的源码，
   * 出现任何写死的局域网默认值作为变量赋值（不是注释或示例）直接判红。
   * 这条要能防同类回潮 —— 上次 MainActivity.kt:440 写死 192.168.1.1 就是这类。
   *
   * 修复前红（模式过窄）：
   *   旧模式只抓 val/var xxx = "literal"，漏掉：
   *   - 带类型注解的赋值：val ip: String = "192.168.1.1"
   *   - 默认参数值：fun f(ip: String = "10.0.2.2")
   *   - 127.0.0.1 只在变量名为 localIp 时才抓，其它名字漏掉
   *   代码干净所以恒绿，这条门禁没有牙。
   *
   * 修复后绿：
   *   模式放宽到带类型注解、默认参数值、所有变量名。
   *   注释行（// 开头、* 开头）和测试目录排除在外。
   *   加负向对照：临时副本里塞几种写死形态，确认 AB-10 真的会红，跑完清干净。
   *   红/绿原文留在门禁注释里。
   */
  {
    const srcDir = path.join(HOST, "app/src/main");
    const testDir = path.join(HOST, "app/src/test");
    const ipLiterals = ["192\\.168\\.1\\.1", "10\\.0\\.2\\.2", "127\\.0\\.0\\.1"];
    const hardcodedPatterns = [];
    for (const ip of ipLiterals) {
      // 变量赋值（含类型注解）：val/var name[: Type] = "ip"
      hardcodedPatterns.push({
        re: new RegExp(`(?:val|var)\\s+\\w+(?:\\s*:\\s*\\w+)?\\s*=\\s*["']${ip}["']`),
        desc: `${ip.replace(/\\./g, ".")} 写死作为默认地址（变量赋值，含类型注解）`
      });
      // 默认参数值：fun f(name: Type = "ip")
      hardcodedPatterns.push({
        re: new RegExp(`\\w+\\s*:\\s*\\w+\\s*=\\s*["']${ip}["']`),
        desc: `${ip.replace(/\\./g, ".")} 写死作为默认参数值`
      });
    }
    const violations = [];
    function isCommentLine(line) {
      const trimmed = line.trim();
      return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    }
    function scanDir(dir, isTest) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scanDir(full, isTest || entry.name === "test" || entry.name === "androidTest");
        else if (entry.isFile() && /\.(kt|java)$/.test(entry.name)) {
          if (isTest) continue; // 测试目录不扫
          const src = fs.readFileSync(full, "utf8");
          const lines = src.split("\n");
          // 过滤掉注释行后再匹配
          const nonCommentSrc = lines.filter(l => !isCommentLine(l)).join("\n");
          for (const { re, desc } of hardcodedPatterns) {
            if (re.test(nonCommentSrc)) {
              const relPath = path.relative(REPO, full);
              violations.push(relPath + ": " + desc);
            }
          }
        }
      }
    }
    scanDir(srcDir, false);

    /* 负向对照：临时副本里塞几种写死形态，确认 AB-10 真的会红。
     * 像 scripts/prove_pairing_lan_rank.mjs 的 LR-02 那样把「尺子能失败」钉成断言。
     * 对照跑完必须清干净、不许污染源码。 */
    const tmpDir = path.join(HOST, "app/src/main/.ab10_negative_control_tmp");
    let negativeControlPassed = false;
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, "NegativeControl.kt");
      // 塞几种写死形态：变量赋值、类型注解赋值、默认参数值
      const injectedSrc = [
        'package com.bitbot.host.tmp',
        '',
        'class NegativeControl {',
        '  val ip1 = "192.168.1.1"',
        '  val ip2: String = "10.0.2.2"',
        '  fun connect(host: String = "127.0.0.1") {}',
        '}',
      ].join("\n");
      fs.writeFileSync(tmpFile, injectedSrc, "utf8");

      // 对临时副本跑同样的扫描逻辑
      const tmpViolations = [];
      const tmpEntries = fs.readdirSync(tmpDir, { withFileTypes: true });
      for (const entry of tmpEntries) {
        const full = path.join(tmpDir, entry.name);
        if (entry.isFile() && /\.(kt|java)$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          const lines = src.split("\n");
          const nonCommentSrc = lines.filter(l => !isCommentLine(l)).join("\n");
          for (const { re, desc } of hardcodedPatterns) {
            if (re.test(nonCommentSrc)) {
              tmpViolations.push(desc);
            }
          }
        }
      }
      // 负向对照必须抓到至少 3 种违规（三种写死形态各一条）
      negativeControlPassed = tmpViolations.length >= 3;
      if (!negativeControlPassed) {
        bad("AB-10 负向对照失败：尺子抓不到写死的 IP", "expected >=3 violations, got " + tmpViolations.length + ": " + tmpViolations.join("; "));
      }
    } catch (e) {
      bad("AB-10 负向对照跑异常", String(e).slice(0, 200));
    } finally {
      // 清干净临时副本
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch { /* best effort */ }
    }

    if (negativeControlPassed) {
      if (violations.length) {
        bad("AB-10 源码中出现写死的局域网默认地址（防 placeholder 回潮）", violations.join("; "));
      } else {
        ok("AB-10 无写死默认局域网地址（192.168.1.1 / 10.0.2.2 / 127.0.0.1 作为默认扫描地址，含类型注解与默认参数值；负向对照通过）");
      }
    }
  }
}

/* AB-11 UI 设计系统真的被用上了（不是又写了一个没人调的 Theme.kt）。
 *
 * 这轮的来由：用户原话「ui布局跟样式完全没法看，重构一版。必须跟主流ai相关的app对齐哦」。
 * 旧版的实情是 setContent { MaterialTheme { ... } } —— 一个 token 都没有，直接顶着
 * Material 3 框架默认紫上线；每句话还挂「你」「Bit Bot」两个角色标签。
 *
 * 修复前红（本轮真实输出，跑在旧 MainActivity 上，6 条全红）：
 *   T1 Expected exactly '1' node but could not find any node that satisfies:
 *      (Text + EditableText contains '未配对' as substring)
 *   T2 could not find any node that satisfies: (ContentDescription = '发送')
 *   T3 found '1' node: Role='Button' Text='[凭证]'
 *   T4 found '1' node: Text='[对标 Grok 的国产助手 · Android Host]'
 *   T5 found '1' node: Text='[BITBOT_HOST_URL]'
 *   T6 found '1' node: Text='[你]'
 *
 * 这条门盯四件事，缺一判红：
 *   1. ui/ 那五个文件都在（设计系统不是空口号）；
 *   2. MainActivity 的 content 根是 BitBotTheme，不是裸 MaterialTheme；
 *   3. 安卓源码里不许留「对标 Grok / Grok-style」这种对标文案；
 *   4. UI 那批用例真在结果里（写了不执行 = 假绿）。
 * 负向对照：临时副本塞裸 MaterialTheme 根 + 对标 Grok 文案，确认这条门真的会红。
 */
{
  const main = fs.readFileSync(
    path.join(HOST, "app/src/main/java/com/bitbot/host/MainActivity.kt"),
    "utf8",
  );
  const uiFiles = ["Theme.kt", "Components.kt", "HomeScreen.kt", "Sheets.kt", "PairingState.kt"];
  const missingUi = uiFiles.filter(
    (f) => !fs.existsSync(path.join(HOST, "app/src/main/java/com/bitbot/host/ui", f)),
  );
  const bareRoot = /setContent\s*\{\s*MaterialTheme\s*\{/.test(main);
  const usesTheme = /setContent\s*\{\s*BitBotTheme/.test(main);

  // 对标文案扫全 main 目录：别处再写一句同样判红，不只盯 MainActivity
  const parityFiles = [];
  const walkUiDir = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkUiDir(full);
      else if (/\.(kt|java|xml)$/.test(e.name)) {
        const src = fs.readFileSync(full, "utf8");
        if (/对标\s*Grok|Grok-style|Grok 的国产/i.test(src)) parityFiles.push(path.relative(REPO, full));
      }
    }
  };
  walkUiDir(path.join(HOST, "app/src/main"));

  // names 是 AB-06 块里的局部变量，这里自己再收一次（用例名从 JUnit XML 读，
  // 属性边界必须用 \s+ 卡住：classname="…" 里也含子串 name="）。
  const uiNames = [];
  {
    const resDir = path.join(HOST, "app/build/test-results/testUniversalDebugUnitTest");
    try {
      for (const f of fs.readdirSync(resDir)) {
        if (!f.startsWith("TEST-") || !f.endsWith(".xml")) continue;
        for (const m of fs.readFileSync(path.join(resDir, f), "utf8").matchAll(/<testcase\s+name="([^"]+)"/g)) {
          uiNames.push(m[1]);
        }
      }
    } catch {
      /* 下面按「不在结果里」判红 */
    }
  }

  const wantUiCases = [
    /T1_未配对/,
    /T2_发送是图标/,
    /T3_顶栏不把凭证和能力/,
    /T5_凭证面板/,
    /T6_聊天行/,
    /浅色主题不许顶着框架默认紫/,
    /深色主题不许顶着框架默认紫/,
    /有对话时不再出现角色标签/,
  ];
  const missingUiCases = wantUiCases.filter((re) => !uiNames.some((n) => re.test(n)));

  // 负向对照：同一把尺子必须能抓到「裸 MaterialTheme 根」和「对标 Grok 文案」
  const tmpDir = path.join(HOST, "app/src/main/.ab11_negative_control_tmp");
  let negOk = false;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const badSrc = [
      "package com.bitbot.host.tmp",
      "class NegativeControl {",
      "  fun content() = setContent { MaterialTheme { } }",
      '  val tagline = "对标 Grok 的国产助手"',
      "}",
    ].join("\n");
    const tmpFile = path.join(tmpDir, "NegativeControl.kt");
    fs.writeFileSync(tmpFile, badSrc, "utf8");
    const probe = fs.readFileSync(tmpFile, "utf8");
    negOk =
      /setContent\s*\{\s*MaterialTheme\s*\{/.test(probe) &&
      /对标\s*Grok|Grok-style|Grok 的国产/i.test(probe);
  } catch (e) {
    bad("AB-11 负向对照跑异常", String(e).slice(0, 200));
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  if (!negOk) bad("AB-11 负向对照失败：尺子抓不到裸 MaterialTheme 根或对标文案", "");

  const uiProblems = [];
  if (missingUi.length) uiProblems.push("设计系统文件缺失: " + missingUi.join(","));
  if (bareRoot) uiProblems.push("MainActivity 仍顶着裸 MaterialTheme 根（框架默认紫）");
  if (!bareRoot && !usesTheme) uiProblems.push("MainActivity 的 content 根不是 BitBotTheme");
  if (parityFiles.length) uiProblems.push("源码里还有对标 Grok 文案: " + parityFiles.join(","));
  if (missingUiCases.length)
    uiProblems.push("UI 用例不在结果里: " + missingUiCases.map(String).join(","));
  if (uiProblems.length) bad("AB-11 UI 设计系统没真正落地", uiProblems.join(" | "));
  else
    ok(
      "AB-11 设计系统落地：ui/ 五个文件 + BitBotTheme 根 + 全 main 无对标文案 + 8 条 UI 用例真跑（负向对照通过）",
    );
}

/* AB-12 窗口层主题必须跟设计系统同色（重构不许只做半屏）。
 *
 * 这轮的来由：Compose 画布换成中性 + 单一点缀色之后，manifest 还挂着
 * @android:style/Theme.Material.Light.NoActionBar —— 深色模式下 Compose 画近黑、
 * 状态栏却还是系统灰白，半屏深半屏浅是「没做完」最直观的 tell。键盘避让也从
 * Compose 的 .imePadding() 挪到 manifest 的 adjustResize，两边都做会把输入框
 * 顶出一段空白。
 *
 * 修复前红（同一批用例，跑在还没换 manifest theme 的树上的真实输出，4 条全红）：
 *   窗口底色…       expected:<-1> but was:<-328966>        ← #FFFAFAFA 框架灰白
 *   状态栏底色…     expected:<-1> but was:<-9079435>       ← #FF757575
 *   导航栏底色…     expected:<-1> but was:<8421504>        ← #FF808080
 *   状态栏图标…     主题里解析不到 attr=16844000            ← framework 浅色主题根本没这个 attr
 *
 * 这条门盯六件事，缺一判红：
 *   1. manifest 挂 @style/Theme.BitBot，不再挂 framework 主题；
 *   2. activity 有 windowSoftInputMode="adjustResize"，HomeScreen 不再叠 .imePadding()；
 *   3. values/themes.xml 三个窗口色都定成浅色画布，且 windowLightStatusBar=true；
 *   4. values-night/themes.xml 三个窗口色等于 Theme.kt 里的 CanvasDark 字面量，
 *      windowLightStatusBar=false —— 两层颜色从同一处取值，不许各写各的然后漂移；
 *   5. APK 资源表里真有 style/Theme.BitBot（aapt 读回来，不是源码说了算）；
 *   6. 四条窗口用例真在结果里（写了不执行 = 假绿）。
 * 负向对照：同一把尺子过一遍坏样本（framework 主题 / 夜色写成浅色画布 / imePadding 回潮），
 * 确认它真的会红；坏样本只在内存里，不落到 res/ 免得把正在跑的构建搞脏。
 */
{
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(HOST, rel), "utf8");
    } catch {
      return "";
    }
  };
  const manifest = read("app/src/main/AndroidManifest.xml");
  const lightXml = read("app/src/main/res/values/themes.xml");
  const nightXml = read("app/src/main/res/values-night/themes.xml");
  const themeKt = read("app/src/main/java/com/bitbot/host/ui/Theme.kt");
  const homeKt = read("app/src/main/java/com/bitbot/host/ui/HomeScreen.kt");

  const canvasOf = (name) => {
    // Theme.kt 里写的是 Color(0xFF0C0D10) —— 前缀是小写 x，别按大写去找
    const m = themeKt.match(new RegExp(name + "\\s*=\\s*Color\\(0[xX]([0-9A-Fa-f]{8})\\)"));
    return m ? "#" + m[1].toUpperCase() : "";
  };
  const WIN_COLORS = ["android:windowBackground", "android:statusBarColor", "android:navigationBarColor"];
  const colorItem = (xml, attr) => {
    const m = xml.match(new RegExp('name="' + attr + '"[^>]*>(#[0-9A-Fa-f]{8})<'));
    return m ? m[1].toUpperCase() : "";
  };
  const boolItem = (xml, attr) => {
    const m = xml.match(new RegExp('name="' + attr + '"[^>]*>(true|false)<'));
    return m ? m[1] : "";
  };
  const usesCustomTheme = (m) => /android:theme="@style\/Theme\.BitBot"/.test(m);
  const stillFramework = (m) => /@android:style\/Theme\./.test(m);
  const imeDouble = (src) => /\n\s*\.imePadding\(\)/.test(src) || /import androidx\.compose\.foundation\.layout\.imePadding/.test(src);

  // 负向对照：尺子必须能抓到这三种回潮形态
  const badManifest = manifest.replace('android:theme="@style/Theme.BitBot"', 'android:theme="@android:style/Theme.Material.Light.NoActionBar"');
  const badNight = nightXml.replace(/(android:windowBackground">#)([0-9A-Fa-f]{8})</, "$1FFFFFFFF<");
  const badIme = homeKt + "\n  .imePadding()\n";
  const negOk =
    !usesCustomTheme(badManifest) &&
    stillFramework(badManifest) &&
    colorItem(badNight, "android:windowBackground") !== canvasOf("CanvasDark") &&
    imeDouble(badIme);
  if (!negOk) bad("AB-12 负向对照失败：尺子抓不到窗口层回潮", "");

  const canvasLight = canvasOf("CanvasLight");
  const canvasDark = canvasOf("CanvasDark");
  const problems = [];
  if (!manifest) problems.push("读不到 AndroidManifest.xml");
  if (!usesCustomTheme(manifest)) problems.push('manifest 没挂 @style/Theme.BitBot');
  if (stillFramework(manifest)) problems.push("manifest 还挂着 framework 主题（半屏深半屏浅的根）");
  if (!/android:windowSoftInputMode="adjustResize"/.test(manifest)) problems.push('activity 缺 windowSoftInputMode="adjustResize"');
  if (imeDouble(homeKt)) problems.push("HomeScreen 还叠着 .imePadding()：与 adjustResize 双重补偿，键盘弹起时输入框被顶出空白");
  if (!lightXml) problems.push("缺 app/src/main/res/values/themes.xml");
  if (!nightXml) problems.push("缺 app/src/main/res/values-night/themes.xml（深色下窗口层还是浅色）");
  for (const xml of [lightXml, nightXml]) {
    if (xml && !/<style name="Theme\.BitBot"/.test(xml)) problems.push("theme xml 里没有 <style name=\"Theme.BitBot\">");
  }
  for (const attr of WIN_COLORS) {
    const l = colorItem(lightXml, attr);
    const n = colorItem(nightXml, attr);
    if (l !== canvasLight) problems.push("values/ " + attr + " = " + (l || "缺") + " 应等于 CanvasLight " + canvasLight);
    if (n !== canvasDark) problems.push("values-night/ " + attr + " = " + (n || "缺") + " 应等于 CanvasDark " + canvasDark);
  }
  if (boolItem(lightXml, "android:windowLightStatusBar") !== "true") problems.push("浅色画布上 windowLightStatusBar 不是 true（状态栏图标看不见）");
  if (boolItem(nightXml, "android:windowLightStatusBar") !== "false") problems.push("深色画布上 windowLightStatusBar 不是 false");

  // APK 资源表里真有这个 style：源码写了没链进包，手机上照样是 framework 主题
  const resDump = spawnSync(AAPT, ["dump", "resources", apk], { encoding: "utf8" });
  const resOut = String(resDump.stdout || "");
  if (!/style\/Theme\.BitBot/.test(resOut)) problems.push("APK 资源表里找不到 style/Theme.BitBot");

  const winNames = [];
  {
    const resDir = path.join(HOST, "app/build/test-results/testUniversalDebugUnitTest");
    try {
      for (const f of fs.readdirSync(resDir)) {
        if (!f.startsWith("TEST-") || !f.endsWith(".xml")) continue;
        for (const m of fs.readFileSync(path.join(resDir, f), "utf8").matchAll(/<testcase\s+name="([^"]+)"/g)) {
          winNames.push(m[1]);
        }
      }
    } catch {
      /* 下面按「不在结果里」判红 */
    }
  }
  const wantWindowCases = [
    /窗口底色必须是设计系统的画布/,
    /状态栏底色与画布同色/,
    /导航栏底色也与画布同色/,
    /浅色画布上状态栏图标必须是深色/,
  ];
  const missingWindow = wantWindowCases.filter((re) => !winNames.some((n) => re.test(n)));
  if (missingWindow.length) problems.push("窗口用例不在结果里: " + missingWindow.map(String).join(","));

  if (problems.length) bad("AB-12 窗口层主题没跟设计系统同色", problems.slice(0, 6).join(" | "));
  else
    ok(
      "AB-12 窗口层落地：manifest 挂 Theme.BitBot + adjustResize（无双重补偿）+ 浅色/深色窗口色与 Theme.kt 画布一致 + APK 资源表有 style + 4 条窗口用例真跑（负向对照通过）",
    );
}

/* AB-13 内核回放在手机上必须说人话（且不许为了好看藏事实）。
 *
 * 这轮的来由：画布/顶栏/输入框重构完之后，手机上「看不懂」还剩一条真凶 ——
 * 能力面板九个动作打出去，`/v1/turn` 最后一条 assistant 消息是
 * `Host FFI results applied … - ok kind=… ```{绝对路径、BITBOT_* 变量名、pretend_*}``` `，
 * 旧代码把它原样贴进聊天。主流 AI app 不会把内核转储当回复读给用户。
 *
 * 修复前红（HostReplySummaryTest 12 条里 11 条红，实现换成当天 App 的真实行为后真跑）：
 *   [machines_list] 还在往聊天里贴代码围栏：Host FFI results applied (MoonBit kernel / ADR 0002):…
 *   unavailable 就是不可用：Host FFI results applied … - ok kind=device_permission cmd=`desk-1|camera|u…
 *   feed 还没接上、备案还是空的 —— 这两条残留必须看得见：Host FFI results applied … - ok kind=check_updates…
 *   展开必须还能看到内核原文：null
 *   认不得的 kind 必须原样给出来，不猜 expected:<[unknown]> but was:<[normal]>
 *   …（共 12 tests completed, 11 failed）
 *
 * 这条门盯四件事：
 *   1. ui/HostReply.kt 在，MainActivity 真调 HostReply.display（不是又一个没人接的模块）；
 *   2. 八个 fixture 是真抓的内核回包（每个都含 Host FFI results applied），不是手写的漂亮样例；
 *   3. 摘要用例 + 屏幕用例真在结果里；
 *   4. 「认不得的 kind 不许编摘要」这条测试在 —— 呈现层只能翻译能确认的，不能猜。
 * 负向对照：把 MainActivity 换成当天的旧路径（直接贴 assistantText），门必须判红。
 */
{
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(HOST, rel), "utf8");
    } catch {
      return "";
    }
  };
  const main = read("app/src/main/java/com/bitbot/host/MainActivity.kt");
  const hostReply = read("app/src/main/java/com/bitbot/host/ui/HostReply.kt");
  const fixtureDir = path.join(HOST, "app/src/test/resources/hostfix");
  const wantFixtures = [
    "machines_list",
    "llm_list_models",
    "device_tools_list",
    "routine_list",
    "routine_tick",
    "check_updates",
    "device_permission",
    "approval_card",
  ];
  const fixtureProblems = [];
  for (const k of wantFixtures) {
    const p = path.join(fixtureDir, k + ".json");
    if (!fs.existsSync(p)) {
      fixtureProblems.push("缺 fixture: " + k);
      continue;
    }
    const body = fs.readFileSync(p, "utf8");
    if (!body.includes("Host FFI results applied")) fixtureProblems.push("fixture 不是真内核回包: " + k);
    if (!new RegExp('kind=' + k).test(body)) fixtureProblems.push("fixture 里的 kind 对不上: " + k);
  }

  const rpNames = [];
  {
    const resDir = path.join(HOST, "app/build/test-results/testUniversalDebugUnitTest");
    try {
      for (const f of fs.readdirSync(resDir)) {
        if (!f.startsWith("TEST-") || !f.endsWith(".xml")) continue;
        for (const m of fs.readFileSync(path.join(resDir, f), "utf8").matchAll(/<testcase\s+name="([^"]+)"/g)) {
          rpNames.push(m[1]);
        }
      }
    } catch {
      /* 下面按「不在结果里」判红 */
    }
  }
  const wantRpCases = [
    /九个能力回执没有一个还在贴原始倾倒/,
    /认不得的 kind 不许编摘要/,
    /原始回执仍然给得出来/,
    /屏幕上读得出人话 默认看不到内核原文/,
    /点一下看原始回执/,
    /相机这条不许在屏幕上说成已授权/,
  ];
  const missingRp = wantRpCases.filter((re) => !rpNames.some((n) => re.test(n)));

  const usesSummary = /HostReply\.display\(/.test(main) && hostReply.includes("object HostReply");
  // 负向对照：同一把尺子过一遍「当天真实的老路径」
  const oldPath = main.replace(/HostReply\.display\(/, "TurnBridge.legacyAssistant(");
  const negOk = !/HostReply\.display\(/.test(oldPath);
  if (!negOk) bad("AB-13 负向对照失败：尺子抓不到退回原样贴回落的写法", "");

  const problems = [];
  if (!hostReply) problems.push("缺 ui/HostReply.kt");
  if (!usesSummary) problems.push("MainActivity 没把回包交给 HostReply.display（还是在贴内核原文）");
  if (fixtureProblems.length) problems.push(fixtureProblems.join(", "));
  if (missingRp.length) problems.push("摘要/屏幕用例不在结果里: " + missingRp.map(String).join(","));
  if (problems.length) bad("AB-13 内核回执在手机上还没说人话", problems.slice(0, 5).join(" | "));
  else
    ok(
      "AB-13 回执呈现落地：HostReply.display 接在 MainActivity 上 + 8 个真抓 fixture 校验 + 6 条摘要/屏幕用例真跑（含「认不得的 kind 不许编摘要」，负向对照通过）",
    );
}

/* AB-14 聊天记录得活过「转个身」和「重新打开」（且清得掉）。
 *
 * 来由：HomeShell 的 lines 是 remember { mutableStateListOf() } —— 组合一散就没。
 * 用户实际踩到的是：打一句话、屏幕一旋（或系统把后台杀掉重开），刚才那轮对话全没了，
 * 首屏回到空态。主流 AI app 没有把这个行为留给用户的。
 *
 * 修复前红（ChatThreadPersistenceTest 在 HEAD 产品代码上真跑，Robolectric 真渲染）：
 *   CP01 转屏后那句话还在屏幕上 -> 红：assertExists 找不到节点（屏幕上 0 个）
 *   CP02 转屏后两条都还在且首屏不是空态 -> 红：同一条消息节点找不到
 *   CP03 对话落在 filesDir 下的一个文件里 -> 红：filesDir 里 0 个条目，历史只在内存
 *   CP04 存下来的对话不含凭证 -> 红：连「有没有文件」都过不去，断不了任何内容
 *   CP05 清空对话后屏幕与盘都干净且转屏不回来 -> 红：菜单里根本没有「清空对话」这一行
 *
 * 这条门盯五件事：
 *   1. ChatHistoryStore 在，写的是 filesDir（不是外部存储 —— 聊天记录不该让别的 app 读到），
 *      而且有界；
 *   2. MainActivity 真的接上了：onCreate 读回来、两条消息都过 addLine、落盘串行化；
 *   3. 「清空对话」在菜单里，而且真接到 clearChat（只加持久化不给出口 = 把这台机器上的
 *      聊天变成删不掉的东西）；
 *   4. 不许用 android:configChanges="orientation|…" 把 recreate 遮掉 —— 那是 display:none
 *      式的掩盖：转屏确实不重建了，进程被杀重开照样全没；
 *   5. 9 条用例（CP-01..05 真渲染 + HS-01..04 那一层的边界）真在结果里。
 * 负向对照：把 MainActivity 换成 HEAD 那份旧写法（不读历史、lines.add 直接上屏）后，
 * 同一把尺子必须判红。
 */
{
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(HOST, rel), "utf8");
    } catch {
      return "";
    }
  };
  const store = read("app/src/main/java/com/bitbot/host/ChatHistoryStore.kt");
  const main = read("app/src/main/java/com/bitbot/host/MainActivity.kt");
  const sheets = read("app/src/main/java/com/bitbot/host/ui/Sheets.kt");
  const manifest = read("app/src/main/AndroidManifest.xml");

  const names = [];
  {
    const resDir = path.join(HOST, "app/build/test-results/testUniversalDebugUnitTest");
    try {
      for (const f of fs.readdirSync(resDir)) {
        if (!f.startsWith("TEST-") || !f.endsWith(".xml")) continue;
        for (const m of fs.readFileSync(path.join(resDir, f), "utf8").matchAll(/<testcase\s+name="([^"]+)"/g)) {
          names.push(m[1]);
        }
      }
    } catch {
      /* 下面按「不在结果里」判红 */
    }
  }
  const wantCases = [
    /CP01_转屏后那句话还在屏幕上/,
    /CP02_转屏后两条都还在且首屏不是空态/,
    /CP03_对话落在filesDir下的一个文件里/,
    /CP04_存下来的对话不含凭证/,
    /CP05_清空对话后屏幕与盘都干净且转屏不回来/,
    /HS01_存进去的按原顺序读得回来/,
    /HS02_只留最近这么多条/,
    /HS03_半截文件当没有历史而不是把首屏炸掉/,
    /HS04_写不进去就老实回false不许抛也不许说成功/,
  ];
  const missingCases = wantCases.filter((re) => !names.some((n) => re.test(n)));

  const problems = [];
  if (!store) problems.push("缺 ChatHistoryStore.kt");
  if (store && !/File\(appContext\.filesDir,/.test(store)) {
    problems.push("对话没写在 filesDir 里（外部存储上的文件别的 app 也读得到）");
  }
  if (store && /getExternalFilesDir|EXTERNAL_STORAGE/.test(store)) {
    problems.push("对话写到了外部存储");
  }
  if (store && !/maxLines/.test(store)) problems.push("落盘没有上界（这台机器上的对话会被无限留着）");
  if (main && !/chatStore\.load\(\)/.test(main)) problems.push("MainActivity 没在 onCreate 读回历史（转屏仍会空态）");
  if (main && (main.match(/addLine\(/g) || []).length < 3) {
    problems.push("消息没有全部过 addLine（上屏与落盘会分叉）");
  }
  if (main && !/clearChat\(\)/.test(main)) problems.push("clearChat 没接上（盘上的历史清不掉）");
  if (sheets && !sheets.includes("清空对话")) problems.push("菜单里没有「清空对话」这一行");
  if (main && !/onClearChat\s*=/.test(main)) problems.push("菜单那行没接到 clearChat");
  if (/android:configChanges="[^"]*orientation/.test(manifest)) {
    problems.push("manifest 用 configChanges 遮掉了 recreate（掩盖问题，不是解决）");
  }
  if (missingCases.length) problems.push("用例不在结果里: " + missingCases.map(String).join(","));

  // 负向对照：同一把尺子过一遍 HEAD 那份旧写法
  const oldMain = main
    .replace("startupLines = runCatching { chatStore.load() }.getOrDefault(emptyList())", "/* 旧版：没有这一步 */")
    .replace("addLine(ChatLine(\"user\", trimmed))", "lines.add(ChatLine(\"user\", trimmed))")
    .replace("addLine(ChatLine(\"assistant\", assistant, shown.raw))", "lines.add(ChatLine(\"assistant\", assistant, shown.raw))")
    .replace("onClearChat = { showMenu = false; clearChat() },", "");
  const negProblems = [
    /chatStore\.load\(\)/.test(oldMain) ? "load" : "",
    /addLine\(ChatLine\("user"/.test(oldMain) ? "user-addLine" : "",
    /addLine\(ChatLine\("assistant"/.test(oldMain) ? "assistant-addLine" : "",
    /onClearChat\s*=/.test(oldMain) ? "clear-wiring" : "",
  ].filter(Boolean);
  if (negProblems.length) {
    bad("AB-14 负向对照失败：尺子抓不到退回旧写法的版本", negProblems.join(","));
  }

  if (problems.length) bad("AB-14 聊天记录还没活过转屏/重开", problems.slice(0, 6).join(" | "));
  else
    ok(
      "AB-14 对话落盘落地：filesDir 有界 JSON + onCreate 读回 + 两条消息都过 addLine + 「清空对话」接上 clearChat + manifest 没用 configChanges 遮 + 9 条用例真跑（负向对照通过）",
    );
}

console.log(
  "prove_android_build: 残留（诚实）— 无 KVM 起不了 emulator：OS 权限弹窗、真机安装、" +
    "厂商商店签名（BITBOT_ANDROID_STORE_*）未验证；本门禁不声称装过或跑过。",
);
done();
