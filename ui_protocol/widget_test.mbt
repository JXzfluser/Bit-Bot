///|
test "widget validate options 1-6 and danger style" {
  let ok = @ui_protocol.WidgetSpec::{
    prompt: "Pick one",
    options: [
      { label: "A", value: "a", style: @ui_protocol.Default, },
      { label: "Danger", value: "d", style: @ui_protocol.Danger, },
    ],
    multi_select: false,
    allow_custom: false,
    dismiss_on_move_on: true,
  }
  assert_true(ok.validate() is Ok(_))
  assert_eq(@ui_protocol.Danger.label(), "danger")

  let empty = @ui_protocol.WidgetSpec::{
    prompt: "x",
    options: [],
    multi_select: false,
    allow_custom: false,
    dismiss_on_move_on: false,
  }
  assert_true(empty.validate() is Err(_))

  let too_many = @ui_protocol.WidgetSpec::{
    prompt: "x",
    options: [
      { label: "1", value: "1", style: @ui_protocol.Default, },
      { label: "2", value: "2", style: @ui_protocol.Default, },
      { label: "3", value: "3", style: @ui_protocol.Default, },
      { label: "4", value: "4", style: @ui_protocol.Default, },
      { label: "5", value: "5", style: @ui_protocol.Default, },
      { label: "6", value: "6", style: @ui_protocol.Default, },
      { label: "7", value: "7", style: @ui_protocol.Default, },
    ],
    multi_select: true,
    allow_custom: true,
    dismiss_on_move_on: false,
  }
  assert_true(too_many.validate() is Err(_))
}

///|
test "envelope rejects widget with attachment" {
  let bad = @ui_protocol.SendEnvelope::{
    turn_id: "t1",
    parts: [
      @ui_protocol.Widget(widget_id="w1", payload_json="{}"),
      @ui_protocol.Attachment(
        name="a.txt",
        mime="text/plain",
        path="/workspace/a.txt",
      ),
    ],
    channel_hint: (None : String?),
  }
  assert_true(
    @ui_protocol.validate_envelope_no_widget_attachment(bad) is Err(_),
  )

  let good = @ui_protocol.SendEnvelope::{
    turn_id: "t2",
    parts: [
      @ui_protocol.Text(body="hi"),
      @ui_protocol.Widget(widget_id="w1", payload_json="{}"),
    ],
    channel_hint: (None : String?),
  }
  assert_true(
    @ui_protocol.validate_envelope_no_widget_attachment(good) is Ok(_),
  )
}
