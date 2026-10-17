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
  // Default desktop Host context marks desk-1 Connected; android seed stays disconnected.
  let mut desk_ok = false
  let mut android_disc = false
  for m in r.machines {
    if m.kind == "desktop" && m.status == "connected" {
      desk_ok = true
    }
    if m.kind == "android" && m.status == "disconnected" {
      android_disc = true
    }
  }
  assert_true(desk_ok)
  assert_true(android_disc)
}

///|
test "desktop_turn_list_machines_android_host_present" {
  let ctx : DesktopTurnContext = {
    session_id: "s-android",
    machine_id: "phone-android",
    machine_kind: "android",
    channel: "",
    approved: false,
  }
  let r = run_desktop_turn("ListMachines", turn_id="lm-android", ctx~)
  assert_true(r.ok)
  assert_eq(r.intent, "list_machines")
  let mut android_ok = false
  for m in r.machines {
    if m.kind == "android" && m.id == "phone-android" && m.status == "connected" {
      android_ok = true
    }
  }
  assert_true(android_ok)
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
  let gated = run_desktop_turn("shell echo hi", turn_id="fx-gate")
  assert_true(gated.ok)
  assert_eq(gated.intent, "host_effect")
  assert_true(gated.needs_host_ffi)
  assert_eq(gated.effects[0].kind, "approval_card")
  let ctx : DesktopTurnContext = {
    session_id: "s",
    machine_id: "desk-1",
    machine_kind: "desktop",
    channel: "",
    approved: true,
  }
  let r = run_desktop_turn("shell echo hi", turn_id="fx-1", ctx~)
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
  let gated = run_desktop_turn(
    "reply via slack:C123 :: thanks from desktop",
    turn_id="ch-gate",
  )
  assert_true(gated.ok)
  assert_eq(gated.effects[0].kind, "approval_card")
  let ctx : DesktopTurnContext = {
    session_id: "s",
    machine_id: "desk-1",
    machine_kind: "desktop",
    channel: "",
    approved: true,
  }
  let r = run_desktop_turn(
    "reply via slack:C123 :: thanks from desktop",
    turn_id="ch-1",
    ctx~,
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
    approved: false,
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
  let gated = run_desktop_turn(
    "draft mail to=bob@example.com subject=Hi body=Hello Bob",
    turn_id="mail-gate",
  )
  assert_true(gated.ok)
  assert_eq(gated.effects[0].kind, "approval_card")
  let actx : DesktopTurnContext = {
    session_id: "s",
    machine_id: "desk-1",
    machine_kind: "desktop",
    channel: "",
    approved: true,
  }
  let d = run_desktop_turn(
    "draft mail to=bob@example.com subject=Hi body=Hello Bob",
    turn_id="mail-d",
    ctx=actx,
  )
  assert_true(d.ok)
  assert_eq(d.intent, "draft_mail")
  assert_eq(d.effects.length(), 1)
  assert_eq(d.effects[0].kind, "mail_send")
  assert_true(d.needs_host_ffi)
  assert_true(d.effects[0].command.has_prefix("gmail|"))
  let od = run_desktop_turn(
    "draft outlook mail to=bob@example.com subject=Hi body=Hello",
    turn_id="mail-outlook",
    ctx=actx,
  )
  assert_true(od.ok)
  assert_eq(od.intent, "draft_mail")
  assert_eq(od.effects[0].kind, "mail_send")
  assert_true(od.effects[0].command.has_prefix("outlook|"))
}

///|
test "desktop_turn_parity_routines_mcp_subagent_device" {
  let sec = run_desktop_turn(
    "add section group=g1 id=sec-a title=Alpha",
    turn_id="sec-1",
  )
  assert_true(sec.ok)
  assert_eq(sec.intent, "add_section")
  assert_eq(sec.effects[0].kind, "section_add")
  let sp = run_desktop_turn(
    "section post group=g1 section=sec-a from=asst-1 body=hello",
    turn_id="sec-2",
  )
  assert_true(sp.ok)
  assert_eq(sp.intent, "section_post")
  assert_eq(sp.effects[0].kind, "section_post")
  let wr = run_desktop_turn(
    "mcp call user-Gmail.write_result {\"body\":\"x\",\"filename\":\"t.txt\",\"write_to_file\":true}",
    turn_id="mcp-w",
  )
  assert_true(wr.ok)
  assert_eq(wr.intent, "mcp_call")
  assert_eq(wr.effects[0].kind, "mcp_call")
  assert_true(wr.effects[0].command.contains("write_result"))
  let lc = run_desktop_turn("list credentials", turn_id="cred-list")
  assert_true(lc.ok)
  assert_eq(lc.intent, "list_credentials")
  assert_eq(lc.effects[0].kind, "credential_list")
  let cr = run_desktop_turn(
    "create routine id=r1 cron=@daily prompt=standup notes",
    turn_id="rt-1",
  )
  assert_true(cr.ok)
  assert_eq(cr.intent, "create_routine")
  assert_eq(cr.effects[0].kind, "routine_schedule")
  let md = run_desktop_turn("mcp discover user-Gmail", turn_id="mcp-d")
  assert_true(md.ok)
  assert_eq(md.intent, "mcp_discover")
  let mc = run_desktop_turn(
    "mcp call user-Gmail.search_threads {}",
    turn_id="mcp-c",
  )
  assert_true(mc.ok)
  assert_eq(mc.intent, "mcp_call")
  let sa = run_desktop_turn("spawn subagent summarize inbox", turn_id="sa-1")
  assert_true(sa.ok)
  assert_eq(sa.intent, "spawn_subagent")
  let cu = run_desktop_turn("computer use open docs site", turn_id="cu-1")
  assert_true(cu.ok)
  assert_eq(cu.intent, "computer_use")
  let ictx : DesktopTurnContext = {
    session_id: "s",
    machine_id: "phone-ios",
    machine_kind: "ios",
    channel: "",
    approved: false,
  }
  let dt = run_desktop_turn("device tools", turn_id="dt-1", ctx=ictx)
  assert_true(dt.ok)
  assert_eq(dt.intent, "device_tools")
  assert_true(dt.messages[dt.messages.length() - 1].text.contains("camera"))
  assert_true(dt.needs_host_ffi)
  assert_eq(dt.effects[0].kind, "device_tools_list")
  assert_true(dt.effects[0].command.contains("phone-ios"))
  let ls = run_desktop_turn("load skill slides presentation", turn_id="sk-1")
  assert_true(ls.ok)
  assert_eq(ls.intent, "load_skill")
  let vs = run_desktop_turn("voice start call42", turn_id="v-1")
  assert_true(vs.ok)
  assert_eq(vs.intent, "voice_start")
  assert_true(vs.channel_delivery.contains("voice:call42"))
  let ve = run_desktop_turn("voice end call42", turn_id="v-e")
  assert_true(ve.ok)
  assert_eq(ve.intent, "voice_end")
  assert_eq(ve.effects[0].kind, "voice_end_write")
  let tm = run_desktop_turn(
    "create teammate id=asst-alpha name=Alpha role=researcher",
    turn_id="tm-1",
  )
  assert_true(tm.ok)
  assert_eq(tm.intent, "create_teammate")
  let rm = run_desktop_turn("room eng :: ship the build", turn_id="rm-1")
  assert_true(rm.ok)
  assert_eq(rm.intent, "room_turn")
  let sa2 = run_desktop_turn(
    "send to agent asst-alpha :: please review",
    turn_id="sta-1",
  )
  assert_true(sa2.ok)
  assert_eq(sa2.intent, "send_to_agent")
  let ca = run_desktop_turn(
    "launch cloud agent refactor auth module",
    turn_id="ca-1",
  )
  assert_true(ca.ok)
  assert_eq(ca.intent, "launch_cloud_agent")
  assert_eq(ca.effects[0].kind, "cloud_agent_launch")
  let art = run_desktop_turn(
    "deliver cloud artifact artifact=bc-smoke dest=report.md",
    turn_id="art-1",
  )
  assert_true(art.ok)
  assert_eq(art.intent, "deliver_cloud_artifact")
  let sm = run_desktop_turn(
    "schedule meeting title=Sprint when=tomorrow-3pm",
    turn_id="sm-1",
  )
  assert_true(sm.ok)
  assert_eq(sm.intent, "schedule_meeting")
  assert_true(sm.needs_host_ffi)
  let shop = run_desktop_turn("shop target.com headphones", turn_id="shop-1")
  assert_true(shop.ok)
  assert_eq(shop.intent, "shop_retail")
  assert_eq(shop.effects[0].kind, "computer_use")
  let buy = run_desktop_turn(
    "purchase item=BlueYeti cents=12900",
    turn_id="buy-1",
  )
  assert_true(buy.ok)
  assert_eq(buy.intent, "purchase_item")
  assert_true(buy.needs_host_ffi)
  let buy_ok = run_desktop_turn(
    "purchase item=BlueYeti cents=12900",
    turn_id="buy-2",
    ctx={
      session_id: "s",
      machine_id: "desk-1",
      machine_kind: "desktop",
      channel: "",
      approved: true,
    },
  )
  assert_true(buy_ok.ok)
  assert_eq(buy_ok.intent, "purchase_item")
  assert_eq(buy_ok.effects[0].kind, "purchase")
  let tr = run_desktop_turn("book flight google.com/flights", turn_id="tr-1")
  assert_true(tr.ok)
  assert_eq(tr.intent, "travel_book")
  let fo = run_desktop_turn("order food doordash.com", turn_id="fo-1")
  assert_true(fo.ok)
  assert_eq(fo.intent, "order_food")
  let mc = run_desktop_turn(
    "meeting chat body=stand-up update direct=1",
    turn_id="mc-1",
  )
  assert_true(mc.ok)
  assert_eq(mc.intent, "meeting_chat")
  let fc = run_desktop_turn("connect finance", turn_id="fin-1")
  assert_true(fc.ok)
  assert_eq(fc.intent, "finance_connect")
  let fcall = run_desktop_turn("finance get_balance", turn_id="fin-2")
  assert_true(fcall.ok)
  assert_eq(fcall.intent, "finance_call")
  let fill = run_desktop_turn(
    "fill credential domain=login.example.test",
    turn_id="cred-1",
  )
  assert_true(fill.ok)
  assert_eq(fill.intent, "fill_credential")
  let cold = run_desktop_turn(
    "cold mail to=a@example.com subject=Hi body=Hello unsubscribe=mailto:u@example.com",
    turn_id="cold-1",
  )
  assert_true(cold.ok)
  assert_eq(cold.intent, "cold_mail")
  let ps = run_desktop_turn(
    "personal slack dm owner=Uowner text=ping",
    turn_id="ps-1",
  )
  assert_true(ps.ok)
  assert_eq(ps.intent, "personal_slack_dm")
  let js = run_desktop_turn("job search engineer", turn_id="js-1")
  assert_true(js.ok)
  assert_eq(js.intent, "job_search")
  assert_true(js.needs_host_ffi)
  assert_true(js.effects.length() >= 2)
  assert_eq(js.effects[0].kind, "computer_use")
  assert_eq(js.effects[1].kind, "job_search")
  let lfd = run_desktop_turn(
    "learn from demo title=Checkout steps=click:Cart|type:email",
    turn_id="lfd-1",
  )
  assert_true(lfd.ok)
  assert_eq(lfd.intent, "learn_from_demo")
  let slides = run_desktop_turn("make slides Q3 Review", turn_id="sl-1")
  assert_true(slides.ok)
  assert_eq(slides.intent, "make_slides")
  let cc = run_desktop_turn("code changes README.mbt.md", turn_id="cc-1")
  assert_true(cc.ok)
  assert_eq(cc.intent, "code_changes")
  let sc = run_desktop_turn("source control github", turn_id="sc-1")
  assert_true(sc.ok)
  assert_eq(sc.intent, "source_control")
  let sob = run_desktop_turn(
    "send on behalf to=a@example.com subject=Hi body=Hello",
    turn_id="sob-1",
  )
  assert_true(sob.ok)
  assert_eq(sob.intent, "send_on_behalf")
  let lw = run_desktop_turn("list workflows", turn_id="lw-1")
  assert_true(lw.ok)
  assert_eq(lw.intent, "list_workflows")
  assert_true(lw.needs_host_ffi)
  assert_eq(lw.effects[0].kind, "workflow_list")
  let ib = run_desktop_turn("identity browser", turn_id="ib-1")
  assert_true(ib.ok)
  assert_eq(ib.intent, "identity_browser")
  let xs = run_desktop_turn("x search moonbit", turn_id="xs-1")
  assert_true(xs.ok)
  assert_eq(xs.intent, "x_search")
  assert_true(xs.needs_host_ffi)
  assert_eq(xs.effects[0].kind, "x_search")
  let as_ = run_desktop_turn(
    "author skill name=demo-skill description=demo body=Do the thing.",
    turn_id="as-1",
  )
  assert_true(as_.ok)
  assert_eq(as_.intent, "author_skill")
  let ex = run_desktop_turn(
    "export bot template id=bot-smoke name=SmokeBot",
    turn_id="ex-1",
  )
  assert_true(ex.ok)
  assert_eq(ex.intent, "export_bot_template")
  let cam = run_desktop_turn(
    "device tool camera",
    turn_id="cam-1",
    ctx={
      session_id: "s",
      machine_id: "desk-1",
      machine_kind: "ios",
      channel: "",
      approved: false,
    },
  )
  assert_true(cam.ok)
  assert_eq(cam.intent, "device_tool_invoke")
  assert_eq(cam.effects[0].kind, "device_permission")
  let sm = run_desktop_turn("search mail Invoice", turn_id="sm-mail")
  assert_true(sm.ok)
  assert_eq(sm.intent, "search_mail")
  assert_eq(sm.effects[0].kind, "mail_search")
  let rm = run_desktop_turn("read mail t-invoice-1", turn_id="rm-1")
  assert_true(rm.ok)
  assert_eq(rm.intent, "read_mail_thread")
  let pr = run_desktop_turn("pause routine smoke-r", turn_id="pr-1")
  assert_true(pr.ok)
  assert_eq(pr.intent, "pause_routine")
  let rr = run_desktop_turn("resume routine smoke-r", turn_id="rr-1")
  assert_true(rr.ok)
  assert_eq(rr.intent, "resume_routine")
  let fr = run_desktop_turn("fire routine smoke-r", turn_id="fr-1")
  assert_true(fr.ok)
  assert_eq(fr.intent, "fire_routine")
  let cg = run_desktop_turn("connect gmail", turn_id="cg-1")
  assert_true(cg.ok)
  assert_eq(cg.intent, "connect_gmail")
  assert_eq(cg.effects[0].kind, "oauth")
  let ja = run_desktop_turn(
    "journal date=2026-10-17 id=e1 body=hello journal",
    turn_id="ja-1",
  )
  assert_true(ja.ok)
  assert_eq(ja.intent, "journal_append")
  let jq = run_desktop_turn(
    "query journal from=2026-10-01 to=2026-10-31",
    turn_id="jq-1",
  )
  assert_true(jq.ok)
  assert_eq(jq.intent, "journal_query")
  let sp = run_desktop_turn(
    "shared memory put scope=team key=k value=v",
    turn_id="sp-1",
  )
  assert_true(sp.ok)
  assert_eq(sp.intent, "shared_memory_put")
  let ir = run_desktop_turn("[inbound] reaction :+1:", turn_id="ir-1")
  assert_true(ir.ok)
  assert_eq(ir.intent, "inbound_reaction")
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
