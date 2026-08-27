#!/usr/bin/env python3
"""Rebuild clean masters from verified intervals and preserve excluded spans."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from datetime import datetime
from pathlib import Path


def seconds(value: float) -> str:
    return f"{value:.3f}"


def render_concat(ffmpeg: Path, source: Path, output: Path, ranges: list[list[float]]) -> float:
    labels: list[str] = []
    filters: list[str] = []
    for index, (start, end, *_rest) in enumerate(ranges):
        filters.append(
            f"[0:v]trim=start={seconds(float(start))}:end={seconds(float(end))},"
            f"setpts=PTS-STARTPTS[v{index}]"
        )
        labels.append(f"[v{index}]")
    filters.append(f"{''.join(labels)}concat=n={len(labels)}:v=1:a=0[outv]")
    command = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(source), "-filter_complex", ";".join(filters),
        "-map", "[outv]", "-an", "-c:v", "libx264", "-preset", "fast",
        "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
    ]
    started = time.perf_counter()
    subprocess.run(command, check=True)
    return time.perf_counter() - started


def render_excluded(
    ffmpeg: Path,
    source: Path,
    output: Path,
    start: float,
    end: float,
) -> float:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-ss", seconds(start), "-i", str(source), "-t", seconds(end - start),
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
    ]
    started = time.perf_counter()
    subprocess.run(command, check=True)
    return time.perf_counter() - started


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    report_dir = args.output_root / "04_分析报告"
    low_dir = args.output_root / "03_低复用待复核"
    records: list[dict[str, object]] = []
    started = time.perf_counter()

    for item in config["items"]:
        source = Path(str(item["source"]))
        output = report_dir / f"{item['id']}_最终母版临时.mp4"
        wall = render_concat(args.ffmpeg, source, output, item["keepRanges"])
        excluded_records = []
        for index, exclusion in enumerate(item["excludedRanges"], start=1):
            start_s, end_s, reason = float(exclusion[0]), float(exclusion[1]), str(exclusion[2])
            excluded_output = low_dir / (
                f"{item['id']}_补充分流_{index:02d}_{reason}_{start_s:.2f}-{end_s:.2f}_原文保留.mp4"
            )
            excluded_wall = render_excluded(
                args.ffmpeg, source, excluded_output, start_s, end_s
            )
            excluded_records.append({
                "start": start_s,
                "end": end_s,
                "reason": reason,
                "output": str(excluded_output),
                "wallSeconds": round(excluded_wall, 3),
            })
        records.append({
            "id": item["id"],
            "source": str(source),
            "output": str(output),
            "keepRanges": item["keepRanges"],
            "outputDurationSeconds": round(
                sum(float(r[1]) - float(r[0]) for r in item["keepRanges"]), 3
            ),
            "wallSeconds": round(wall, 3),
            "excluded": excluded_records,
        })

    report = {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "wallSeconds": round(time.perf_counter() - started, 3),
        "items": records,
    }
    path = report_dir / "复杂图文分流与母版重建.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(path), "wallSeconds": report["wallSeconds"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
