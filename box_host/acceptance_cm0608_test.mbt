///|
/// CM-0608: /.dockerenv distinguishes local Docker vs hosted anyrun; diagnostic correct.
test "acceptance_CM-0608_docker_vs_anyrun_env_detect" {
  let local_diag = @box_host.diagnose_box_env(
    @box_host.EnvProbe::local_docker(),
  )
  assert_eq(local_diag.runtime, @box_host.LocalDocker)
  assert_eq(local_diag.runtime.label(), "local-docker")
  assert_true(local_diag.is_correct())
  assert_eq(local_diag.dockerenv_path, "/.dockerenv")
  assert_true(local_diag.summary.contains("local-docker"))

  let hosted = @box_host.diagnose_box_env(@box_host.EnvProbe::hosted_anyrun())
  assert_eq(hosted.runtime, @box_host.HostedAnyrun)
  assert_eq(hosted.runtime.label(), "hosted-anyrun")
  assert_true(hosted.is_correct())
  assert_true(hosted.summary.contains("hosted=yes"))

  let bare = @box_host.diagnose_box_env(@box_host.EnvProbe::bare())
  assert_eq(bare.runtime, @box_host.Unknown)
  assert_true(bare.summary.contains("dockerenv=absent"))

  // HostAbi records effect + may seed /.dockerenv
  let host = @box_host.HostAbi::mock()
  let d = host.diagnose_runtime(@box_host.EnvProbe::local_docker())
  assert_eq(d.runtime, @box_host.LocalDocker)
  match host.read("/.dockerenv") {
    Ok(_) => ()
    Err(e) => fail("local docker probe should seed /.dockerenv: " + e)
  }
  let mut saw = false
  for e in host.effects {
    if e == "env_detect:local-docker" {
      saw = true
    }
  }
  assert_true(saw)

  // Distinction: same /.dockerenv, different hosted markers → different kind
  assert_true(
    @box_host.detect_box_runtime(@box_host.EnvProbe::local_docker()) !=
    @box_host.detect_box_runtime(@box_host.EnvProbe::hosted_anyrun()),
  )
}
