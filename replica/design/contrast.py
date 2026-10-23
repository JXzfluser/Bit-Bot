#!/usr/bin/env python3
"""WCAG 2.2 AA 对比度校验（仅用标准库）。

读取同目录 tokens.json：
  - 解析 color 映射与 pairs 列表
  - 对每对 (fg, bg) 计算相对亮度 → 对比度
  - 文本 AA 阈值 4.5:1（Large/UI 阈值 3:1 一并报告）

退出码：0 = 全部通过；1 = 存在 AA 失败。
用法：python3 contrast.py [path/to/tokens.json]
"""
import json
import os
import sys

AA_NORMAL = 4.5   # WCAG 2.2 AA 正文文本
AA_LARGE = 3.0    # WCAG 2.2 AA 大文本 / UI 组件边界


def _hex_to_rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _rel_lum(rgb):
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg, bg):
    l1, l2 = _rel_lum(_hex_to_rgb(fg)), _rel_lum(_hex_to_rgb(bg))
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "tokens.json")
    with open(path, "r", encoding="utf-8") as f:
        doc = json.load(f)

    colors = doc["color"]
    pairs = doc["pairs"]
    fails = 0
    print(f"contrast gate · {len(pairs)} pairs · tokens={os.path.basename(path)}")
    print("-" * 56)
    for fg_key, bg_key in pairs:
        fg, bg = colors[fg_key], colors[bg_key]
        ratio = contrast(fg, bg)
        aa = ratio >= AA_NORMAL
        large = ratio >= AA_LARGE
        mark = "PASS" if aa else "FAIL"
        if not aa:
            fails += 1
        level = "AAA" if ratio >= 7 else ("AA" if aa else "FAIL")
        print(f"  [{mark}] {fg_key:11s}/{bg_key:9s} {ratio:5.2f}:1  {level}"
              f"{'' if large else '  (also < 3:1 UI)'}")
    print("-" * 56)
    if fails:
        print(f"RESULT: {fails} AA failure(s) → exit 1")
        sys.exit(1)
    print(f"RESULT: 0 AA failures ({len(pairs)} pairs) → exit 0")
    sys.exit(0)


if __name__ == "__main__":
    main()
