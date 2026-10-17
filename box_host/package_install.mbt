///|
/// CM-2158: box package install (apt/npm/…) must go through Shell (kernel-contract).

///|
pub(all) enum PackageManager {
  Apt
  Npm
  Pip
  Cargo
} derive(Eq, Debug)

///|
pub extend PackageManager with Eq::{equal, not_equal}

///|
pub extend PackageManager with Debug::{to_repr}

///|
pub fn PackageManager::label(self : PackageManager) -> String {
  match self {
    Apt => "apt"
    Npm => "npm"
    Pip => "pip"
    Cargo => "cargo"
  }
}

///|
/// Build the Shell command string for a package install (no real OS).
pub fn package_install_shell_command(
  pm : PackageManager,
  packages : Array[String],
) -> Result[String, String] {
  if packages.length() == 0 {
    return Err("package list must not be empty")
  }
  for p in packages {
    if p.length() == 0 {
      return Err("package name must not be empty")
    }
    if p.contains(";") || p.contains("|") || p.contains("`") {
      return Err("package name must not contain shell metacharacters")
    }
  }
  let joined = join_pkgs(packages)
  let cmd = match pm {
    Apt => "apt-get install -y " + joined
    Npm => "npm install -g " + joined
    Pip => "pip install " + joined
    Cargo => "cargo install " + joined
  }
  Ok(cmd)
}

///|
fn join_pkgs(packages : Array[String]) -> String {
  let mut out = ""
  let mut i = 0
  while i < packages.length() {
    if i > 0 {
      out = out + " "
    }
    out = out + packages[i]
    i = i + 1
  }
  out
}

///|
/// Plan install as a ShellRequest on the box (cwd /workspace).
pub fn plan_box_package_install(
  pm : PackageManager,
  packages : Array[String],
) -> Result[ShellRequest, String] {
  match package_install_shell_command(pm, packages) {
    Err(e) => Err(e)
    Ok(cmd) => Ok(ShellRequest::on_box(cmd))
  }
}

///|
/// CM-2158: install goes through HostAbi::shell — never a side-channel.
pub fn install_box_package_via_shell(
  host : HostAbi,
  pm : PackageManager,
  packages : Array[String],
) -> Result[ShellResult, String] {
  match plan_box_package_install(pm, packages) {
    Err(e) => Err(e)
    Ok(req) => {
      let r = host.shell(req)
      // Evidence: effect recorded as shell, command carries package manager.
      let label = pm.label()
      if !r.stdout.contains(label) &&
        !req.command.contains(label) &&
        !req.command.contains("apt-get") &&
        !req.command.contains("npm") &&
        !req.command.contains("pip") &&
        !req.command.contains("cargo") {
        return Err("install command missing package manager marker")
      }
      Ok(r)
    }
  }
}

///|
/// Refuse a non-Shell install path (kernel-contract guard).
pub fn reject_non_shell_package_install(via : String) -> Result[Unit, String] {
  let lower = via.to_lower()
  if lower == "shell" || lower == "hostabi.shell" {
    Ok(())
  } else {
    Err("box package install must go through Shell; refused: " + via)
  }
}
