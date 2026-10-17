///|
/// Visual style for a widget option button (CM-0105).
pub(all) enum OptionStyle {
  Default
  Primary
  Danger
} derive(Eq, Debug)

///|
pub extend OptionStyle with Eq::{not_equal, equal}

///|
pub extend OptionStyle with Debug::{to_repr}

///|
pub fn OptionStyle::label(self : OptionStyle) -> String {
  match self {
    Default => "default"
    Primary => "primary"
    Danger => "danger"
  }
}

///|
/// One selectable choice on a decision widget.
pub(all) struct WidgetOption {
  label : String
  value : String
  style : OptionStyle
} derive(Eq, Debug)

///|
pub extend WidgetOption with Eq::{not_equal, equal}

///|
pub extend WidgetOption with Debug::{to_repr}

///|
/// Decision-card / multi-select widget payload (CM-0105).
pub(all) struct WidgetSpec {
  prompt : String
  options : Array[WidgetOption]
  multi_select : Bool
  allow_custom : Bool
  dismiss_on_move_on : Bool
} derive(Eq, Debug)

///|
pub extend WidgetSpec with Eq::{not_equal, equal}

///|
pub extend WidgetSpec with Debug::{to_repr}

///|
/// Validate widget shape: options length must be 1–6; Danger style is allowed.
pub fn WidgetSpec::validate(self : WidgetSpec) -> Result[Unit, String] {
  let n = self.options.length()
  if n < 1 {
    return Err("widget requires at least 1 option")
  }
  if n > 6 {
    return Err("widget allows at most 6 options")
  }
  for opt in self.options {
    if opt.label.length() == 0 || opt.value.length() == 0 {
      return Err("widget option label and value must be non-empty")
    }
    // Danger is an allowed style (no error).
    let _ = opt.style
  }
  Ok(())
}

///|
fn part_is_widget(part : MessageKind) -> Bool {
  match part {
    Widget(_) => true
    _ => false
  }
}

///|
fn part_is_attachment(part : MessageKind) -> Bool {
  match part {
    Attachment(_) => true
    _ => false
  }
}

///|
/// CM-0105: Widget must NOT be combined with Attachment in the same SendEnvelope.
pub fn validate_envelope_no_widget_attachment(
  env : SendEnvelope,
) -> Result[Unit, String] {
  let mut has_widget = false
  let mut has_attachment = false
  for p in env.parts {
    if part_is_widget(p) {
      has_widget = true
    }
    if part_is_attachment(p) {
      has_attachment = true
    }
  }
  if has_widget && has_attachment {
    Err("widget must not be combined with attachment in the same SendEnvelope")
  } else {
    Ok(())
  }
}

///|
/// Submitted widget choice (CM-0105); Host turns this into a user message payload.
pub(all) struct WidgetChoice {
  widget_id : String
  selected_values : Array[String]
  custom_text : String?
} derive(Eq, Debug)

///|
pub extend WidgetChoice with Eq::{not_equal, equal}

///|
pub extend WidgetChoice with Debug::{to_repr}

///|
/// CM-0105: widget submission becomes a user-message payload string.
pub fn WidgetChoice::as_user_message_payload(self : WidgetChoice) -> String {
  let parts : Array[String] = []
  for v in self.selected_values {
    parts.push(v)
  }
  match self.custom_text {
    Some(t) => if t.length() > 0 { parts.push(t) }
    None => ()
  }
  let mut out = "widget:" + self.widget_id + ":"
  let mut i = 0
  while i < parts.length() {
    if i > 0 {
      out = out + ","
    }
    out = out + parts[i]
    i = i + 1
  }
  out
}

///|
/// CM-2102: multiSelect submission — one value per line (not comma-joined).
pub fn WidgetChoice::as_multiselect_lines(self : WidgetChoice) -> String {
  let sb = StringBuilder()
  let mut i = 0
  while i < self.selected_values.length() {
    if i > 0 {
      sb.write_char('\n')
    }
    sb.write_string(self.selected_values[i])
    i = i + 1
  }
  match self.custom_text {
    Some(t) =>
      if t.length() > 0 {
        if self.selected_values.length() > 0 {
          sb.write_char('\n')
        }
        sb.write_string(t)
      }
    None => ()
  }
  sb.to_string()
}

///|
/// CM-2102: build a decision card with advanced options (multiSelect / danger /
/// dismissOnMoveOn / allowCustom).
pub fn WidgetSpec::decision_card_advanced(
  prompt~ : String,
  options~ : Array[WidgetOption],
  multi_select~ : Bool = true,
  allow_custom~ : Bool = true,
  dismiss_on_move_on~ : Bool = true,
) -> Result[WidgetSpec, String] {
  let spec = {
    prompt,
    options,
    multi_select,
    allow_custom,
    dismiss_on_move_on,
  }
  match spec.validate() {
    Err(e) => Err(e)
    Ok(_) => Ok(spec)
  }
}

///|
/// CM-2102: when dismiss_on_move_on is set, moving on dismisses the widget.
pub fn WidgetSpec::should_dismiss_on_move_on(self : WidgetSpec) -> Bool {
  self.dismiss_on_move_on
}

///|
/// True when at least one option uses Danger style.
pub fn WidgetSpec::has_danger_option(self : WidgetSpec) -> Bool {
  for opt in self.options {
    match opt.style {
      Danger => return true
      _ => ()
    }
  }
  false
}
