///|
/// CM-2005: voice:<call> live call — second-assistant; text relay; on end
/// voice-calls/ JSON; reply only to voice address; summarize into app.
test "acceptance_CM-2005_voice_call_relay_summary_on_end" {
  assert_eq(@skills.voice_skill_name(), "voice")
  let addr = @channels.parse_channel_address("voice:call-42")
  assert_eq(addr.kind, @channels.Voice)
  assert_eq(addr.reply_hint(), "voice:call-42")
  assert_true(@channels.is_external_hint(Some("voice:call-42")))

  match
    @skills.VoiceCallSession::start(
      call_id="call-42",
      second_assistant_id="asst-voice-2",
    ) {
    Err(e) => fail(e)
    Ok(session) => {
      assert_true(session.is_live())
      assert_eq(session.voice_address, "voice:call-42")
      assert_eq(session.second_assistant_id, "asst-voice-2")
      match
        session.assert_reply_voice_only(outbound_channel=Some("voice:call-42")) {
        Ok(_) => ()
        Err(e) => fail(e)
      }
      match session.assert_reply_voice_only(outbound_channel=None) {
        Err(m) => assert_true(m.contains("voice") || m.contains("requires"))
        Ok(_) => fail("omit channel must fail on live voice call")
      }
      match session.assert_reply_voice_only(outbound_channel=Some("slack:C1")) {
        Err(_) => ()
        Ok(_) => fail("non-voice reply must fail")
      }
      match session.relay_text(from_role="user", text="Can you join?") {
        Ok(_) => ()
        Err(e) => fail(e)
      }
      match
        session.relay_text(
          from_role="asst-voice-2",
          text="On the call, summarizing next steps.",
        ) {
        Ok(_) => ()
        Err(e) => fail(e)
      }
      assert_eq(session.relay_log.length(), 2)
      match session.end_and_summarize() {
        Err(e) => fail(e)
        Ok((path, summary)) => {
          assert_true(@skills.is_voice_calls_json_path(path))
          assert_eq(path, "voice-calls/call-42.json")
          assert_true(summary.contains("call-42"))
          assert_true(
            summary.contains("asst-voice-2") || summary.contains("ended"),
          )
          match session.ended_json_path {
            Some(p) => assert_eq(p, path)
            None => fail("ended_json_path required")
          }
          match session.app_summary {
            Some(s) => assert_true(s.contains("ended"))
            None => fail("app_summary required")
          }
          let json = session.build_end_json()
          assert_true(json.contains("call-42"))
          assert_true(json.contains("relay_count"))
          assert_true(json.contains("On the call") || json.contains("relays"))
        }
      }
      assert_false(session.is_live())
      match
        session.assert_reply_voice_only(outbound_channel=Some("voice:call-42")) {
        Err(m) => assert_true(m.contains("ended"))
        Ok(_) => fail("ended call must not accept voice reply")
      }
    }
  }
}
