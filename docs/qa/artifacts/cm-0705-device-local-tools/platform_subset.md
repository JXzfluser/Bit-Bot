# CM-0705 platform subset declaration

| field | value |
|-------|-------|
| platform_subset | `desktop_no_device_local_tools` |
| box_os | Linux (hosted-anyrun / docker-class) |
| phone_present | **false** |
| true_ios_android_os_permission_dialog | **N/A — residual GAP** |
| proven_on_box | Desktop `device_local_tools_for` returns empty list; Host may still surface needs_permission→approval card UI via Live HostUiShell when a phone machine is registered in fixtures |
| residual_gap | Real iOS/Android OS permission dialog + OS grant for deviceLocalTools |
| i_claimed | **false** (Bit验证 decides; subset is honest, not a silent skip) |

## Asserts

1. Desktop machines never list `deviceLocalTools` (U + Live observation).
2. No memory-only fake OS dialog is presented as I evidence.
3. This file is required when phone hardware is absent (G-H3-5).
