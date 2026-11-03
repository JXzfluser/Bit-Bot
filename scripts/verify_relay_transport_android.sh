#!/usr/bin/env bash
# A3-5/A3-6 本机自证：手机侧中转传输层（RelayTunnel / TunnelHttp / ConnectionStrategy / TransportStatus）
#   门禁用例外：RT-01..RT-13（传输层 + 回执四栏解析）、TS-01..TS-03（连接方式文案）
#
# 为什么需要这个脚本：
#   本机没有 Android SDK（ANDROID_HOME / local.properties 都没有），`./gradlew :app:test…`
#   跑不起来 —— 这意味着 AGP 编译与 193 条全量**只能靠 CI**。但要证「中转这条路真通」，
#   其实不需要 Android 运行时：这 6 个文件（4 个产品 + 2 个测试）只依赖 java.net / java.io + JUnit4。
#   于是用 maven 中央上的 kotlin-compiler-embeddable（与 CI 同一个 Kotlin 1.9.24）直接编译+跑，
#   红绿都能在本机拿到原文。这不是替代 CI，是让这一刀能被本地复查。
#
# 用法：bash scripts/verify_relay_transport_android.sh
# 依赖：java（17+）、curl、网络（首次下载 8 个 jar 到 .tmpdl/jars，已 gitignore）
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
JARS="${REPO}/.tmpdl/jars"
OUT="${REPO}/.tmpdl/rtout"
SRC="${REPO}/hosts/android/BitBotHost/app/src"
M="https://repo1.maven.org/maven2"
KT="1.9.24"

mkdir -p "${JARS}" "${OUT}"

# 注意：变量一律用 ${VAR} —— `$VAR（` 这种中英文紧邻会被 shell 当成变量名的一部分。
fetch() {
  local rel="$1"
  local f="${JARS}/$(basename "${rel}")"
  if [ -s "${f}" ]; then
    return 0
  fi
  echo "  · 下载 $(basename "${rel}")"
  curl -L --retry 6 --retry-all-errors --retry-delay 3 -s -o "${f}" "${M}/${rel}" || {
    echo "  下载失败：${rel}" >&2
    return 1
  }
}

COMPILER_CP=""
for rel in \
  "org/jetbrains/kotlin/kotlin-compiler-embeddable/${KT}/kotlin-compiler-embeddable-${KT}.jar" \
  "org/jetbrains/kotlin/kotlin-stdlib/${KT}/kotlin-stdlib-${KT}.jar" \
  "org/jetbrains/kotlin/kotlin-script-runtime/${KT}/kotlin-script-runtime-${KT}.jar" \
  "org/jetbrains/kotlin/kotlin-reflect/${KT}/kotlin-reflect-${KT}.jar" \
  "org/jetbrains/intellij/deps/trove4j/1.0.20200330/trove4j-1.0.20200330.jar" \
  "org/jetbrains/annotations/13.0/annotations-13.0.jar" ; do
  fetch "${rel}" || exit 2
  COMPILER_CP="${COMPILER_CP:+${COMPILER_CP}:}${JARS}/$(basename "${rel}")"
done

TEST_CP=""
for rel in \
  "org/jetbrains/kotlin/kotlin-stdlib/${KT}/kotlin-stdlib-${KT}.jar" \
  "org/json/json/20240303/json-20240303.jar" \
  "junit/junit/4.13.2/junit-4.13.2.jar" \
  "org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar" ; do
  fetch "${rel}" || exit 2
  TEST_CP="${TEST_CP:+${TEST_CP}:}${JARS}/$(basename "${rel}")"
done

FILES=(
  "${SRC}/main/java/com/bitbot/host/RelayTunnel.kt"
  "${SRC}/main/java/com/bitbot/host/TunnelHttp.kt"
  "${SRC}/main/java/com/bitbot/host/ConnectionStrategy.kt"
  "${SRC}/main/java/com/bitbot/host/TransportStatus.kt"
  "${SRC}/test/java/com/bitbot/host/RelayTransportTest.kt"
  "${SRC}/test/java/com/bitbot/host/TransportStatusTest.kt"
)

echo "== VRT-1 编译（6 个文件 = 4 个产品 + 2 个测试，纯 JVM，不需要 Android SDK）=="
rm -rf "${OUT}"
mkdir -p "${OUT}"
java -cp "${COMPILER_CP}" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-reflect -cp "${TEST_CP}" -d "${OUT}" "${FILES[@]}" > "${REPO}/.tmpdl/vrt-compile.log" 2>&1
compile_rc=$?
errors=$(grep -c "error:" "${REPO}/.tmpdl/vrt-compile.log" || true)
if [ "${compile_rc}" -ne 0 ] || [ "${errors}" != "0" ]; then
  echo "  ✗ 编译失败（exit=${compile_rc}, errors=${errors}）"
  grep "error:" "${REPO}/.tmpdl/vrt-compile.log" | head -10
  echo "verify_relay_transport: FAIL"
  exit 1
fi
echo "  ✓ 编译通过（0 error；完整日志 .tmpdl/vrt-compile.log）"

echo "== VRT-2 跑 RT-01..RT-13 + TS-01..TS-03（真 ServerSocket 假中继 / 假桌面）=="
java -cp "${OUT}:${TEST_CP}" org.junit.runner.JUnitCore \
  com.bitbot.host.RelayTransportTest com.bitbot.host.TransportStatusTest \
  > "${REPO}/.tmpdl/vrt-test.log" 2>&1
test_rc=$?
grep -E "^Tests run|^OK \(|^FAILURES|^[0-9]+\) " "${REPO}/.tmpdl/vrt-test.log" | head -20

if [ "${test_rc}" -eq 0 ] && grep -q "^OK (" "${REPO}/.tmpdl/vrt-test.log"; then
  echo "== VRT-3 结果 =="
  echo "  ✓ $(grep -m1 '^OK (' "${REPO}/.tmpdl/vrt-test.log")"
  echo "verify_relay_transport: PASS"
  exit 0
fi

echo "== VRT-3 结果 =="
echo "  ✗ 有用例失败（完整日志 .tmpdl/vrt-test.log）"
echo "verify_relay_transport: FAIL"
exit 1
