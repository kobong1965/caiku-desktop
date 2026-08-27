#!/usr/bin/env python3
"""Create readable, timestamped contact-sheet pages for manual video QA."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import cv2
import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--sample-fps", type=float, default=4.0)
    parser.add_argument("--columns", type=int, default=6)
    parser.add_argument("--rows", type=int, default=8)
    parser.add_argument("--thumb-width", type=int, default=180)
    args = parser.parse_args()

    capture = cv2.VideoCapture(str(args.input))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open {args.input}")
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / source_fps
    sample_count = math.ceil(duration * args.sample_fps)
    thumb_height = round(args.thumb_width * 16 / 9)
    per_page = args.columns * args.rows
    pages = math.ceil(sample_count / per_page)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for page in range(pages):
        canvas = np.zeros(
            (args.rows * thumb_height, args.columns * args.thumb_width, 3), np.uint8
        )
        for slot in range(per_page):
            sample_index = page * per_page + slot
            if sample_index >= sample_count:
                break
            time_s = sample_index / args.sample_fps
            capture.set(cv2.CAP_PROP_POS_MSEC, time_s * 1000)
            ok, frame = capture.read()
            if not ok:
                continue
            thumb = cv2.resize(
                frame, (args.thumb_width, thumb_height), interpolation=cv2.INTER_AREA
            )
            cv2.rectangle(thumb, (0, 0), (72, 24), (0, 0, 0), -1)
            cv2.putText(
                thumb,
                f"{time_s:05.2f}",
                (4, 18),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.52,
                (40, 230, 255),
                1,
                cv2.LINE_AA,
            )
            y = slot // args.columns * thumb_height
            x = slot % args.columns * args.thumb_width
            canvas[y : y + thumb_height, x : x + args.thumb_width] = thumb
        output = args.output_dir / f"{args.input.stem}_page_{page + 1:02d}.jpg"
        ok, encoded = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            raise RuntimeError(f"Cannot encode {output}")
        encoded.tofile(str(output))
    capture.release()
    print(f"pages={pages} samples={sample_count} output={args.output_dir}")


if __name__ == "__main__":
    main()
