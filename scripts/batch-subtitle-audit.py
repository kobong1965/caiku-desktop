#!/usr/bin/env python3
"""Lightweight subtitle audit for a batch of local vertical videos."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import time
from pathlib import Path

import cv2
import numpy as np


def load_remover(script_path: Path):
    spec = importlib.util.spec_from_file_location("caption_remover", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_contact_sheet(frames: list[np.ndarray], output: Path, columns: int = 4) -> None:
    if not frames:
        return
    thumb_w, thumb_h = 270, 480
    thumbs = [cv2.resize(frame, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA) for frame in frames]
    rows = math.ceil(len(thumbs) / columns)
    canvas = np.zeros((rows * thumb_h, columns * thumb_w, 3), np.uint8)
    for index, frame in enumerate(thumbs):
        y = index // columns * thumb_h
        x = index % columns * thumb_w
        canvas[y : y + thumb_h, x : x + thumb_w] = frame
    output.parent.mkdir(parents=True, exist_ok=True)
    ok, encoded = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise RuntimeError(f"Cannot encode preview: {output}")
    encoded.tofile(str(output))


def audit_video(path: Path, remover, sample_fps: float, preview_path: Path) -> dict:
    started = time.perf_counter()
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open {path}")
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / source_fps
    next_sample = 0
    frame_index = 0
    checked = 0
    positives: list[dict] = []
    previews: list[np.ndarray] = []
    zone_counts = {"top": 0, "middle": 0, "bottom": 0}

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        time_s = frame_index / source_fps
        if time_s + 1e-9 >= next_sample / sample_fps:
            analysis = cv2.resize(frame, (540, 960), interpolation=cv2.INTER_AREA)
            _, boxes = remover.detect_caption_mask(analysis, time_s, True)
            checked += 1
            if boxes:
                positives.append({"time": round(time_s, 3), "boxes": boxes})
                for x, y, w, h in boxes:
                    center_y = (y + h / 2) / 960
                    zone = "top" if center_y < 0.3 else "bottom" if center_y > 0.68 else "middle"
                    zone_counts[zone] += 1
                    cv2.rectangle(analysis, (x, y), (x + w, y + h), (20, 220, 255), 3)
                if len(previews) < 12:
                    cv2.putText(
                        analysis,
                        f"{time_s:.2f}s",
                        (14, 42),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1.0,
                        (20, 220, 255),
                        2,
                        cv2.LINE_AA,
                    )
                    previews.append(analysis)
            next_sample += 1
        frame_index += 1
    capture.release()
    make_contact_sheet(previews, preview_path)
    return {
        "source": str(path).replace("\\", "/"),
        "durationSeconds": round(duration, 3),
        "sourceFps": round(source_fps, 3),
        "sampleFps": sample_fps,
        "checkedFrames": checked,
        "positiveFrames": len(positives),
        "positiveRatio": round(len(positives) / max(checked, 1), 4),
        "firstPositiveSecond": positives[0]["time"] if positives else None,
        "lastPositiveSecond": positives[-1]["time"] if positives else None,
        "detectedZones": zone_counts,
        "hasSubtitles": bool(positives),
        "wallSeconds": round(time.perf_counter() - started, 3),
        "samples": positives,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--remover", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preview-dir", type=Path, required=True)
    parser.add_argument("--sample-fps", type=float, default=4.0)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    remover = load_remover(args.remover)
    batch_started = time.perf_counter()
    results = []
    for item in config["items"]:
        result = audit_video(
            Path(item["source"]),
            remover,
            args.sample_fps,
            args.preview_dir / f"{item['id']}_字幕检测.jpg",
        )
        result["id"] = item["id"]
        results.append(result)
        print(
            f"{item['id']} checked={result['checkedFrames']} positive={result['positiveFrames']} "
            f"ratio={result['positiveRatio']:.3f} wall={result['wallSeconds']:.2f}s",
            flush=True,
        )
    payload = {
        "sampleFps": args.sample_fps,
        "batchWallSeconds": round(time.perf_counter() - batch_started, 3),
        "videos": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"batch_wall={payload['batchWallSeconds']:.3f}s output={args.output}")


if __name__ == "__main__":
    main()
