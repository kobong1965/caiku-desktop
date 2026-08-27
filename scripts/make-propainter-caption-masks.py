#!/usr/bin/env python3
"""Create one glyph-level ProPainter mask per video frame from timed caption zones."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

import cv2


def load_remover(script_path: Path):
    spec = importlib.util.spec_from_file_location("caption_remover", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load caption remover: {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--zones", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--time-offset",
        type=float,
        default=0.0,
        help="Original source timestamp represented by frame zero.",
    )
    parser.add_argument(
        "--remover-script",
        type=Path,
        default=Path(__file__).with_name("remove-dynamic-captions.py"),
    )
    args = parser.parse_args()

    zones = json.loads(args.zones.read_text(encoding="utf-8"))
    remover = load_remover(args.remover_script)
    capture = cv2.VideoCapture(str(args.input))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open input: {args.input}")
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if any(args.output_dir.iterdir()):
        raise RuntimeError(f"Output directory is not empty: {args.output_dir}")
    index = 0
    positive = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            mask, _ = remover._manual_zone_masks(frame, args.time_offset + index / fps, zones)
            if cv2.countNonZero(mask):
                positive += 1
            path = args.output_dir / f"{index:06d}.png"
            encoded, payload = cv2.imencode(".png", mask)
            if not encoded:
                raise RuntimeError(f"Cannot write mask: {path}")
            path.write_bytes(payload.tobytes())
            index += 1
    finally:
        capture.release()
    print(f"frames={index} positive_masks={positive} fps={fps:.6f} output={args.output_dir}")


if __name__ == "__main__":
    main()
