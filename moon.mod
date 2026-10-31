// Learn more about moon.mod configuration:
// https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html
//
// To add a dependency, run this command in your terminal:
//   moon add moonbitlang/x
//
// Or manually declare it in `import`, for example:
// import {
//   "moonbitlang/x@0.4.6",
// }

name = "bitbot/bitbot"

version = "0.1.0"

readme = "README.mbt.md"

repository = ""

license = "Apache-2.0"

keywords = [ ]

// The product ships a NATIVE kernel binary; the Host defaults to
// `--target native` (BITBOT_MOON_TARGET) and a packaged app runs the
// prebuilt `desktop_turn` binary. Keep the default build target in sync with
// what actually ships — see docs/adr/0002-wasm-host-boundary.md.
// The wasm target is kept only for the legacy planner (moon test --target wasm).

preferred_target = "native"

description = ""
