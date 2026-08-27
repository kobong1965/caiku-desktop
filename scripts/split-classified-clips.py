#!/usr/bin/env python3
"""Split cleaned masters into reusable fashion-material categories."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-config", type=Path, required=True)
    parser.add_argument("--split-config", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    return parser.parse_args()


def render_clip(
    ffmpeg: Path,
    source: Path,
    output: Path,
    start: float,
    end: float,
) -> float:
    output.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    command = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{end - start:.3f}",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
    ]
    subprocess.run(command, check=True)
    return time.perf_counter() - started


def main() -> None:
    args = parse_args()
    batch = json.loads(args.batch_config.read_text(encoding="utf-8"))
    split = json.loads(args.split_config.read_text(encoding="utf-8"))
    items_by_id = {str(item["id"]): item for item in batch["items"]}
    clean_dir = args.output_root / "02_去字后素材"
    low_dir = args.output_root / "03_低复用待复核"
    class_dir = args.output_root / "05_分类素材"
    report_dir = args.output_root / "04_分析报告"
    records: list[dict[str, object]] = []
    started = time.perf_counter()

    for item in split["items"]:
        item_id = str(item["id"])
        master = clean_dir / f"{item_id}_去字母版_1080x1920_30fps_静音.mp4"
        if item.get("reuseExistingClassifiedClips"):
            previous_root = Path("D:/桌面/抖音素材/裁库拆解_老钱风西裤_去字")
            for category in ("01_人物穿搭", "02_整体展示", "03_细节讲解"):
                for source in (previous_root / category).glob("*.mp4"):
                    output = class_dir / category / f"{item_id}_{source.name}"
                    output.parent.mkdir(parents=True, exist_ok=True)
                    clip_started = time.perf_counter()
                    shutil.copy2(source, output)
                    records.append({
                        "id": item_id,
                        "category": category,
                        "label": source.stem,
                        "output": str(output),
                        "action": "cache_hit_copy",
                        "wallSeconds": round(time.perf_counter() - clip_started, 3),
                        "sizeBytes": output.stat().st_size,
                    })
            continue
        for index, segment in enumerate(item["segments"], start=1):
            category = str(segment["category"])
            label = str(segment["label"])
            output = class_dir / category / (
                f"{item_id}_{index:02d}_{label}_{float(segment['start']):.2f}-{float(segment['end']):.2f}.mp4"
            )
            wall = render_clip(
                args.ffmpeg,
                master,
                output,
                float(segment["start"]),
                float(segment["end"]),
            )
            records.append({
                "id": item_id,
                "category": category,
                "label": label,
                "start": segment["start"],
                "end": segment["end"],
                "output": str(output),
                "action": "clean_master_split",
                "wallSeconds": round(wall, 3),
                "sizeBytes": output.stat().st_size,
            })

    low_records: list[dict[str, object]] = []
    for batch_item in batch["items"]:
        source = Path(str(batch_item["source"]))
        for index, low in enumerate(batch_item.get("lowReuseRanges", []), start=1):
            start_s, end_s, reason = float(low[0]), float(low[1]), str(low[2])
            output = low_dir / f"{batch_item['id']}_{index:02d}_{reason}_{start_s:.2f}-{end_s:.2f}_原文保留.mp4"
            wall = render_clip(args.ffmpeg, source, output, start_s, end_s)
            low_records.append({
                "id": batch_item["id"],
                "reason": reason,
                "start": start_s,
                "end": end_s,
                "output": str(output),
                "captionStatus": "原文保留，禁止自动投放",
                "wallSeconds": round(wall, 3),
                "sizeBytes": output.stat().st_size,
            })

    supplemental_report = report_dir / "复杂图文分流与母版重建.json"
    if supplemental_report.exists():
        supplemental = json.loads(supplemental_report.read_text(encoding="utf-8"))
        for supplemental_item in supplemental.get("items", []):
            for excluded in supplemental_item.get("excluded", []):
                output = Path(str(excluded["output"]))
                low_records.append({
                    "id": supplemental_item["id"],
                    "reason": excluded["reason"],
                    "start": excluded["start"],
                    "end": excluded["end"],
                    "output": str(output),
                    "captionStatus": "复杂图文原文保留，禁止自动投放",
                    "action": "supplemental_existing_clip",
                    "wallSeconds": excluded.get("wallSeconds", 0),
                    "sizeBytes": output.stat().st_size,
                })

    report = {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "classificationWallSeconds": round(time.perf_counter() - started, 3),
        "reusableClipCount": len(records),
        "lowReuseClipCount": len(low_records),
        "clips": records,
        "lowReuse": low_records,
    }
    report_path = report_dir / "分类清单.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(report_path), **{k: report[k] for k in ("classificationWallSeconds", "reusableClipCount", "lowReuseClipCount")}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
