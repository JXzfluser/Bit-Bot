///|
test "desktop_turn_ack_and_json_shape" {
  let r = run_desktop_turn("hello from desktop", turn_id="dt-test")
  assert_true(r.ok)
  assert_eq(r.turn_id, "dt-test")
  assert_eq(r.v, 1)
  assert_eq(r.intent, "chat")
  assert_true(r.messages.length() >= 2)
  assert_eq(r.messages[0].role, "user")
  assert_eq(r.messages[0].text, "hello from desktop")
  assert_eq(r.messages[1].role, "assistant")
  let json = r.to_json_line()
  assert_true(json.contains("\"v\":1"))
  assert_true(json.contains("\"ok\":true"))
  assert_true(json.contains("\"turn_id\":\"dt-test\""))
  assert_true(json.contains("hello from desktop"))
  assert_true(json.contains("\"modules\":["))
  assert_true(json.contains("runtime"))
  assert_true(json.contains("\"machines\":[]"))
  assert_true(json.contains("\"needs_host_ffi\":false"))
  assert_true(json.contains("\"host_continued\":false"))
}

///|
test "desktop_turn_empty_text_fails" {
  let r = run_desktop_turn("   ")
  assert_false(r.ok)
  assert_true(r.error is Some(_))
}

///|
test "desktop_turn_list_machines_kinds" {
  let r = run_desktop_turn("ListMachines", turn_id="lm-1")
  assert_true(r.ok)
  assert_eq(r.intent, "list_machines")
  assert_eq(r.machines.length(), 3)
  let kinds = [r.machines[0].kind, r.machines[1].kind, r.machines[2].kind]
  assert_true(kinds.contains("desktop"))
  assert_true(kinds.contains("ios"))
  assert_true(kinds.contains("android"))
  let json = r.to_json_line()
  assert_true(json.contains("\"kind\":\"desktop\""))
  assert_true(json.contains("\"kind\":\"ios\""))
  assert_true(json.contains("\"kind\":\"android\""))
}

///|
test "desktop_turn_memory_update_and_recall" {
  let u = run_desktop_turn("remember favorite_color=blue", turn_id="mem-u")
  assert_true(u.ok)
  assert_eq(u.intent, "memory_update")
  assert_true(u.memory.length() >= 1)
  assert_eq(u.memory[0].key, "favorite_color")
  let r = run_desktop_turn("recall demo", turn_id="mem-r")
  assert_true(r.ok)
  assert_eq(r.intent, "memory_recall")
  assert_true(r.memory.length() >= 1)
  assert_true(r.memory[0].key.contains("demo"))
}

///|
test "desktop_turn_session_memory_seeds" {
  let seeds : Array[(String, String)] = [("favorite_color", "blue"), ("city", "SF")]
  let r = run_desktop_turn(
    "recall favorite",
    turn_id="mem-seed",
    memory_seeds=seeds,
  )
  assert_true(r.ok)
  assert_eq(r.intent, "memory_recall")
  assert_true(r.memory.length() >= 1)
  assert_eq(r.memory[0].key, "favorite_color")
  let u = run_desktop_turn(
    "remember city=NYC",
    turn_id="mem-seed-u",
    memory_seeds=seeds,
  )
  assert_true(u.ok)
  assert_true(u.memory.length() >= 2)
  let args = ["exe", "--seed-memory", "a=1", "--seed-memory", "b=2", "recall", "a"]
  let parsed = parse_memory_seeds(args)
  assert_eq(parsed.length(), 2)
  assert_eq(user_text_from_args_skipping_flags(args), "recall a")
}

///|
test "desktop_turn_host_effect_needs_ffi" {
  let r = run_desktop_turn("shell echo hi", turn_id="fx-1")
  assert_true(r.ok)
  assert_eq(r.intent, "host_effect")
  assert_true(r.needs_host_ffi)
  assert_eq(r.effects.length(), 1)
  assert_eq(r.effects[0].kind, "shell")
  assert_eq(r.effects[0].command, "echo hi")
  assert_true(r.to_json_line().contains("\"needs_host_ffi\":true"))
}

///|
test "desktop_turn_host_ffi_continue_adr0002" {
  let results : Array[DesktopHostResult] = [
    {
      kind: "shell",
      ok: true,
      command: "echo hi",
      stdout: "hi\n",
      stderr: "",
      error: "",
    },
  ]
  let r = continue_after_host_ffi(
    turn_id="fx-cont",
    prior_user_text="shell echo hi",
    results,
  )
  assert_true(r.ok)
  assert_eq(r.intent, "host_continue")
  assert_true(r.host_continued)
  assert_false(r.needs_host_ffi)
  assert_true(r.messages.length() >= 2)
  let last = r.messages[r.messages.length() - 1].text
  assert_true(last.contains("Host FFI results applied"))
  assert_true(last.contains("hi"))
  assert_true(r.to_json_line().contains("\"host_continued\":true"))
}

///|
test "desktop_turn_channel_delivery_external" {
  let r = run_desktop_turn(
    "reply via slack:C123 :: thanks from desktop",
    turn_id="ch-1",
  )
  assert_true(r.ok)
  assert_eq(r.intent, "channel_delivery")
  assert_true(r.channel_delivery.has_prefix("external:"))
  assert_true(r.needs_host_ffi)
  assert_eq(r.effects.length(), 1)
  assert_eq(r.effects[0].kind, "channel_send")
}

///|
test "desktop_turn_channel_in_app_omit" {
  let r = run_desktop_turn(
    "channel plan body=stay in chat only",
    turn_id="ch-2",
  )
  assert_true(r.ok)
  assert_eq(r.intent, "channel_delivery")
  assert_eq(r.channel_delivery, "in_app")
  assert_false(r.needs_host_ffi)
}

