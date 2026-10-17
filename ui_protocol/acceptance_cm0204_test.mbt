///|
/// CM-0204: hidden flag — not in main sidebar but still addressable.
test "acceptance_CM-0204_hidden_agent_not_in_main_sidebar" {
  let dir = @ui_protocol.AgentDirectory::new()
  dir.register(
    @ui_protocol.AgentRecord::new(id="main-bot", name="Bit", title="Main"),
  )
  dir.register(
    @ui_protocol.AgentRecord::new(
      id="sys-hidden",
      name="SystemHelper",
      title="Hidden sub-session",
      hidden=true,
    ),
  )
  dir.register(
    @ui_protocol.AgentRecord::new(id="research", name="Research", hidden=false),
  )

  let sidebar = dir.main_sidebar_ids()
  assert_eq(sidebar.length(), 2)
  assert_true(dir.in_main_sidebar("main-bot"))
  assert_true(dir.in_main_sidebar("research"))
  assert_false(dir.in_main_sidebar("sys-hidden"))

  // Hidden remains addressable.
  assert_true(dir.is_addressable("sys-hidden"))
  assert_true(dir.is_addressable("main-bot"))
  match dir.get("sys-hidden") {
    Ok(a) => {
      assert_true(a.hidden)
      assert_eq(a.name, "SystemHelper")
    }
    Err(e) => fail(e)
  }

  // Toggle hide on a main agent → drops from sidebar, still addressable.
  match dir.set_hidden("research", hidden=true) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  assert_false(dir.in_main_sidebar("research"))
  assert_true(dir.is_addressable("research"))
  assert_eq(dir.main_sidebar_ids().length(), 1)

  assert_false(dir.is_addressable("never-registered"))
}
