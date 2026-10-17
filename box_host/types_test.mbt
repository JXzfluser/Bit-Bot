///|
test "box fs and shell request" {
  let fs = @box_host.BoxFs::default()
  assert_eq(fs.resolve("bitbot"), "/workspace/bitbot")
  let req = @box_host.ShellRequest::on_box("moon check")
  assert_eq(req.block_until_ms, 30000)
  let desk = @box_host.DesktopSession::placeholder("executor")
  assert_eq(desk.browser_attached, false)
}
