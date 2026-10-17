///|
/// CM-0801: named Shell GUI bypasses rejected; ViaComputerUse allowed.
test "acceptance_CM-0801_named_bypass_rejected" {
  match
    @computer_use.evaluate_gui_automation(
      "xdotool click 1",
      @computer_use.ViaShell,
    ) {
    Err(m) => assert_true(m.contains("xdotool") || m.contains("bypass"))
    Ok(_) => fail("Shell+xdotool must Err")
  }
  match
    @computer_use.evaluate_gui_automation(
      "npx Playwright install",
      @computer_use.ViaShell,
    ) {
    Err(m) =>
      assert_true(
        m.contains("playwright") ||
        m.contains("Playwright") ||
        m.contains("bypass"),
      )
    Ok(_) => fail("Shell+Playwright must Err")
  }
  match
    @computer_use.evaluate_gui_automation(
      "attach CDP endpoint",
      @computer_use.ViaShell,
    ) {
    Err(m) =>
      assert_true(
        m.contains("cdp") || m.contains("CDP") || m.contains("bypass"),
      )
    Ok(_) => fail("Shell+CDP must Err")
  }
  match
    @computer_use.evaluate_gui_automation(
      "open page (mentions xdotool Playwright CDP in notes)",
      @computer_use.ViaComputerUse,
    ) {
    Ok(_) => ()
    Err(e) => fail("ViaComputerUse must Allow even if names mentioned: " + e)
  }
}
