///|
/// CM-1601: GenerateImage — artifact on disk, deliverable as attachment.
test "acceptance_CM-1601_generate_image_artifact_deliverable" {
  let host = @media.MediaHost::mock()
  match
    host.generate_image(
      prompt="a blue geometric logo for Bit Bot",
      name="bitbot-logo.png",
    ) {
    Ok(art) => {
      assert_true(art.on_disk)
      assert_true(art.path.has_prefix("/workspace/"))
      assert_true(art.path.has_suffix(".png"))
      assert_eq(art.mime, "image/png")
      assert_true(host.exists(art.path))
      match @media.deliver_generated_image(host, art) {
        Ok(att) => {
          assert_eq(att.path, art.path)
          assert_eq(att.mime, "image/png")
          match att.validate() {
            Ok(_) => ()
            Err(e) => fail(e)
          }
        }
        Err(e) => fail(e)
      }
    }
    Err(e) => fail(e)
  }
  match host.generate_image(prompt="") {
    Err(m) => assert_true(m.contains("prompt"))
    Ok(_) => fail("empty prompt must Err")
  }
}
