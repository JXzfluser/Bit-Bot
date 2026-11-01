#!/usr/bin/env python3
"""H5 media helpers: real PNG / MP4 / PPTX at the --out path the Host resolves.

Not mock magic-only strings. Each command writes openable Host artifacts.
i_claimed is never set true here.

The output location is *always* the caller's --out / --frame-out path (the Host
maps box virtual paths like /workspace/... onto real ones before spawning us).
Never mkdir a hardcoded /workspace here: on a plain desktop or a CI runner that
directory does not exist, and the create fails (GP-186: G-64 red on 2026-10-31).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Only used as a default for bare manual runs (the Host always passes --out).
AGENT_TOOLS = Path(os.environ.get("BITBOT_AGENT_TOOLS") or "agent-tools")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PK_MAGIC = b"PK"


def _ensure_agent_tools(out: Path) -> None:
    """Create the real output's parent — not a hardcoded box path."""
    out.parent.mkdir(parents=True, exist_ok=True)


def file_magic(path: Path, n: int = 8) -> bytes:
    with path.open("rb") as f:
        return f.read(n)


def cmd_generate_image(out: Path, prompt: str) -> dict:
    """CM-1601: Pillow writes a real PNG from a prompt string (drawn text)."""
    from PIL import Image, ImageDraw, ImageFont

    _ensure_agent_tools(out)
    img = Image.new("RGB", (640, 360), color=(24, 36, 54))
    draw = ImageDraw.Draw(img)
    # Gradient-ish bands for non-flat atmosphere
    for y in range(0, 360, 4):
        shade = 24 + (y // 8) % 40
        draw.rectangle([0, y, 640, y + 4], fill=(shade, 36 + (y // 12) % 30, 70))
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22
        )
    except OSError:
        font = ImageFont.load_default()
    text = (prompt or "h5 generate image")[:80]
    draw.rectangle([24, 120, 616, 240], fill=(18, 28, 44))
    draw.text((40, 140), "CM-1601 GenerateImage", fill=(122, 162, 255), font=font)
    draw.text((40, 180), text, fill=(232, 234, 237), font=font)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, format="PNG")
    magic = file_magic(out)
    return {
        "path": str(out),
        "bytes": out.stat().st_size,
        "png_magic_ok": magic.startswith(PNG_MAGIC),
        "magic_hex": magic.hex(),
        "prompt": text,
        "i_claimed": False,
    }


def cmd_generate_video(out: Path, seconds: float = 1.0) -> dict:
    """CM-1602: ffmpeg encodes a short real mp4."""
    _ensure_agent_tools(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c=0x182436:s=320x240:d={seconds}",
        "-f",
        "lavfi",
        "-i",
        f"sine=frequency=440:duration={seconds}",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    ok = proc.returncode == 0 and out.is_file() and out.stat().st_size > 200
    magic = file_magic(out, 12) if out.is_file() else b""
    # ISO BMFF / ftyp often at offset 4
    ftyp_ok = b"ftyp" in magic or magic[:4] == b"\x00\x00\x00"
    return {
        "path": str(out),
        "bytes": out.stat().st_size if out.is_file() else 0,
        "ffmpeg_rc": proc.returncode,
        "video_complete_notified": ok,
        "ftyp_present": ftyp_ok or (ok and out.suffix == ".mp4"),
        "stderr_tail": (proc.stderr or "")[-400:],
        "i_claimed": False,
    }


def cmd_watch_video(video: Path, frame_out: Path) -> dict:
    """CM-1603: ffmpeg extracts one PNG frame from mp4."""
    _ensure_agent_tools(frame_out)
    frame_out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video),
        "-frames:v",
        "1",
        str(frame_out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    magic = file_magic(frame_out) if frame_out.is_file() else b""
    return {
        "video_path": str(video),
        "frame_path": str(frame_out),
        "bytes": frame_out.stat().st_size if frame_out.is_file() else 0,
        "ffmpeg_rc": proc.returncode,
        "png_magic_ok": magic.startswith(PNG_MAGIC),
        "magic_hex": magic.hex() if magic else "",
        "i_claimed": False,
    }


def cmd_structured_chart(out: Path, series_json: str) -> dict:
    """CM-2157: Pillow bar chart from structured data (no matplotlib)."""
    from PIL import Image, ImageDraw, ImageFont

    _ensure_agent_tools(out)
    try:
        series = json.loads(series_json) if series_json else {"A": 3, "B": 7, "C": 5}
    except json.JSONDecodeError:
        series = {"A": 3, "B": 7, "C": 5}
    w, h = 640, 360
    img = Image.new("RGB", (w, h), color=(15, 17, 21))
    draw = ImageDraw.Draw(img)
    draw.rectangle([40, 40, w - 40, h - 40], outline=(42, 47, 58), width=2)
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16
        )
    except OSError:
        font = ImageFont.load_default()
    draw.text((48, 16), "CM-2157 StructuredChart", fill=(122, 162, 255), font=font)
    keys = list(series.keys())
    vals = [float(series[k]) for k in keys]
    vmax = max(vals) if vals else 1.0
    n = max(len(keys), 1)
    plot_left, plot_bottom, plot_top, plot_right = 80, h - 60, 70, w - 60
    bar_w = max(20, (plot_right - plot_left) // (n * 2))
    colors = [(122, 162, 255), (129, 199, 132), (255, 183, 77), (229, 115, 115)]
    for i, (k, v) in enumerate(zip(keys, vals)):
        x0 = plot_left + i * ((plot_right - plot_left) // n) + 10
        bh = int((v / vmax) * (plot_bottom - plot_top))
        y0 = plot_bottom - bh
        draw.rectangle(
            [x0, y0, x0 + bar_w, plot_bottom], fill=colors[i % len(colors)]
        )
        draw.text((x0, plot_bottom + 8), str(k), fill=(158, 160, 166), font=font)
        draw.text((x0, y0 - 18), str(v), fill=(232, 234, 237), font=font)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, format="PNG")
    magic = file_magic(out)
    return {
        "path": str(out),
        "bytes": out.stat().st_size,
        "png_magic_ok": magic.startswith(PNG_MAGIC),
        "magic_hex": magic.hex(),
        "series": series,
        "i_claimed": False,
    }


def cmd_pptx(out: Path, title: str) -> dict:
    """CM-1807: python-pptx writes a real host-openable .pptx (PK zip)."""
    from pptx import Presentation
    from pptx.util import Inches, Pt

    _ensure_agent_tools(out)
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[5])  # blank
    box = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(8), Inches(2))
    tf = box.text_frame
    p = tf.paragraphs[0]
    p.text = title or "CM-1807 Bit Bot Host PPTX"
    p.font.size = Pt(32)
    p.font.bold = True
    p2 = tf.add_paragraph()
    p2.text = "Host-openable deck · i_claimed=false · Wave H5"
    p2.font.size = Pt(16)
    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out))
    magic = file_magic(out, 4)
    return {
        "path": str(out),
        "bytes": out.stat().st_size,
        "pptx_pk_magic_ok": magic.startswith(PK_MAGIC),
        "magic_hex": magic.hex(),
        "title": title or "CM-1807 Bit Bot Host PPTX",
        "i_claimed": False,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="H5 media helpers (real artifacts)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p1 = sub.add_parser("generate-image")
    p1.add_argument(
        "--out",
        default=str(AGENT_TOOLS / "h5-cm1601-generate.png"),
    )
    p1.add_argument("--prompt", default="prompt→png host evidence")
    p1.add_argument("--meta-json", default="")

    p2 = sub.add_parser("generate-video")
    p2.add_argument(
        "--out",
        default=str(AGENT_TOOLS / "h5-cm1602-generate.mp4"),
    )
    p2.add_argument("--seconds", type=float, default=1.0)
    p2.add_argument("--meta-json", default="")

    p3 = sub.add_parser("watch-video")
    p3.add_argument(
        "--video",
        default=str(AGENT_TOOLS / "h5-cm1602-generate.mp4"),
    )
    p3.add_argument(
        "--frame-out",
        default=str(AGENT_TOOLS / "h5-cm1603-frame.png"),
    )
    p3.add_argument("--meta-json", default="")

    p4 = sub.add_parser("structured-chart")
    p4.add_argument(
        "--out",
        default=str(AGENT_TOOLS / "h5-cm2157-chart.png"),
    )
    p4.add_argument("--series", default='{"alpha":4,"beta":9,"gamma":6}')
    p4.add_argument("--meta-json", default="")

    p5 = sub.add_parser("pptx")
    p5.add_argument(
        "--out",
        default=str(AGENT_TOOLS / "h5-cm1807-deck.pptx"),
    )
    p5.add_argument("--title", default="CM-1807 Bit Bot Host PPTX")
    p5.add_argument("--meta-json", default="")

    args = ap.parse_args()
    if args.cmd == "generate-image":
        meta = cmd_generate_image(Path(args.out), args.prompt)
    elif args.cmd == "generate-video":
        meta = cmd_generate_video(Path(args.out), args.seconds)
    elif args.cmd == "watch-video":
        meta = cmd_watch_video(Path(args.video), Path(args.frame_out))
    elif args.cmd == "structured-chart":
        meta = cmd_structured_chart(Path(args.out), args.series)
    elif args.cmd == "pptx":
        meta = cmd_pptx(Path(args.out), args.title)
    else:
        return 2

    print(json.dumps(meta, indent=2))
    if args.meta_json:
        Path(args.meta_json).write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    # Fail if core magic asserts fail
    if args.cmd in ("generate-image", "structured-chart") and not meta.get("png_magic_ok"):
        return 1
    if args.cmd == "watch-video" and not meta.get("png_magic_ok"):
        return 1
    if args.cmd == "generate-video" and not meta.get("video_complete_notified"):
        return 1
    if args.cmd == "pptx" and not meta.get("pptx_pk_magic_ok"):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
