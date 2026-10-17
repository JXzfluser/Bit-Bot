package com.bitbot.host

import java.io.File

/**
 * ADR 0002 Host bridge: invokes repo `hosts/mobile_host/run.js` so Android
 * shares the same MoonBit brain + Host FFI as Desktop / iOS.
 */
object TurnBridge {
  fun runTurn(text: String, machineKind: String = "android"): String {
    val repoRoot = System.getenv("BITBOT_REPO_ROOT") ?: inferRepoRoot()
    val runner = File(repoRoot, "hosts/mobile_host/run.js")
    require(runner.isFile) { "missing mobile_host runner at ${runner.absolutePath}" }
    val pb = ProcessBuilder(
      "node",
      runner.absolutePath,
      "--machine-kind",
      machineKind,
      "--session-id",
      "android-app",
      text,
    )
    pb.directory(File(repoRoot))
    pb.redirectErrorStream(true)
    val proc = pb.start()
    val out = proc.inputStream.bufferedReader().readText()
    val code = proc.waitFor()
    if (code != 0) {
      error("turn failed ($code): $out")
    }
    return out.trim()
  }

  private fun inferRepoRoot(): String {
    var dir = File(System.getProperty("user.dir") ?: ".")
    repeat(8) {
      if (File(dir, "moon.mod.json").isFile) return dir.absolutePath
      dir = dir.parentFile ?: return dir.absolutePath
    }
    return File(".").absolutePath
  }
}
