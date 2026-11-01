///|
/// CM-0802: browser via box-chrome launcher — not bare chrome; lockfile diagnosable.

///|
pub fn box_chrome_launch_path() -> String {
  "/usr/local/bin/box-chrome"
}

///|
pub fn box_chrome_lockfile_path() -> String {
  "/tmp/box-chrome.lock"
}

///|
pub(all) enum BrowserLauncher {
  BoxChrome
  BareChrome
} derive(Eq, Debug)

///|
pub extend BrowserLauncher with Eq::{equal, not_equal}

///|
pub extend BrowserLauncher with Debug::{to_repr}

///|
pub fn BrowserLauncher::documented_path(self : BrowserLauncher) -> String {
  match self {
    BoxChrome => box_chrome_launch_path()
    BareChrome => "chrome"
  }
}

///|
pub(all) struct BrowserLaunchResult {
  launcher : BrowserLauncher
  launch_path : String
  lockfile : String
  lockfile_diagnosable : Bool
  started : Bool
} derive(Eq, Debug)

///|
pub extend BrowserLaunchResult with Eq::{equal, not_equal}

///|
pub extend BrowserLaunchResult with Debug::{to_repr}

///|
/// Documented launch path for computerUse browser (always box-chrome).
pub fn documented_box_chrome_path() -> String {
  box_chrome_launch_path()
}

///|
/// CM-0802: only BoxChrome is allowed; bare chrome rejected.
pub fn HostAbi::launch_browser(
  self : HostAbi,
  launcher : BrowserLauncher,
) -> Result[BrowserLaunchResult, String] {
  match launcher {
    BareChrome => {
      self.effects.push("browser:rejected_bare_chrome")
      Err("browser must launch via box-chrome; bare chrome forbidden")
    }
    BoxChrome => {
      let launch_path = box_chrome_launch_path()
      let lockfile = box_chrome_lockfile_path()
      let lock_body = "pid=mock-box-chrome\npath=" +
        launch_path +
        "\nstatus=running\n"
      self.fs.set(lockfile, lock_body)
      self.effects.push("browser:box-chrome")
      Ok({
        launcher: BoxChrome,
        launch_path,
        lockfile,
        lockfile_diagnosable: true,
        started: true,
      })
    }
  }
}

///|
/// Diagnose lockfile contents (CM-0802: lockfile diagnosable).
pub fn HostAbi::diagnose_box_chrome_lockfile(
  self : HostAbi,
) -> Result[String, String] {
  let lockfile = box_chrome_lockfile_path()
  match self.fs.get(lockfile) {
    None => Err("box-chrome lockfile absent: " + lockfile)
    Some(body) =>
      if body.contains("pid=") && body.contains("status=") {
        Ok(body)
      } else {
        Err("box-chrome lockfile not diagnosable")
      }
  }
}

///|
/// CM-0802 negative path: Host-side launch guard. Only the box-chrome launcher
/// paths pass; bare chrome / chromium are refused. Mirrors the `box-chrome`
/// policy in `scripts/host_h1_smoke.sh`. Pure check — never launches.
/// 这段以前寄居在 `box_host/h1_probes.mbt`（一个探针骨架文件）里，但它是通用
/// 安全策略而不是探针脚手架，探针层删除时一并搬回真正的归属地。
pub fn box_chrome_launch_guard(command_line : String) -> Result[String, String] {
  let trimmed = command_line.trim().to_owned()
  let argv0 = match trimmed.split(" ").to_array() {
    [] => ""
    parts => parts[0].to_owned()
  }
  if argv0 == "" {
    return Err("refused: empty launch command")
  }
  let allowed : Array[String] = [
    box_chrome_launch_path(),
    "/usr/local/libexec/sand/box-chrome",
    "/opt/sand/sand-host/box-launchers/box-chrome",
    "box-chrome",
  ]
  for a in allowed {
    if argv0 == a {
      return Ok(argv0)
    }
  }
  Err(
    "refused: bare chrome launch '" +
    argv0 +
    "' forbidden; must launch via " +
    box_chrome_launch_path(),
  )
}

///|
/// Live wrapper: records an audit span (ok=false on refusal) so Bit验证 can
/// query refusals. Does not launch anything and does not claim I.
pub fn HostAbi::guard_browser_launch(
  self : HostAbi,
  command_line : String,
) -> Result[String, String] {
  let res = box_chrome_launch_guard(command_line)
  let (ok, detail) = match res {
    Ok(p) => (true, "allowed " + p)
    Err(e) => (false, e)
  }
  self.effects.push(
    "browser_launch_guard:" + (if ok { "allowed" } else { "refused" }),
  )
  match self.backend {
    Live(_) =>
      self.record_audit(
        AuditSpan::make(
          "browser_launch_guard",
          artifact_path=Some(
            host_artifacts_dir() + "/cm-0802-box-chrome/bare_refusal.txt",
          ),
          ok~,
          detail~,
        ),
      )
    Mock => ()
  }
  res
}
