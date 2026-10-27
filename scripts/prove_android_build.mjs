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
 *   AB-06 JVM 单测真的跑了：0 失败且用例数 ≥ 49（防止 test 任务空转假绿）
 *   AB-07 配对地址归一化的两条红线真的在结果里（未配对不许回写死地址、少协议要补全）
 *   AB-08 失败原因翻译层的三条红线真的在结果里（401 点名重抄令牌、404 不贴 HTML、
 *         Connection refused 要说端口没人监听）
 *   AB-09 配对 v1 纯逻辑单测真的在跑（/24 枚举、discover 应答解析、码校验、错误映射）
 *   AB-10 防 placeholder IP 回潮：源码里不许出现写死的局域网默认地址
 *
 * 诚实边界（不假装做过）：
 *   - 没有 KVM → 起不了 emulator，OS 权限弹窗、真机安装、厂商商店签名都是残留；
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
  else if (tests < 62) bad("AB-06 JVM 单测用例数偏少，像空跑", "tests=" + tests + " files=" + files);
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

console.log(
  "prove_android_build: 残留（诚实）— 无 KVM 起不了 emulator：OS 权限弹窗、真机安装、" +
    "厂商商店签名（BITBOT_ANDROID_STORE_*）未验证；本门禁不声称装过或跑过。",
);
done();
