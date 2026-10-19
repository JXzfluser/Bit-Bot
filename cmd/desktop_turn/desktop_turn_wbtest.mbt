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
  // Product Chat plans Host llm_chat (DeepSeek / BITBOT_LLM_*), not a canned reply.
  assert_true(r.needs_host_ffi)
  assert_eq(r.effects.length(), 1)
  assert_eq(r.effects[0].kind, "llm_chat")
  assert_eq(r.effects[0].command, "hello from desktop")
  let json = r.to_json_line()
  assert_true(json.contains("\"v\":1"))
  assert_true(json.contains("\"ok\":true"))
  assert_true(json.contains("\"turn_id\":\"dt-test\""))
  assert_true(json.contains("hello from desktop"))
  assert_true(json.contains("\"modules\":["))
  assert_true(json.contains("runtime"))
  assert_true(json.contains("\"machines\":[]"))
  assert_true(json.contains("\"needs_host_ffi\":true"))
  assert_true(json.contains("\"llm_chat\""))
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
  // Default desktop Host marks only desk-1 Connected; ios/android stay disconnected.
  assert_true(r.needs_host_ffi)
  assert_eq(r.effects[0].kind, "machines_list")
  let mut desk_ok = false
  let mut android_disc = false
  let mut ios_disc = false
  for m in r.machines {
    if m.kind == "desktop" && m.status == "connected" {
      desk_ok = true
    }
    if m.kind == "android" && m.status == "disconnected" {
      android_disc = true
    }
    if m.kind == "ios" && m.status == "disconnected" {
      ios_disc = true
    }
  }
  assert_true(desk_ok)
  assert_true(android_disc)
  assert_true(ios_disc)
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
  assert_true(u.needs_host_ffi)
  assert_eq(u.effects[0].kind, "memory_update")
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
  let seeds : Array[(String, String)] = [
    ("favorite_color", "blue"),
    ("city", "SF"),
  ]
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
  let args = [
    "exe", "--seed-memory", "a=1", "--seed-memory", "b=2", "recall", "a",
  ]
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
  assert_true(
    r.messages[r.messages.length() - 1].text.contains("Connectors status"),
  )
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
  let w = run_desktop_turn("webfetch https://example.com", turn_id="wf-1", ctx~)
  assert_true(w.ok)
  assert_eq(w.intent, "webfetch")
  assert_eq(w.effects[0].command, "https://example.com")
  let args = [
    "exe", "--machine-kind", "android", "--session-id", "s2", "--channel", "email:a@b",
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
  assert_true(c.needs_host_ffi)
  assert_eq(c.effects[0].kind, "mail_claim_inbox")
  assert_true(c.effects[0].command.contains("alpha"))
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
  assert_true(ls.needs_host_ffi)
  assert_eq(ls.effects[0].kind, "skill_load")
  assert_true(ls.effects[0].command.contains("slides"))
  let lsk = run_desktop_turn("list skills", turn_id="lsk-1")
  assert_true(lsk.ok)
  assert_eq(lsk.intent, "list_skills")
  assert_eq(lsk.effects[0].kind, "list_skills")
  let xp = run_desktop_turn("x post Bit Bot desktop draft", turn_id="xp-1")
  assert_true(xp.ok)
  assert_eq(xp.intent, "x_post")
  assert_eq(xp.effects[0].kind, "x_post")
  let op = run_desktop_turn("open plugins", turn_id="op-1")
  assert_true(op.ok)
  assert_eq(op.intent, "list_plugins")
  let pin = run_desktop_turn("pin agent asst-1", turn_id="pin-1")
  assert_true(pin.ok)
  assert_eq(pin.intent, "hide_agent")
  let brow = run_desktop_turn(
    "browser open https://example.com",
    turn_id="brow-1",
  )
  assert_true(brow.ok)
  assert_eq(brow.intent, "webfetch")
  let vault = run_desktop_turn("vault list", turn_id="vault-1")
  assert_true(vault.ok)
  assert_eq(vault.intent, "list_credentials")
  let clip = run_desktop_turn("clipboard read", turn_id="clip-1")
  assert_true(clip.ok)
  assert_eq(clip.intent, "device_tool_invoke")
  let note = run_desktop_turn("note create hello world", turn_id="note-1")
  assert_true(note.ok)
  assert_eq(note.intent, "journal_append")
  let cal = run_desktop_turn("list calendar", turn_id="cal-1")
  assert_true(cal.ok)
  assert_eq(cal.intent, "schedule_meeting")
  let expdf = run_desktop_turn("export pdf", turn_id="expdf-1")
  assert_true(expdf.ok)
  assert_eq(expdf.intent, "export_bot_template")
  let jq = run_desktop_turn("journal query", turn_id="jq-bare-1")
  assert_true(jq.ok)
  assert_eq(jq.intent, "journal_query")
  let att = run_desktop_turn("attach file README.mbt.md", turn_id="att-1")
  assert_true(att.ok)
  assert_eq(att.intent, "copy_to_box")
  assert_eq(att.effects[0].kind, "copy_to_box")
  let dl = run_desktop_turn("download file README.mbt.md", turn_id="dl-1")
  assert_true(dl.ok)
  assert_eq(dl.intent, "copy_from_box")
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
  let rm_post = run_desktop_turn(
    "post to room eng :: ship from product phrasing",
    turn_id="rm-post-1",
  )
  assert_true(rm_post.ok)
  assert_eq(rm_post.intent, "room_turn")
  let rm_msg = run_desktop_turn(
    "message room eng hello teammates",
    turn_id="rm-msg-1",
  )
  assert_true(rm_msg.ok)
  assert_eq(rm_msg.intent, "room_turn")
  let rm_colon = run_desktop_turn("room eng: colon body", turn_id="rm-colon-1")
  assert_true(rm_colon.ok)
  assert_eq(rm_colon.intent, "room_turn")
  let rm_turn = run_desktop_turn(
    "room turn eng :: alias body",
    turn_id="rm-turn-1",
  )
  assert_true(rm_turn.ok)
  assert_eq(rm_turn.intent, "room_turn")
  let rm_join = run_desktop_turn("join room eng", turn_id="rm-join-1")
  assert_true(rm_join.ok)
  assert_eq(rm_join.intent, "room_turn")
  let rm_leave = run_desktop_turn("leave room eng", turn_id="rm-leave-1")
  assert_true(rm_leave.ok)
  assert_eq(rm_leave.intent, "room_turn")
  let mem_list = run_desktop_turn("list members", turn_id="mem-list-1")
  assert_true(mem_list.ok)
  assert_eq(mem_list.intent, "members_panel")
  let mem_invite = run_desktop_turn("invite user alice", turn_id="mem-inv-1")
  assert_true(mem_invite.ok)
  assert_eq(mem_invite.intent, "members_panel")
  let mem_kick = run_desktop_turn("kick user bob", turn_id="mem-kick-1")
  assert_true(mem_kick.ok)
  assert_eq(mem_kick.intent, "members_panel")
  let ch_list = run_desktop_turn("list channels", turn_id="ch-list-1")
  assert_true(ch_list.ok)
  assert_eq(ch_list.intent, "channel_delivery")
  let ch_create = run_desktop_turn(
    "create channel sales",
    turn_id="ch-create-1",
  )
  assert_true(ch_create.ok)
  assert_eq(ch_create.intent, "channel_delivery")
  let hd_start = run_desktop_turn("start huddle", turn_id="hd-start-1")
  assert_true(hd_start.ok)
  assert_eq(hd_start.intent, "voice_start")
  let hd_end = run_desktop_turn("end huddle", turn_id="hd-end-1")
  assert_true(hd_end.ok)
  assert_eq(hd_end.intent, "voice_end")
  let st_away = run_desktop_turn("set status away", turn_id="st-away-1")
  assert_true(st_away.ok)
  assert_eq(st_away.intent, "set_notify")
  let cv_open = run_desktop_turn("open canvas", turn_id="cv-open-1")
  assert_true(cv_open.ok)
  assert_eq(cv_open.intent, "make_slides")
  let md_list = run_desktop_turn("list models", turn_id="md-list-1")
  assert_true(md_list.ok)
  assert_eq(md_list.intent, "open_settings")
  assert_true(md_list.needs_host_ffi)
  assert_eq(md_list.effects[0].kind, "llm_list_models")
  let md_switch = run_desktop_turn("switch model deepseek", turn_id="md-sw-1")
  assert_true(md_switch.ok)
  assert_eq(md_switch.intent, "open_settings")
  assert_eq(md_switch.effects[0].kind, "llm_set_model")
  assert_eq(md_switch.effects[0].command, "deepseek")
  let blk = run_desktop_turn("block user alice", turn_id="blk-1")
  assert_true(blk.ok)
  assert_eq(blk.intent, "members_panel")
  let focus = run_desktop_turn("focus mode on", turn_id="focus-1")
  assert_true(focus.ok)
  assert_eq(focus.intent, "set_notify")
  let todo_w = run_desktop_turn("todo write buy milk", turn_id="todo-w-1")
  assert_true(todo_w.ok)
  assert_eq(todo_w.intent, "todo_write")
  assert_eq(todo_w.effects[0].kind, "todo_write")
  let todo_list = run_desktop_turn("list todos", turn_id="todo-l-1")
  assert_true(todo_list.ok)
  assert_eq(todo_list.intent, "todo_write")
  let claim_bare = run_desktop_turn("claim inbox", turn_id="claim-bare-1")
  assert_true(claim_bare.ok)
  assert_eq(claim_bare.intent, "claim_inbox")
  let thr = run_desktop_turn("open thread", turn_id="thr-1")
  assert_true(thr.ok)
  assert_eq(thr.intent, "channel_delivery")
  let ss = run_desktop_turn("start screen share", turn_id="ss-1")
  assert_true(ss.ok)
  assert_eq(ss.intent, "screenshot")
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
  let jq = run_desktop_turn(
    "journal query from=2020-01-01 to=2099-12-31",
    turn_id="jq-1",
  )
  assert_true(jq.ok)
  assert_eq(jq.intent, "journal_query")
  assert_true(jq.needs_host_ffi)
  assert_eq(jq.effects[0].kind, "journal_query")
  let ts = run_desktop_turn(
    "teams send Tsmoke :: hello host chat",
    turn_id="ts-1",
    ctx={
      session_id: "s",
      machine_id: "desk-1",
      machine_kind: "desktop",
      channel: "",
      approved: true,
    },
  )
  assert_true(ts.ok)
  assert_eq(ts.intent, "teams_send")
  assert_eq(ts.effects[0].kind, "channel_send")
  assert_true(ts.effects[0].command.has_prefix("teams:Tsmoke"))
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
  let gi = run_desktop_turn("generate image parity aurora", turn_id="gi-1")
  assert_true(gi.ok)
  assert_eq(gi.intent, "generate_image")
  assert_true(gi.needs_host_ffi)
  assert_eq(gi.effects[0].kind, "generate_image")
  let gv = run_desktop_turn("generate video parity clip", turn_id="gv-1")
  assert_true(gv.ok)
  assert_eq(gv.intent, "generate_video")
  assert_eq(gv.effects[0].kind, "generate_video")
  let wv = run_desktop_turn(
    "watch video agent-tools/gen-video-gv-1.mp4",
    turn_id="wv-1",
  )
  assert_true(wv.ok)
  assert_eq(wv.intent, "watch_video")
  assert_eq(wv.effects[0].kind, "watch_video")
  let sc_chart = run_desktop_turn(
    "structured chart {\"alpha\":4,\"beta\":9,\"gamma\":6}",
    turn_id="sc2157-1",
  )
  assert_true(sc_chart.ok)
  assert_eq(sc_chart.intent, "structured_chart")
  assert_true(sc_chart.needs_host_ffi)
  assert_eq(sc_chart.effects[0].kind, "structured_chart")
  let bd = run_desktop_turn("box doctor", turn_id="bd-1")
  assert_true(bd.ok)
  assert_eq(bd.intent, "box_doctor")
  assert_true(bd.needs_host_ffi)
  assert_eq(bd.effects[0].kind, "box_doctor")
  let be = run_desktop_turn("box env", turn_id="be-1")
  assert_true(be.ok)
  assert_eq(be.intent, "box_env")
  assert_eq(be.effects[0].kind, "box_env")
  let bc = run_desktop_turn("box clock", turn_id="bc-1")
  assert_true(bc.ok)
  assert_eq(bc.intent, "box_clock")
  assert_eq(bc.effects[0].kind, "box_clock")
  let wh = run_desktop_turn("open webhook panel", turn_id="wh-1")
  assert_true(wh.ok)
  assert_eq(wh.intent, "webhook_panel")
  assert_eq(wh.effects[0].kind, "webhook_panel")
  let whc = run_desktop_turn("copy webhook url", turn_id="whc-1")
  assert_true(whc.ok)
  assert_eq(whc.intent, "webhook_copy")
  assert_eq(whc.effects[0].kind, "webhook_copy")
  let whk = run_desktop_turn("tool-read webhook key", turn_id="whk-1")
  assert_true(whk.ok)
  assert_eq(whk.intent, "webhook_tool_read_key")
  let whw = run_desktop_turn(
    "webhook wake id=evt-9 summary=POST /hooks received",
    turn_id="whw-1",
  )
  assert_true(whw.ok)
  assert_eq(whw.intent, "webhook_wake")
  assert_eq(whw.effects[0].kind, "webhook_wake")
  let st = run_desktop_turn("open settings", turn_id="st-1")
  assert_true(st.ok)
  assert_eq(st.intent, "open_settings")
  assert_eq(st.effects[0].kind, "settings_open")
  let sta = run_desktop_turn(
    "open settings entry=command-palette anchor=theme",
    turn_id="sta-1",
  )
  assert_true(sta.ok)
  assert_eq(sta.intent, "open_settings")
  assert_true(sta.effects[0].command.contains("theme"))
  let aip = run_desktop_turn("open agent info agent=agent-bit", turn_id="aip-1")
  assert_true(aip.ok)
  assert_eq(aip.intent, "open_agent_info_panel")
  assert_eq(aip.effects[0].kind, "agent_info_panel")
  let da = run_desktop_turn("delete agent agent-bit", turn_id="da-1")
  assert_true(da.ok)
  assert_eq(da.intent, "delete_agent")
  assert_eq(da.effects[0].kind, "delete_agent")
  assert_true(da.effects[0].command.contains("confirm=0"))
  let dac = run_desktop_turn("confirm delete agent agent-bit", turn_id="dac-1")
  assert_true(dac.ok)
  assert_eq(dac.intent, "delete_agent")
  assert_true(dac.effects[0].command.contains("confirm=1"))
  let pkg = run_desktop_turn(
    "install package npm left-pad@1.3.0",
    turn_id="pkg-1",
  )
  assert_true(pkg.ok)
  assert_eq(pkg.intent, "package_install")
  assert_eq(pkg.effects[0].kind, "package_install")
  assert_true(pkg.effects[0].command.contains("via=shell"))
  let pkgr = run_desktop_turn(
    "install package via=direct-apt-api pm=apt pkgs=curl",
    turn_id="pkgr-1",
  )
  assert_true(pkgr.ok)
  assert_eq(pkgr.intent, "package_install")
  assert_true(pkgr.effects[0].command.contains("via=direct-apt-api"))
  let sbfs = run_desktop_turn("shared box fs", turn_id="sbfs-1")
  assert_true(sbfs.ok)
  assert_eq(sbfs.intent, "shared_box_fs")
  assert_eq(sbfs.effects[0].kind, "shared_box_fs")
  let hide = run_desktop_turn("hide agent research", turn_id="hide-1")
  assert_true(hide.ok)
  assert_eq(hide.intent, "hide_agent")
  assert_eq(hide.effects[0].kind, "hide_agent")
  let las = run_desktop_turn("list agents", turn_id="las-1")
  assert_true(las.ok)
  assert_eq(las.intent, "list_agents_sidebar")
  let mp = run_desktop_turn("open members group=group-1", turn_id="mp-1")
  assert_true(mp.ok)
  assert_eq(mp.intent, "members_panel")
  assert_eq(mp.effects[0].kind, "members_panel")
  let ns = run_desktop_turn(
    "notify settings assistant=asst-alpha",
    turn_id="ns-1",
  )
  assert_true(ns.ok)
  assert_eq(ns.intent, "notify_settings")
  let sn = run_desktop_turn(
    "set notify assistant=asst-alpha toggle=sound enabled=0",
    turn_id="sn-1",
  )
  assert_true(sn.ok)
  assert_eq(sn.intent, "set_notify")
  let uc = run_desktop_turn("update computer", turn_id="uc-1")
  assert_true(uc.ok)
  assert_eq(uc.intent, "update_computer")
  let rc = run_desktop_turn("reset computer", turn_id="rc-1")
  assert_true(rc.ok)
  assert_eq(rc.intent, "reset_computer")
  let le = run_desktop_turn("local execution off", turn_id="le-1")
  assert_true(le.ok)
  assert_eq(le.intent, "local_execution")
  let gp = run_desktop_turn(
    "guide permission kind=needs-auth ns=user-Gmail",
    turn_id="gp-1",
  )
  assert_true(gp.ok)
  assert_eq(gp.intent, "guide_permission")
  let md = run_desktop_turn(
    "render markdown Inline \\(E=mc^2\\) and $$a^2+b^2=c^2$$ ```mermaid\ngraph TD\n  A-->B\n```",
    turn_id="md-1",
  )
  assert_true(md.ok)
  assert_eq(md.intent, "render_markdown")
  assert_eq(md.effects[0].kind, "render_markdown")
  let rm = run_desktop_turn(
    "react message msg=msg-1 emoji=👍",
    turn_id="rm-1",
  )
  assert_true(rm.ok)
  assert_eq(rm.intent, "react_message")
  assert_eq(rm.effects[0].kind, "react_message")
  let shot = run_desktop_turn("screenshot", turn_id="shot-1")
  assert_true(shot.ok)
  assert_eq(shot.intent, "screenshot")
  assert_eq(shot.effects[0].kind, "screenshot")
  let cup = run_desktop_turn("check updates", turn_id="cup-1")
  assert_true(cup.ok)
  assert_eq(cup.intent, "check_updates")
  assert_eq(cup.effects[0].kind, "check_updates")
  let ars = run_desktop_turn("auto review settings", turn_id="ars-1")
  assert_true(ars.ok)
  assert_eq(ars.intent, "auto_review_settings")
  assert_eq(ars.effects[0].kind, "auto_review_settings")
  let bcp = run_desktop_turn("box chrome probe", turn_id="bcp-1")
  assert_true(bcp.ok)
  assert_eq(bcp.intent, "box_chrome_probe")
  assert_eq(bcp.effects[0].kind, "box_chrome_probe")
  assert_eq(bcp.effects[0].command, "probe")
  let bare = run_desktop_turn("launch bare chrome", turn_id="bare-1")
  assert_true(bare.ok)
  assert_eq(bare.intent, "box_chrome_probe")
  assert_eq(bare.effects[0].command, "bare=1")
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
  let cam = run_desktop_turn("device tool camera", turn_id="cam-1", ctx={
    session_id: "s",
    machine_id: "desk-1",
    machine_kind: "ios",
    channel: "",
    approved: false,
  })
  assert_true(cam.ok)
  assert_eq(cam.intent, "device_tool_invoke")
  assert_eq(cam.effects[0].kind, "device_permission")
  let take_photo = run_desktop_turn("take photo", turn_id="cam-photo-1", ctx={
    session_id: "s",
    machine_id: "desk-1",
    machine_kind: "ios",
    channel: "",
    approved: false,
  })
  assert_true(take_photo.ok)
  assert_eq(take_photo.intent, "device_tool_invoke")
  assert_eq(take_photo.effects[0].kind, "device_permission")
  let rem = run_desktop_turn(
    "create reminder id=desk-rem cron=@daily prompt=ping",
    turn_id="rem-1",
  )
  assert_true(rem.ok)
  assert_eq(rem.intent, "create_routine")
  assert_eq(rem.effects[0].kind, "routine_schedule")
  let ver = run_desktop_turn("version info", turn_id="ver-1")
  assert_true(ver.ok)
  assert_eq(ver.intent, "check_updates")
  let mute = run_desktop_turn("mute channel", turn_id="mute-1")
  assert_true(mute.ok)
  assert_eq(mute.intent, "set_notify")
  let theme = run_desktop_turn("toggle theme", turn_id="theme-1")
  assert_true(theme.ok)
  assert_eq(theme.intent, "open_settings")
  let term = run_desktop_turn("open terminal", turn_id="term-1")
  assert_true(term.ok)
  assert_eq(term.intent, "host_effect")
  let share = run_desktop_turn("share screen", turn_id="share-1")
  assert_true(share.ok)
  assert_eq(share.intent, "screenshot")
  let ping = run_desktop_turn("ping host", turn_id="ping-1")
  assert_true(ping.ok)
  assert_eq(ping.intent, "box_doctor")
  let sched = run_desktop_turn("list scheduled", turn_id="sched-1")
  assert_true(sched.ok)
  assert_eq(sched.intent, "list_routines")
  let receipts = run_desktop_turn("read receipts", turn_id="rr-1")
  assert_true(receipts.ok)
  assert_eq(receipts.intent, "set_notify")
  let edit_msg = run_desktop_turn("edit message", turn_id="em-1")
  assert_true(edit_msg.ok)
  assert_eq(edit_msg.intent, "channel_delivery")
  let canvas = run_desktop_turn("create canvas page", turn_id="cv-1")
  assert_true(canvas.ok)
  assert_eq(canvas.intent, "make_slides")
  let disc = run_desktop_turn("disconnect slack", turn_id="ds-1")
  assert_true(disc.ok)
  assert_eq(disc.intent, "setup_slack")
  let react = run_desktop_turn("react message", turn_id="rx-1")
  assert_true(react.ok)
  assert_eq(react.intent, "react_message")
  let pin = run_desktop_turn("pin message", turn_id="pin-1")
  assert_true(pin.ok)
  assert_eq(pin.intent, "react_message")
  let clear = run_desktop_turn("clear chat", turn_id="cc-1")
  assert_true(clear.ok)
  assert_eq(clear.intent, "hide_agent")
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
  let chat_plan = run_desktop_turn("hi", turn_id="chat-llm-1")
  assert_true(chat_plan.ok)
  assert_eq(chat_plan.intent, "chat")
  assert_true(chat_plan.needs_host_ffi)
  assert_eq(chat_plan.effects.length(), 1)
  assert_eq(chat_plan.effects[0].kind, "llm_chat")
  assert_eq(chat_plan.effects[0].command, "hi")
  assert_true(
    chat_plan.messages[chat_plan.messages.length() - 1].text.contains(
      "llm_chat",
    ),
  )
  let llm_results : Array[DesktopHostResult] = [
    {
      kind: "llm_chat",
      ok: true,
      command: "hi",
      stdout: "你好，我是 Bit Bot。",
      stderr: "",
      error: "",
    },
  ]
  let llm_cont = continue_after_host_ffi(
    turn_id="chat-llm-cont",
    prior_user_text="hi",
    llm_results,
  )
  assert_true(llm_cont.ok)
  assert_true(llm_cont.host_continued)
  let llm_last = llm_cont.messages[llm_cont.messages.length() - 1].text
  assert_eq(llm_last, "你好，我是 Bit Bot。")
  assert_false(llm_last.contains("Host FFI results applied"))
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
  assert_true(p.effects[0].command.contains("plugin-slides"))
  assert_true(p.effects[0].command.contains("user-Slides"))
  let u = run_desktop_turn("uninstall plugin plugin-slides", turn_id="unplug-1")
  assert_true(u.ok)
  assert_eq(u.intent, "uninstall_plugin")
  assert_eq(u.effects[0].kind, "mcp_uninstall")
  assert_true(u.effects[0].command.contains("plugin-slides"))
  assert_true(u.effects[0].command.contains("user-Slides"))
  let gp = run_desktop_turn("get plugin plugin-slides", turn_id="gp-1")
  assert_true(gp.ok)
  assert_eq(gp.intent, "get_plugin")
  assert_eq(gp.effects[0].kind, "mcp_get_plugin")
  let lp = run_desktop_turn("list plugins slides", turn_id="lp-1")
  assert_true(lp.ok)
  assert_eq(lp.intent, "list_plugins")
  assert_eq(lp.effects[0].kind, "mcp_list_plugins")
  let s = run_desktop_turn("setup slack", turn_id="slack-1")
  assert_true(s.ok)
  assert_eq(s.intent, "setup_slack")
  assert_eq(s.effects[0].kind, "oauth")
}

