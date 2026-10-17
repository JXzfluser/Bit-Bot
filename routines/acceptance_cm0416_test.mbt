///|
/// CM-0416: batch run strictly follows destination line in saved prompt;
/// no unauthorized fan-out/broadcast.
test "acceptance_CM-0416_delivery_destination_line" {
  let prompt = "Summarize inbox news.\nDestination: slack:C1, in-app; if no news, stay silent."
  match @routines.parse_destination_line(prompt) {
    Ok(d) => {
      assert_eq(d.recipients.length(), 2)
      assert_eq(d.recipients[0], "slack:C1")
      assert_eq(d.recipients[1], "in-app")
      assert_true(d.on_empty.contains("silent") || d.on_empty.length() > 0)
    }
    Err(e) => fail(e)
  }
  // Strict follow — only destination recipients.
  match @routines.plan_batch_delivery(prompt, ["slack:C1", "in-app"]) {
    Ok(targets) => {
      assert_eq(targets.length(), 2)
      assert_eq(targets[0], "slack:C1")
    }
    Err(e) => fail(e)
  }
  // Unauthorized fan-out / broadcast → Err.
  match
    @routines.plan_batch_delivery(prompt, ["slack:C1", "slack:C-EVERYONE"]) {
    Err(m) =>
      assert_true(
        m.contains("fan-out") ||
        m.contains("broadcast") ||
        m.contains("unauthorized"),
      )
    Ok(_) => fail("extra broadcast target must be rejected")
  }
  // Prompt without Destination line → Err.
  match @routines.parse_destination_line("just a body with no dest") {
    Err(_) => ()
    Ok(_) => fail("missing Destination: must Err")
  }
}
