///|
/// CM-1807: slides/office-pptx — produce openable pptx (path + magic/openable).
test "acceptance_CM-1807_slides_pptx_openable" {
  assert_eq(@skills.slides_skill_name(), "slides")
  assert_eq(@skills.office_pptx_skill_name(), "office-pptx")
  let host = @skills.SlidesHost::mock()
  match
    host.generate_pptx(
      title="S-batch Demo",
      slides=["Agenda", "Status", "Next"],
      filename="s-batch.pptx",
    ) {
    Ok(art) => {
      assert_true(art.openable)
      assert_true(art.path.has_prefix("/workspace/"))
      assert_true(art.path.has_suffix(".pptx"))
      assert_eq(art.magic_prefix, "PK")
      assert_true(host.exists(art.path))
      assert_eq(art.title, "S-batch Demo")
    }
    Err(e) => fail(e)
  }
  match host.generate_pptx(title="", slides=["x"]) {
    Err(m) => assert_true(m.contains("title"))
    Ok(_) => fail("empty title must Err")
  }
}
