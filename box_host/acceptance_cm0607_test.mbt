///|
/// CM-0607: box-doctor self-check; /tmp/box-doctor.log; PASS/FAIL parsable; failures reportable.
test "acceptance_CM-0607_box_doctor_pass_fail_parsable" {
  let host = @box_host.HostAbi::mock()
  let checks : Array[@box_host.BoxDoctorCheck] = [
    { name: "disk", pass: true, },
    { name: "display", pass: false, },
    { name: "network", pass: true, },
  ]
  let report = host.run_box_doctor(checks~)
  assert_eq(report.log_path, "/tmp/box-doctor.log")
  assert_false(report.overall_pass)
  assert_true(report.failures_reportable())
  let fails = report.failure_names()
  assert_true(fails.length() >= 1)
  assert_eq(fails[0], "display")
  // Lines parsable.
  let mut saw_pass = false
  let mut saw_fail = false
  let mut saw_summary = false
  for ln in report.lines {
    match ln.kind {
      @box_host.Pass => {
        saw_pass = true
        assert_true(ln.raw.has_prefix("PASS "))
      }
      @box_host.Fail => {
        saw_fail = true
        assert_true(ln.raw.has_prefix("FAIL "))
      }
      @box_host.Summary => {
        saw_summary = true
        assert_true(ln.raw.has_prefix("SUMMARY"))
      }
      @box_host.Other => ()
    }
  }
  assert_true(saw_pass && saw_fail && saw_summary)
  match host.read_box_doctor_log() {
    Ok(raw) => {
      assert_true(raw.contains("PASS disk"))
      assert_true(raw.contains("FAIL display"))
      assert_true(raw.contains("SUMMARY"))
      let parsed = @box_host.parse_doctor_line("FAIL display")
      assert_eq(parsed.kind, @box_host.Fail)
      assert_eq(parsed.check_name, "display")
    }
    Err(e) => fail(e)
  }
}
