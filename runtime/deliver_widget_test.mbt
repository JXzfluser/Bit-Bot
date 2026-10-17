///|
test "widget and attachment delivery; no mix" {
  let t0 = @runtime.open_turn(turn_id="t-w", text="pick")
  let spec = @ui_protocol.WidgetSpec::{
    prompt: "继续？",
    options: [
      @ui_protocol.WidgetOption::{
        label: "是",
        value: "yes",
        style: @ui_protocol.Primary,
      },
    ],
    multi_select: false,
    allow_custom: false,
    dismiss_on_move_on: false,
  }
  match t0.deliver_widget(widget_id="w1", spec~) {
    Ok(t1) => {
      assert_eq(t1.outbound.length(), 1)
      assert_eq(t1.outbound[0].parts[0].label(), "widget")
    }
    Err(e) => fail(e)
  }
  match
    t0.deliver_attachment(
      name="a.png",
      mime="image/png",
      path="/workspace/a.png",
    ) {
    Ok(t1) => assert_eq(t1.outbound[0].parts[0].label(), "attachment")
    Err(e) => fail(e)
  }
  match t0.deliver_attachment(name="x", mime="x", path="http://evil") {
    Err(_) => ()
    Ok(_) => fail("hallucinated scheme must reject")
  }
}
