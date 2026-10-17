///|
/// CM-2102: Widget multiSelect (one value per line), danger style,
/// dismissOnMoveOn, allowCustom.
test "acceptance_CM-2102_widget_multiselect_danger_dismiss" {
  match
    @ui_protocol.WidgetSpec::decision_card_advanced(
      prompt="Pick next steps",
      options=[
        { label: "Ship", value: "ship", style: @ui_protocol.Primary, },
        { label: "Delete", value: "delete", style: @ui_protocol.Danger, },
        { label: "Defer", value: "defer", style: @ui_protocol.Default, },
      ],
      multi_select=true,
      allow_custom=true,
      dismiss_on_move_on=true,
    ) {
    Err(e) => fail(e)
    Ok(spec) => {
      assert_true(spec.multi_select)
      assert_true(spec.allow_custom)
      assert_true(spec.dismiss_on_move_on)
      assert_true(spec.should_dismiss_on_move_on())
      assert_true(spec.has_danger_option())
      assert_eq(spec.options[1].style.label(), "danger")
      let choice = @ui_protocol.WidgetChoice::{
        widget_id: "w-adv",
        selected_values: ["ship", "defer"],
        custom_text: Some("also note risk"),
      }
      let lines = choice.as_multiselect_lines()
      assert_true(lines.contains("ship\ndefer"))
      assert_false(lines.contains("ship,defer"))
      assert_true(lines.has_prefix("ship"))
      assert_true(lines.contains("defer\nalso"))
      assert_true(lines.contains("also note risk"))
      assert_eq(lines, "ship\ndefer\nalso note risk")
    }
  }
}
