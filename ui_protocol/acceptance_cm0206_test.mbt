///|
/// CM-0206: per-assistant notification settings — assistant-level notify toggles.
/// Kernel-contract only.
test "acceptance_CM-0206_per_assistant_notification_settings" {
  let store = @ui_protocol.PerAssistantNotifyStore::new()
  // Defaults per assistant.
  let a = store.get_or_defaults("asst-alpha")
  assert_eq(a.assistant_id, "asst-alpha")
  assert_true(a.desktop)
  assert_true(a.sound)
  assert_false(a.mentions_only)
  // Toggle sound off for alpha only.
  let a2 = store.set_toggle(
    "asst-alpha",
    @ui_protocol.AssistantNotifyToggle::Sound,
    false,
  )
  assert_false(a2.sound)
  assert_true(a2.desktop)
  // Beta unaffected (still defaults).
  let b = store.get_or_defaults("asst-beta")
  assert_true(b.sound)
  assert_eq(b.assistant_id, "asst-beta")
  assert_true(store.is_assistant_scoped("asst-alpha"))
  assert_true(store.is_assistant_scoped("asst-beta"))
  // Mentions-only toggle.
  let a3 = store.set_toggle(
    "asst-alpha",
    @ui_protocol.AssistantNotifyToggle::MentionsOnly,
    true,
  )
  assert_true(a3.mentions_only)
  assert_false(a3.get(@ui_protocol.AssistantNotifyToggle::Sound))
  // Profile entries for memory/profile persistence shape.
  let entries = a3.to_profile_entries()
  assert_eq(entries.length(), 5)
  assert_true(entries[0].0.contains("asst-alpha"))
  assert_true(entries[0].0.contains("notify.desktop"))
  assert_eq(@ui_protocol.AssistantNotifyToggle::Desktop.key(), "notify.desktop")
  assert_eq(
    @ui_protocol.AssistantNotifyToggle::Channels.key(),
    "notify.channels",
  )
}
