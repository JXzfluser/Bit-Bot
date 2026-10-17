///|
/// CM-0805: computerUse surfaces request_box_help via ui_protocol handoff-as-ask.

///|
pub fn computer_use_request_box_help(
  reason~ : String,
) -> Result[@ui_protocol.BoxHelpHandoff, String] {
  @ui_protocol.request_box_help(reason~)
}
