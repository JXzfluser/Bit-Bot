///|
/// 真实设备 id 的设备工具落点(B-6)
///
/// 现场:一台安卓手机通过 `/v1/turn` 入站。它的机器身份是**设备密钥的 id**
/// (`dev-android-<指纹>`),不是内核注册表里那个写死的 `phone-android`。
/// 改之前:
///   · `DeviceLocalToolsRegistry.by_machine` 只有 `phone-ios`/`phone-android`
///     两把键 ⇒ 真机 id 查表落空 ⇒ `list_for` 返回 0 个工具;
///   · `invoke` 同样落空 ⇒ 返回 `unavailable` 的权限卡;
///   ⇒ 也就是说:**手机上「拍照 / 麦克风」在内核里根本没有落点**。
///
/// 改之后:
///   · 工具表按 **kind** 兜底(这类设备**声明**有什么工具),
///     设备专属表只管"这一台额外有/没有";
///   · 真机入站时把 `(设备 id, kind)` 登记进机器注册表 ⇒ 花名册认识这台机器。
///
/// 这些断言全是**否定式**的对照:真机 id 与稳定 id 必须给出**同一类**结果,
/// 否则改没改都"看起来能用"。
test "acceptance_B6_real_device_id_has_device_tools" {
  let devices = @box_host.DeviceLocalToolsRegistry::seed_phones()
  // 真机的机器身份:设备密钥 id
  let real_android = "dev-android-9f2c1a"

  let tools = devices.list_for(real_android, @box_host.Android)
  assert_true(tools.length() >= 3)
  let mut saw_microphone = false
  for t in tools {
    if t.name == "microphone" {
      saw_microphone = true
    }
  }
  assert_true(saw_microphone)
}

///|
/// 真机 id 与稳定 id 的工具集合**必须一致**(类型表兜底的正确性)。
test "acceptance_B6_real_device_id_matches_stable_id_tools" {
  let devices = @box_host.DeviceLocalToolsRegistry::seed_phones()
  let stable = devices.list_for("phone-android", @box_host.Android)
  let real = devices.list_for("dev-android-9f2c1a", @box_host.Android)
  assert_eq(real.length(), stable.length())
}

///|
/// 真机调用工具 ⇒ 要审批的出**审批卡**(needs_permission),
/// **不是** `unavailable`(改之前就是 unavailable —— 工具根本没有落点)。
test "acceptance_B6_real_device_invoke_gives_permission_card_not_unavailable" {
  let devices = @box_host.DeviceLocalToolsRegistry::seed_phones()
  let real_android = "dev-android-9f2c1a"
  match devices.invoke(real_android, @box_host.Android, "microphone") {
    Ok(msg) => assert_false(msg == "device_local_ok:microphone")
    Err(card) => {
      assert_eq(card.permission_label, "needs_permission")
      assert_true(card.shown)
      assert_eq(card.machine_id, real_android)
    }
  }
}

///|
/// 两台安卓手机各有自己的 id ⇒ 都能拿到工具,且**互不影响**。
test "acceptance_B6_two_phones_do_not_collide" {
  let devices = @box_host.DeviceLocalToolsRegistry::seed_phones()
  let a = devices.list_for("dev-android-aaaa", @box_host.Android)
  let b = devices.list_for("dev-android-bbbb", @box_host.Android)
  assert_true(a.length() >= 1)
  assert_true(b.length() >= 1)
  // 两台是**两台** —— 设备专属表里没有它们,工具来自类型表,但 id 各自保留
  match devices.invoke("dev-android-aaaa", @box_host.Android, "notifications") {
    Ok(_) => assert_true(true)
    Err(card) => assert_eq(card.machine_id, "dev-android-aaaa")
  }
}

///|
/// 桌面永远不列设备工具(改前改后都一样)。
test "acceptance_B6_desktop_has_no_device_tools" {
  let devices = @box_host.DeviceLocalToolsRegistry::seed_phones()
  assert_eq(devices.list_for("desk-1", @box_host.Desktop).length(), 0)
  assert_eq(devices.list_for("dev-desktop-x", @box_host.Desktop).length(), 0)
}

///|
/// 真机入站 ⇒ 机器注册表**认识这台机器**(否则 device_local_tools_for 查不到)。
test "acceptance_B6_real_device_registered_in_machine_registry" {
  let machines = @box_host.MachineRegistry::seed()
  let devices = @box_host.DeviceLocalToolsRegistry::seed_phones()
  machines.mark_host_present(machine_id="dev-android-9f2c1a", machine_kind="android")
  let found = machines.find("dev-android-9f2c1a")
  assert_true(found != None)
  let tools = machines.device_local_tools_for(devices, "dev-android-9f2c1a")
  assert_true(tools.length() >= 3)
}

///|
/// 一台安卓上线**不许**把注册表里那台没连的 `phone-android` 标成在线。
/// (改之前是 `kind_match || id_match` —— kind 一样就算数。)
test "acceptance_B6_one_phone_online_does_not_mark_other_phone_online" {
  let machines = @box_host.MachineRegistry::seed()
  machines.mark_host_present(machine_id="dev-android-9f2c1a", machine_kind="android")
  let other = machines.find("phone-android")
  match other {
    None => assert_true(false)
    Some(m) => assert_eq(m.status.name(), "disconnected")
  }
  let mine = machines.find("dev-android-9f2c1a")
  match mine {
    None => assert_true(false)
    Some(m) => {
      assert_eq(m.status.name(), "connected")
      assert_eq(m.kind.name(), "android")
    }
  }
}
