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
}