///|
test "unescape_and_parse_host_continue_args" {
  assert_eq(unescape_host_arg("a\\nb"), "a\nb")
  let args = [
    "exe", "--apply-host-results", "--turn-id", "t1", "--prior-text", "shell echo",
    "--result-ok", "true", "--result-kind", "shell", "--result-command", "echo hi",
    "--result-stdout", "hi\\n", "--result-stderr", "", "--result-error", "",
  ]
  assert_true(args_want_host_continue(args))
  let (tid, prior, results) = parse_host_continue_args(args)
  assert_eq(tid, "t1")
  assert_eq(prior, "shell echo")
  assert_eq(results.length(), 1)
  assert_true(results[0].ok)
  assert_eq(results[0].stdout, "hi\n")
}

///|
/// Wave G (Grok desktop parity): phrase → intent → effect kind contracts
/// pinned per docs/grok-desktop-parity/ipc-contract.md §1.
test "desktop_turn_wave_g_bot_lifecycle_kinds" {
  let r1 = run_desktop_turn(
    "create bot Piper job=scout description=Watch+the+market",
    turn_id="wg-1",
  )
  assert_true(r1.ok)
  assert_eq(r1.intent, "create_bot")
  assert_eq(r1.effects.length(), 1)
  assert_eq(r1.effects[0].kind, "bot_create")
  assert_eq(
    r1.effects[0].command,
    "name=Piper job=scout description=Watch+the+market",
  )

  let r2 = run_desktop_turn(
    "update bot bot-1 name=Piper+Jr job=Perf description=Keep+voice",
    turn_id="wg-2",
  )
  assert_eq(r2.intent, "update_bot")
  assert_eq(r2.effects[0].kind, "bot_update")
  assert_true(r2.effects[0].command.contains("bot=bot-1"))

  let r3 = run_desktop_turn("duplicate bot bot-1", turn_id="wg-3")
  assert_eq(r3.intent, "duplicate_bot")
  assert_eq(r3.effects[0].kind, "bot_duplicate")

  let r4 = run_desktop_turn("pin bot bot-1", turn_id="wg-4")
  assert_eq(r4.effects[0].command, "bot=bot-1 pinned=1")
  let r5 = run_desktop_turn("unpin bot bot-1", turn_id="wg-5")
  assert_eq(r5.effects[0].command, "bot=bot-1 pinned=0")

  let r6 = run_desktop_turn("set primary bot bot-1", turn_id="wg-6")
  assert_eq(r6.effects[0].kind, "bot_set_primary")

  let r7 = run_desktop_turn("hide bot bot-1", turn_id="wg-7")
  assert_eq(r7.intent, "hide_bot")
  assert_eq(r7.effects[0].kind, "bot_hide")
  assert_eq(r7.effects[0].command, "bot=bot-1")

  let r8 = run_desktop_turn("unhide bot bot-1", turn_id="wg-8")
  assert_eq(r8.effects[0].kind, "bot_unhide")

  let r9 = run_desktop_turn("delete bot bot-1", turn_id="wg-9")
  assert_eq(r9.intent, "delete_bot")
  assert_eq(r9.effects[0].kind, "bot_delete")
  assert_eq(r9.effects[0].command, "bot=bot-1")

  let r10 = run_desktop_turn("confirm delete bot bot-1", turn_id="wg-10")
  assert_eq(r10.effects[0].command, "bot=bot-1 confirm=yes")

  let r11 = run_desktop_turn("open computer", turn_id="wg-11")
  assert_eq(r11.intent, "computer_preview")
  assert_eq(r11.effects[0].kind, "computer_preview")
  assert_eq(r11.effects[0].command, "bot=agent-bit")

  let r12 = run_desktop_turn("open computer for bot bot-9", turn_id="wg-12")
  assert_eq(r12.effects[0].command, "bot=bot-9")
}

