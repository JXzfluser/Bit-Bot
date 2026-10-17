///|
/// CM-0801/0803: computerUse boundary — no shell escape; parent gets structured outcome.
test "acceptance_CM-0801_0803_computer_use_boundary" {
  match
    @computer_use.dispatch_computer_use("cu-1", "turn-1", {
      task: "open example.com",
      allow_shell_escape: false,
    }) {
    Ok((h, out)) => {
      assert_false(h.may_send_to_user)
      assert_true(h.parent_should_wake())
      assert_eq(out.summary, "structured outcome only")
      assert_eq(out.final_url, Some("https://example.com"))
      assert_false(out.blocked_on_signin)
    }
    Err(e) => fail(e)
  }
  match
    @computer_use.dispatch_computer_use("cu-bad", "t", {
      task: "x",
      allow_shell_escape: true,
    }) {
    Err(m) => assert_true(m.contains("Shell") || m.contains("box_host"))
    Ok(_) => fail("shell escape must reject")
  }
}
