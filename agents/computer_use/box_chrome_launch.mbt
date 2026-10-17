///|
/// CM-0802: computerUse browser path must use box-chrome (Host mock).

///|
pub(all) struct ComputerUseBrowserLaunch {
  via_box_chrome : Bool
  launch_path : String
  lockfile_diagnosable : Bool
  rejected_bare : Bool
} derive(Eq, Debug)

///|
pub extend ComputerUseBrowserLaunch with Eq::{equal, not_equal}

///|
pub extend ComputerUseBrowserLaunch with Debug::{to_repr}

///|
/// Documented computerUse browser launcher path (not bare chrome).
pub fn computer_use_browser_launch_path() -> String {
  @box_host.documented_box_chrome_path()
}

///|
/// Launch browser for computerUse via Host box-chrome (kernel-contract mock).
pub fn computer_use_launch_browser(
  host : @box_host.HostAbi,
) -> Result[ComputerUseBrowserLaunch, String] {
  // Bare chrome must fail.
  match host.launch_browser(@box_host.BareChrome) {
    Ok(_) => return Err("bare chrome must not succeed")
    Err(_) => ()
  }
  match host.launch_browser(@box_host.BoxChrome) {
    Err(e) => Err(e)
    Ok(r) => {
      let diag = match host.diagnose_box_chrome_lockfile() {
        Ok(_) => true
        Err(_) => false
      }
      Ok({
        via_box_chrome: r.launcher == @box_host.BoxChrome,
        launch_path: r.launch_path,
        lockfile_diagnosable: diag && r.lockfile_diagnosable,
        rejected_bare: true,
      })
    }
  }
}
