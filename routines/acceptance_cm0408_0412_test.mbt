///|
/// CM-0408: Origin PR events — native repos only; reject mirror; CI needs pr.
test "acceptance_CM-0408_origin_event_native_repo_only" {
  match
    @routines.validate_origin_listener(@routines.OriginListenerShape::{
      event: @routines.Pr,
      repo: "org/native-app",
      repo_kind: @routines.Native,
      pr_scope: Some("org/native-app#12"),
    }) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Mirror rejected.
  match
    @routines.validate_origin_listener(@routines.OriginListenerShape::{
      event: @routines.Pr,
      repo: "org/mirrored-from-github",
      repo_kind: @routines.Mirror,
      pr_scope: Some("org/mirrored-from-github#1"),
    }) {
    Err(m) => assert_true(m.contains("mirror") || m.contains("native"))
    Ok(_) => fail("mirror Origin repo must be rejected")
  }
  // CI without pr scope → Err.
  match
    @routines.validate_origin_listener(@routines.OriginListenerShape::{
      event: @routines.Ci,
      repo: "org/native-app",
      repo_kind: @routines.Native,
      pr_scope: None,
    }) {
    Err(m) =>
      assert_true(m.contains("pr") || m.contains("CI") || m.contains("ci"))
    Ok(_) => fail("origin CI without pr must Err")
  }
  // CI with pr scope on native → Ok.
  match
    @routines.validate_origin_listener(@routines.OriginListenerShape::{
      event: @routines.Ci,
      repo: "org/native-app",
      repo_kind: @routines.Native,
      pr_scope: Some("org/native-app#12"),
    }) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
}

///|
/// CM-0410: Grok Bot inbox wake + tag filter; headers only; body via ReadEmailThread.
test "acceptance_CM-0410_mail_inbox_wake_headers_only" {
  let listener = @routines.MailInboxListener::{ tag_filter: Some("+alerts"), }
  let headers = @routines.MailWakeHeaders::{
    message_id: "mid-1",
    thread_id: "th-wake-1",
    from_address: "noreply@example.com",
    to_address: "bot@mail.grokbot.com",
    subject: "Disk almost full",
    tags: ["+alerts", "ops"],
  }
  let body = "SECRET_BODY_CONTENT_do_not_put_in_wake"
  match @routines.mail_inbox_wake(listener, headers) {
    Ok(h) => {
      let payload = @routines.mail_wake_payload(h)
      assert_true(payload.contains("mid-1"))
      assert_true(payload.contains("Disk almost full"))
      assert_true(payload.contains("from="))
      assert_false(@routines.mail_wake_payload_leaks_body(payload, body))
      assert_false(payload.contains(body))
    }
    Err(e) => fail(e)
  }
  // +tag filter rejects non-matching.
  match
    @routines.mail_inbox_wake(listener, @routines.MailWakeHeaders::{
      message_id: "mid-2",
      thread_id: "th-2",
      from_address: "x@y.z",
      to_address: "bot@mail.grokbot.com",
      subject: "noise",
      tags: ["+newsletter"],
    }) {
    Err(m) => assert_true(m.contains("tag") || m.contains("filter"))
    Ok(_) => fail("non-matching +tag must filter out")
  }
  // Body via ReadEmailThread (connectors/mail).
  let svc = @mail.MailService::new()
  svc.seed_thread(id="th-wake-1", subject="Disk almost full", snippet=body)
  match svc.read_thread(thread_id="th-wake-1") {
    Ok(th) => {
      assert_eq(th.id, "th-wake-1")
      assert_true(th.snippet.contains("SECRET_BODY") || th.snippet == body)
    }
    Err(e) => fail(e)
  }
}

///|
/// CM-0411: Webhook POST; user copies URL/key from panel; key opaque; wake has <webhook_event>.
test "acceptance_CM-0411_webhook_trigger_key_opaque" {
  let secrets = @routines.WebhookPanelSecrets::new(
    url="https://hooks.example/bitbot/wh-abc",
    key="whsec_opaque_do_not_tool_read",
  )
  // User may copy from panel.
  assert_eq(secrets.user_copy_url(), "https://hooks.example/bitbot/wh-abc")
  assert_eq(secrets.user_copy_key(), "whsec_opaque_do_not_tool_read")
  // Assistant tool-read key → Err.
  match secrets.assistant_tool_read_key() {
    Err(m) =>
      assert_true(
        m.contains("opaque") || m.contains("cannot") || m.contains("key"),
      )
    Ok(_) => fail("assistant must not tool-read webhook key")
  }
  let wake = @routines.webhook_wake_payload(
    event_id="evt-9",
    summary="POST /hooks received",
  )
  assert_true(@routines.webhook_wake_has_event_tag(wake))
  assert_true(wake.contains("<webhook_event"))
  assert_true(wake.contains("</webhook_event>"))
  assert_true(wake.contains("evt-9"))
  // Wake must not leak the key.
  assert_false(wake.contains("whsec_opaque_do_not_tool_read"))
}

///|
/// CM-0412: Group listeners OR; cron may join; any path wakes same prompt.
test "acceptance_CM-0412_group_listeners_any_path_same_prompt" {
  let prompt = "When any path fires, run the shared triage prompt."
  let group = @routines.GroupListener::new(prompt~, paths=[
    @routines.Slack(selector="#ops"),
    @routines.Github(pr_ref="org/app#3"),
    @routines.Cron(expr="@every 30m"),
    @routines.Webhook,
  ])
  assert_true(group.allows_cron())
  match group.wake_on(@routines.Slack(selector="#ops")) {
    Some(p) => assert_eq(p, prompt)
    None => fail("slack path must wake")
  }
  match group.wake_on(@routines.Github(pr_ref="org/app#3")) {
    Some(p) => assert_eq(p, prompt)
    None => fail("github path must wake same prompt")
  }
  match group.wake_on(@routines.Cron(expr="@every 30m")) {
    Some(p) => assert_eq(p, prompt)
    None => fail("cron path must wake same prompt")
  }
  match group.wake_on(@routines.Webhook) {
    Some(p) => assert_eq(p, prompt)
    None => fail("webhook path must wake same prompt")
  }
  // Non-member path → no wake.
  match group.wake_on(@routines.Slack(selector="#random")) {
    None => ()
    Some(_) => fail("unlisted path must not wake")
  }
}
