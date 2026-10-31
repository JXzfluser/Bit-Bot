///|
/// H3 相关断言中，只有"桌面不暴露 deviceLocalTools"这一条与探针骨架无关，
/// 保留在此；`run_h3_probe` / `run_h3_wave` / H3Intent 等探针层随 h3_probes.mbt
/// 一并删除（零生产消费者、能力矩阵零引用）。

///|
test "h3_desktop_lists_no_device_local_tools" {
  let machines = @box_host.MachineRegistry::seed()
  let devices = @box_host.DeviceLocalToolsRegistry::seed_phones()
  let desk = machines.device_local_tools_for(devices, "desk-1")
  assert_eq(desk.length(), 0)
}
