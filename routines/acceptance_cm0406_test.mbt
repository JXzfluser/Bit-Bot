///|
/// CM-0406: Slack event trigger shape validated; if not invited, prompt includes /invite.
test "acceptance_CM-0406_slack_event_trigger_shape" {
  let ok_shapes = [
    @routines.SlackListenerShape::{
      event: @routines.Mention,
      channel_selector: "C0123ABCDEF",
      invited: true,
      keyword: None,
    },
    @routines.SlackListenerShape::{
      event: @routines.Message,
      channel_selector: "#general",
      invited: true,
      keyword: None,
    },
    @routines.SlackListenerShape::{
      event: @routines.Reaction,
      channel_selector: "@alice",
      invited: true,
      keyword: None,
    },
    @routines.SlackListenerShape::{
      event: @routines.Keyword,
      channel_selector: "*",
      invited: true,
      keyword: Some("deploy"),
    },
  ]
  for s in ok_shapes {
    match @routines.validate_slack_listener(s) {
      Ok(_) => ()
      Err(e) => fail("valid shape rejected: " + e)
    }
  }
  // Keyword without keyword filter → Err.
  match
    @routines.validate_slack_listener(@routines.SlackListenerShape::{
      event: @routines.Keyword,
      channel_selector: "#ops",
      invited: true,
      keyword: None,
    }) {
    Err(m) => assert_true(m.contains("keyword"))
    Ok(_) => fail("keyword event without filter must Err")
  }
  // Bad selector → Err.
  match @routines.validate_slack_channel_selector("") {
    Err(_) => ()
    Ok(_) => fail("empty selector must Err")
  }
  // Not invited → /invite in prompt.
  let uninvited = @routines.SlackListenerShape::{
    event: @routines.Mention,
    channel_selector: "#private-room",
    invited: false,
    keyword: None,
  }
  match @routines.prepare_slack_listener(uninvited) {
    Ok(hint) =>
      match hint {
        None => fail("uninvited must produce invite prompt")
        Some(p) => {
          assert_true(p.contains("/invite"))
          assert_true(p.contains("#private-room"))
        }
      }
    Err(e) => fail(e)
  }
  // Invited → no invite prompt.
  match
    @routines.prepare_slack_listener(@routines.SlackListenerShape::{
      event: @routines.Mention,
      channel_selector: "#general",
      invited: true,
      keyword: None,
    }) {
    Ok(None) => ()
    Ok(Some(_)) => fail("invited must not prompt /invite")
    Err(e) => fail(e)
  }
}
