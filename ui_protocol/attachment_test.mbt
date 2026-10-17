///|
test "attachment path validation" {
  assert_true(@ui_protocol.validate_path("/workspace/out/report.pdf") is Ok(_))
  assert_true(@ui_protocol.validate_path("/home/box/agent-data/x.png") is Ok(_))
  assert_true(@ui_protocol.validate_path("") is Err(_))
  assert_true(@ui_protocol.validate_path("/workspace/../etc/passwd") is Err(_))
  assert_true(@ui_protocol.validate_path("file:///workspace/a.txt") is Err(_))
  assert_true(@ui_protocol.validate_path("http://example.com/a") is Err(_))
  assert_true(@ui_protocol.validate_path("/tmp/invented.txt") is Err(_))

  let ref_ = @ui_protocol.AttachmentRef::{
    name: "report.pdf",
    mime: "application/pdf",
    path: "/workspace/out/report.pdf",
  }
  assert_true(ref_.validate() is Ok(_))
}
