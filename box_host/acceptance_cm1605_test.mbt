///|
/// CM-1605: screenshot / user image Read → describable ImageContent (visible + description).
test "acceptance_CM-1605_inline_image_understandable" {
  let host = @box_host.HostAbi::mock()
  // Screenshot path.
  let shot = host.screenshot("executor")
  match host.read_image(shot.path) {
    Ok(img) => {
      assert_true(img.visible)
      assert_true(img.description.length() > 0)
      assert_true(img.is_describable())
      assert_true(
        img.description.contains("screenshot") ||
        img.description.contains("describable"),
      )
      assert_eq(img.mime, "image/png")
    }
    Err(e) => fail(e)
  }
  // User-uploaded image.
  host.write("/workspace/uploads/user_photo.jpg", "JPEG-MOCK-PIXELS")
  match host.read_image("/workspace/uploads/user_photo.jpg") {
    Ok(img) => {
      assert_true(img.visible)
      assert_true(img.description.length() > 0)
      assert_true(img.is_describable())
      assert_true(
        img.description.contains("user") ||
        img.description.contains("describable") ||
        img.description.contains("image"),
      )
    }
    Err(e) => fail(e)
  }
}