///|
test "desktop_turn_connectors_status" {
  let r = run_desktop_turn("list connectors", turn_id="conn-1")
  assert_true(r.ok)
  assert_eq(r.intent, "connectors_status")
  assert_true(r.needs_host_ffi)
  assert_eq(r.effects[0].kind, "connectors_probe")
  assert_true(r.messages[r.messages.length() - 1].text.contains("Connectors status"))
}

///|
test "desktop_turn_fs_webfetch_and_context" {
  let ctx : DesktopTurnContext = {
    session_id: "s-ios",
    machine_id: "phone-ios",
    machine_kind: "ios",
    channel: "slack:C1",
  }
  let r = run_desktop_turn("listdir docs", turn_id="fs-1", ctx~)
  assert_true(r.ok)
  assert_eq(r.intent, "fs_list")
  assert_eq(r.machine_kind, "ios")
  assert_eq(r.channel, "slack:C1")
  assert_eq(r.effects[0].kind, "fs_list")
  let w = run_desktop_turn(
    "webfetch https://example.com",
    turn_id="wf-1",
    ctx~,
  )
  assert_true(w.ok)
  assert_eq(w.intent, "webfetch")
  assert_eq(w.effects[0].command, "https://example.com")
  let args = [
    "exe",
    "--machine-kind",
    "android",
    "--session-id",
    "s2",
    "--channel",
    "email:a@b",
    "hi",
  ]
  let parsed = parse_turn_context(args)
  assert_eq(parsed.machine_kind, "android")
  assert_eq(parsed.machine_id, "phone-android")
  assert_eq(parsed.channel, "email:a@b")
}

///|
test "desktop_turn_claim_inbox_and_draft_mail" {
  let c = run_desktop_turn("claim inbox alpha", turn_id="mail-c")
  assert_true(c.ok)
  assert_eq(c.intent, "claim_inbox")
  assert_true(c.messages[c.messages.length() - 1].text.contains("alpha@"))
  let d = run_desktop_turn(
    "draft mail to=bob@example.com subject=Hi body=Hello Bob",
    turn_id="mail-d",
  )
  assert_true(d.ok)
  assert_eq(d.intent, "draft_mail")
  assert_eq(d.effects.length(), 1)
  assert_eq(d.effects[0].kind, "mail_send")
  assert_true(d.needs_host_ffi)
}

///|
test "desktop_turn_copy_to_from_box" {
  let t = run_desktop_turn(
    "copy to box machine=desk-1 src=README.mbt.md dest=/workspace/uploads/README.mbt.md",
    turn_id="c2b",
  )
  assert_true(t.ok)
  assert_eq(t.intent, "copy_to_box")
  assert_eq(t.effects[0].kind, "copy_to_box")
  let f = run_desktop_turn(
    "copy from box machine=desk-1 box=/workspace/uploads/README.mbt.md dest=/workspace/uploads/out-README.mbt.md",
    turn_id="cfb",
  )
  assert_true(f.ok)
  assert_eq(f.intent, "copy_from_box")
}

///|
test "classify_intent_table" {
  assert_eq(classify_intent("ListMachines"), ListMachines)
  assert_eq(classify_intent("list machines"), ListMachines)
  match classify_intent("remember a=b") {
    MemoryUpdate(key~, value~) => {
      assert_eq(key, "a")
      assert_eq(value, "b")
    }
    _ => fail("expected MemoryUpdate")
  }
  match classify_intent("!ls") {
    HostEffect(command~) => assert_eq(command, "ls")
    _ => fail("expected HostEffect")
  }
  assert_eq(classify_intent("hi"), Chat)
  assert_eq(classify_intent("list connectors"), ConnectorsStatus)
  match classify_intent("claim inbox zoe") {
    ClaimInbox(local_part~) => assert_eq(local_part, "zoe")
    _ => fail("expected ClaimInbox")
  }
  match classify_intent("install plugin plugin-slides") {
    InstallPlugin(plugin_id~) => assert_eq(plugin_id, "plugin-slides")
    _ => fail("expected InstallPlugin")
  }
  assert_eq(classify_intent("setup slack"), SetupSlack)
}

///|
test "desktop_turn_install_plugin_and_setup_slack" {
  let p = run_desktop_turn("install plugin plugin-slides", turn_id="plug-1")
  assert_true(p.ok)
  assert_eq(p.intent, "install_plugin")
  assert_true(p.needs_host_ffi)
  assert_eq(p.effects[0].kind, "mcp_namespace")
  let s = run_desktop_turn("setup slack", turn_id="slack-1")
  assert_true(s.ok)
  assert_eq(s.intent, "setup_slack")
  assert_eq(s.effects[0].kind, "oauth")
}

///|
test "unescape_and_parse_host_continue_args" {
  assert_eq(unescape_host_arg("a\\nb"), "a\nb")
  let args = [
    "exe",
    "--apply-host-results",
    "--turn-id",
    "t1",
    "--prior-text",
    "shell echo",
    "--result-ok",
    "true",
    "--result-kind",
    "shell",
    "--result-command",
    "echo hi",
    "--result-stdout",
    "hi\\n",
    "--result-stderr",
    "",
    "--result-error",
    "",
  ]
  assert_true(args_want_host_continue(args))
  let (tid, prior, results) = parse_host_continue_args(args)
  assert_eq(tid, "t1")
  assert_eq(prior, "shell echo")
  assert_eq(results.length(), 1)
  assert_true(results[0].ok)
  assert_eq(results[0].stdout, "hi\n")
}
