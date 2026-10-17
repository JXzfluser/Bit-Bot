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
