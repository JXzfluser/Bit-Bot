#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「机器人管理 + 渠道扫码关联」这一版新增的三语词条写进 index.html。

为什么用脚本而不是手改：字典是三个 860+ 键的大块，手插一次就会漏一种语言，
而且漏了之后界面在切语言时显示 key 本身（wavegT 的兜底就是返回 key）。
脚本做三件手改不会稳定做到的事：
  1. 三个语言块用**块声明行**定位，不靠某个值去 find（值相同的键会命中错位置）；
  2. 每个键插完断言恰好 3 次 —— 少了是漏语言，多了是插到了别处；
  3. 幂等：已经写过就整体跳过，不会重复插。

跑法：python3 scripts/apply_bot_manager_i18n.py
"""

import io
import re
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, "hosts", "desktop", "index.html")

# key: (zh-CN, zh-TW, en)
WORDS = {
    "bmTitle": ("机器人管理", "機器人管理", "Bots"),
    "bmSubtitle": (
        "把聊天工具接成机器人。扫一下码，凭据在手机上填，桌面不用粘任何字段。",
        "把聊天工具接成機器人。掃一下碼，憑據在手機上填，桌面不用貼任何欄位。",
        "Turn a chat app into a bot. Scan once, fill the credential on your phone — nothing to paste here.",
    ),
    "bmListTitle": ("机器人", "機器人", "Bots"),
    "bmStateIdle": ("读取中…", "讀取中…", "Reading…"),
    "bmEnable": ("启用", "啟用", "Enabled"),
    "bmBindTitle": ("关联机器人", "關聯機器人", "Link this bot"),
    "bmNotBound": ("未关联", "未關聯", "Not linked"),
    "bmBound": ("已关联", "已關聯", "Linked"),
    "bmBindNote": ("扫码后自动保存凭据。", "掃碼後自動儲存憑據。", "Scanning saves the credential for you."),
    "bmBindHint": (
        "用手机相机扫这个码，在手机上打开绑定页。",
        "用手機相機掃這個碼，在手機上開啟綁定頁。",
        "Scan this with your phone camera to open the setup page on your phone.",
    ),
    "bmBindHintCh": (
        "用手机相机扫这个码，在手机上把 {ch} 的凭据填好。",
        "用手機相機掃這個碼，在手機上把 {ch} 的憑據填好。",
        "Scan this with your phone camera and fill in the {ch} credential there.",
    ),
    "bmQrEmpty": ("点「生成二维码」，这里才会出现码。", "點「生成二維碼」，這裡才會出現碼。", "Tap Generate QR code to get a code here."),
    "bmWaitingIdle": ("还没生成", "還沒生成", "Not generated yet"),
    "bmWaiting": ("等待扫码 · 还剩 {t}", "等待掃碼 · 還剩 {t}", "Waiting for scan · {t} left"),
    "bmBegin": ("生成二维码", "生成二維碼", "Generate QR code"),
    "bmCopy": ("复制链接", "複製連結", "Copy link"),
    "bmCopied": ("已复制 · 链接 5 分钟内有效", "已複製 · 連結 5 分鐘內有效", "Copied · the link is valid for 5 minutes"),
    "bmCopyFail": (
        "复制失败：这台机器不让写剪贴板，手动选中链接吧",
        "複製失敗：這台機器不讓寫剪貼簿，手動選取連結吧",
        "Copy failed: clipboard is blocked here, select the link manually",
    ),
    "bmExpired": ("这个码过期了，重新生成一个", "這個碼過期了，重新生成一個", "This code expired — generate a new one"),
    "bmBoundMeta": ("已关联", "已關聯", "Linked"),
    "bmEnabledMeta": ("已启用", "已啟用", "on"),
    "bmNotBoundMeta": ("未关联", "未關聯", "Not linked"),
    "bmNotBindable": ("不支持扫码", "不支援掃碼", "No QR setup"),
    "bmLanEnable": ("开启局域网并生成", "開啟區域網路並生成", "Allow LAN and generate"),
    "bmLanClosed": (
        "手机要能访问到这个地址，得先放开局域网（同一 Wi-Fi 下的设备才能连这台桌面）。点「开启局域网并生成」就一起做了。",
        "手機要能存取到這個位址，得先放開區域網路（同一 Wi-Fi 下的裝置才能連這台桌面）。點「開啟區域網路並生成」就一起做了。",
        "The phone must be able to reach this address, so LAN access has to be opened first. The next tap does both.",
    ),
    "bmLanClosedShort": ("需要先开启局域网", "需要先開啟區域網路", "LAN access is required first"),
    "bmLanAuto": (
        "已顺带开启局域网：手机要能扫到这个地址。",
        "已順帶開啟區域網路：手機要能掃到這個位址。",
        "LAN access was turned on too — the phone must be able to reach this address.",
    ),
    "bmBeginFail": ("生成失败：{err}", "生成失敗：{err}", "Could not generate: {err}"),
    "bmFactCred": ("凭据", "憑據", "Credential"),
    "bmFactCredNone": ("还没有存过。", "還沒有存過。", "Nothing saved yet."),
    "bmFactCredSome": (
        "已存在本地配置（{m}），界面只显示尾号。",
        "已存在本機設定（{m}），介面只顯示尾號。",
        "Stored locally ({m}); only the last digits are shown.",
    ),
    "bmFactCredWechat": (
        "微信这一侧没有可存的机器人凭据。",
        "微信這一側沒有可存的機器人憑據。",
        "There is no bot credential to store on the WeChat side.",
    ),
    "bmFactWhere": ("完整字段在哪", "完整欄位在哪", "Where the full fields are"),
    "bmFactWhereHint": (
        "加签密钥、回调 Token 这类高级项在「连接应用 → 通信」里，和这里是同一份配置。",
        "加簽密鑰、回呼 Token 這類進階項在「連接應用 → 通訊」裡，和這裡是同一份設定。",
        "Advanced items such as the signing secret and callback token live under Connect apps → Communication; it is the same config.",
    ),
    "bmOpenConnect": ("打开", "開啟", "Open"),
    "bmUnbind": ("解除关联", "解除關聯", "Unlink"),
    "bmUnbindHint": (
        "从这台桌面删掉这个渠道的凭据，随时可以重新扫码。",
        "從這台桌面刪掉這個渠道的憑據，隨時可以重新掃碼。",
        "Removes this channel's credential from this desktop. You can scan again any time.",
    ),
    "bmUnbindBtn": ("解除关联", "解除關聯", "Unlink"),
    "bmUnbindConfirm": ("再点一次确认", "再點一次確認", "Tap again to confirm"),
    "bmUnbound": ("已解除，凭据已删掉", "已解除，憑據已刪掉", "Unlinked — the credential is gone"),
    "bmBoundDone": ("手机上提交成功 · 已关联", "手機上提交成功 · 已關聯", "Submitted on your phone · linked"),
    "bmNoQrHint": (
        "这一条没有二维码可扫，原因见下。",
        "這一條沒有二維碼可掃，原因見下。",
        "There is no QR code for this one — see why below.",
    ),
    "bmOpenWecom": ("去企业微信关联", "去企業微信關聯", "Link via WeCom"),
    "mcManagerHint": (
        "要让群里同事直接找机器人说话，去机器人管理。",
        "要讓群組同事直接找機器人說話，去機器人管理。",
        "To let teammates in a chat talk to a bot, open Bots.",
    ),
}

# 语义变了就顺手改的旧词条（标题/副标题现在指向中转，不再指向机器人管理）
REPLACE = {
    "mc2Subtitle": (
        "手机不在同一个 Wi-Fi 时用这里；同网直连不需要动它。",
        "手機不在同一個 Wi-Fi 時用這裡；同網直連不需要動它。",
        "Use this when the phone is on a different network. Same Wi-Fi needs nothing here.",
    ),
}

BLOCKS = [
    ('      "zh-CN": {', 0),
    ('      "zh-TW": {', 1),
    ('      en: {', 2),
]


def main():
    src = io.open(HTML, encoding="utf-8").read()

    if "bmTitle:" in src:
        print("已写过，跳过（幂等）")
        return 0

    for anchor, idx in BLOCKS:
        pos = src.find(anchor)
        if pos < 0:
            print("找不到语言块: " + anchor)
            return 1
        if src.count(anchor) != 1:
            print("语言块声明不唯一，拒绝插入: " + anchor + " count=" + str(src.count(anchor)))
            return 1
        lines = []
        for k, vals in WORDS.items():
            v = vals[idx].replace('"', '\\"')
            lines.append('        %s: "%s",' % (k, v))
        block = "\n" + "\n".join(lines)
        insert_at = pos + len(anchor)
        src = src[:insert_at] + block + src[insert_at:]

    # 旧词条改语义
    for k, vals in REPLACE.items():
        for idx in range(3):
            pat = re.compile(r'(\n\s*%s: ")([^"]*)(")' % re.escape(k))
            hits = pat.findall(src)
            if len(hits) != 3:
                print("替换目标数量异常: %s -> %d" % (k, len(hits)))
                return 1
            # 按出现顺序替换（三个块顺序与 BLOCKS 一致）
            counter = {"i": 0}

            def _sub(m):
                i = counter["i"]
                counter["i"] += 1
                if i == idx:
                    return m.group(1) + vals[idx].replace('"', '\\"') + m.group(3)
                return m.group(0)

            src = pat.sub(_sub, src)

    # 自检：每个键恰好 3 次
    bad = []
    for k in WORDS:
        n = len(re.findall(r"\b%s:" % re.escape(k), src))
        if n != 3:
            bad.append((k, n))
    if bad:
        print("键次数不对（应各 3 次）: " + str(bad))
        return 1

    io.open(HTML, "w", encoding="utf-8").write(src)
    print("已写入 %d 个新词条 × 3 语言；%d 个旧词条改了语义" % (len(WORDS), len(REPLACE)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