///|
test "desktop_turn_wave_g_takeover_and_computer" {
  let r1 = run_desktop_turn("take over reason=password", turn_id="wg-t1")
  assert_true(r1.ok)
  assert_eq(r1.intent, "take_over")
  assert_eq(r1.effects[0].kind, "take_over")
  assert_eq(r1.effects[0].command, "reason=password")

  let r2 = run_desktop_turn("i'm done", turn_id="wg-t2")
  assert_eq(r2.intent, "takeover_done")
  assert_eq(r2.effects[0].kind, "takeover_done")

  let r3 = run_desktop_turn("recover computer", turn_id="wg-t3")
  assert_eq(r3.intent, "recover_computer")
  assert_eq(r3.effects[0].command, "confirm=recover")
}

///|
test "desktop_turn_wave_g_rules_settings_group" {
  let r1 = run_desktop_turn(
    "always allow pattern=shell:echo* decision=allow",
    turn_id="wg-a1",
  )
  assert_eq(r1.intent, "approval_rule")
  assert_eq(r1.effects[0].kind, "approval_rule")

  let r2 = run_desktop_turn("set appearance dark", turn_id="wg-a2")
  assert_eq(r2.effects[0].command, "mode=dark")
  let r3 = run_desktop_turn("system theme", turn_id="wg-a3")
  assert_eq(r3.effects[0].command, "mode=system")

  let r4 = run_desktop_turn("set language zh-CN", turn_id="wg-a4")
  assert_eq(r4.effects[0].kind, "language_set")
  let r5 = run_desktop_turn("set timezone Asia/Shanghai", turn_id="wg-a5")
  assert_eq(r5.effects[0].command, "tz=Asia/Shanghai")

  let r6 = run_desktop_turn("local execution mode never", turn_id="wg-a6")
  assert_eq(r6.intent, "local_execution_mode")
  assert_eq(r6.effects[0].kind, "local_execution_mode")

  // GP-36: Grok's settings labels are bare "Local execution: Always allow /
  // Never allow / Ask every time". These must reach the three-mode policy, not
  // the legacy CM-1905 on/off boolean (which silently enabled machine use
  // under "never").
  let r6a = run_desktop_turn("local execution always", turn_id="wg-a6a")
  assert_eq(r6a.intent, "local_execution_mode")
  assert_eq(r6a.effects[0].command, "mode=always")
  let r6b = run_desktop_turn("local execution never", turn_id="wg-a6b")
  assert_eq(r6b.intent, "local_execution_mode")
  assert_eq(r6b.effects[0].command, "mode=never")
  let r6c = run_desktop_turn("local execution never allow", turn_id="wg-a6c")
  assert_eq(r6c.intent, "local_execution_mode")
  assert_eq(r6c.effects[0].command, "mode=never")
  let r6d = run_desktop_turn("local execution ask", turn_id="wg-a6d")
  assert_eq(r6d.intent, "local_execution_mode")
  assert_eq(r6d.effects[0].command, "mode=ask")

  let r7 = run_desktop_turn(
    "create group chat bots=bit,piper title=Ops+room",
    turn_id="wg-a7",
  )
  assert_eq(r7.intent, "group_chat")
  assert_eq(r7.effects[0].command, "bots=bit,piper title=Ops+room")
}

///|
/// Regression safety: legacy Grok phrases keep their CM routes (Wave G must
/// not steal "dark mode" from CM-1902 settings anchor).
test "desktop_turn_wave_g_legacy_routes_kept" {
  let r1 = run_desktop_turn("dark mode", turn_id="wg-r1")
  assert_eq(r1.intent, "open_settings")
  assert_eq(r1.effects[0].kind, "settings_open")

  let r2 = run_desktop_turn("local execution off", turn_id="wg-r2")
  assert_eq(r2.intent, "local_execution")
  assert_eq(r2.effects[0].kind, "local_execution")

  let r3 = run_desktop_turn("hide agent asst-chat", turn_id="wg-r3")
  assert_eq(r3.intent, "hide_agent")

  let r4 = run_desktop_turn("update bot computer", turn_id="wg-r4")
  assert_eq(r4.intent, "update_computer")
}
