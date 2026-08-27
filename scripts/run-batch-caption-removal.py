#!/usr/bin/env python3
"""Run caption removal for a configured batch and record real resource use."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import statistics
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

try:
    import psutil
except ImportError:  # The report remains usable when psutil is unavailable.
    psutil = None


@dataclass
class ResourceSampler:
    interval: float = 1.0
    samples: list[dict[str, float]] = field(default_factory=list)
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    def start(self) -> None:
        self._stop.clear()
        if psutil:
            psutil.cpu_percent(interval=None)
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=self.interval + 2)

    def _gpu_sample(self) -> dict[str, float]:
        command = [
            "nvidia-smi",
            "--query-gpu=utilization.gpu,memory.used,memory.total,power.draw",
            "--format=csv,noheader,nounits",
        ]
        try:
            output = subprocess.run(
                command, capture_output=True, text=True, timeout=4, check=True
            ).stdout.strip().splitlines()[0]
            values = [float(value.strip()) for value in output.split(",")]
            return {
                "gpuUtilPercent": values[0],
                "gpuMemoryUsedMb": values[1],
                "gpuMemoryTotalMb": values[2],
                "gpuPowerW": values[3],
            }
        except (OSError, subprocess.SubprocessError, ValueError, IndexError):
            return {}

    def _run(self) -> None:
        previous_disk = psutil.disk_io_counters() if psutil else None
        previous_time = time.monotonic()
        while not self._stop.is_set():
            now = time.monotonic()
            sample: dict[str, float] = {"elapsedSeconds": now - previous_time}
            if psutil:
                sample["cpuUtilPercent"] = psutil.cpu_percent(interval=None)
                sample["memoryUtilPercent"] = psutil.virtual_memory().percent
                current_disk = psutil.disk_io_counters()
                if current_disk and previous_disk:
                    seconds = max(0.001, now - previous_time)
                    sample["diskReadMbPerSecond"] = (
                        current_disk.read_bytes - previous_disk.read_bytes
                    ) / seconds / 1_048_576
                    sample["diskWriteMbPerSecond"] = (
                        current_disk.write_bytes - previous_disk.write_bytes
                    ) / seconds / 1_048_576
                previous_disk = current_disk
            sample.update(self._gpu_sample())
            self.samples.append(sample)
            previous_time = now
            self._stop.wait(self.interval)


def summarize_samples(samples: list[dict[str, float]]) -> dict[str, object]:
    keys = (
        "cpuUtilPercent",
        "memoryUtilPercent",
        "gpuUtilPercent",
        "gpuMemoryUsedMb",
        "gpuPowerW",
        "diskReadMbPerSecond",
        "diskWriteMbPerSecond",
    )
    summary: dict[str, object] = {"sampleCount": len(samples)}
    for key in keys:
        values = [sample[key] for sample in samples if key in sample]
        if values:
            summary[key] = {
                "average": round(statistics.fmean(values), 2),
                "peak": round(max(values), 2),
            }
    pressure = {}
    for label, key in (
        ("CPU", "cpuUtilPercent"),
        ("GPU", "gpuUtilPercent"),
        ("内存", "memoryUtilPercent"),
    ):
        metric = summary.get(key)
        if isinstance(metric, dict):
            pressure[label] = float(metric["average"])
    pressure_total = sum(pressure.values())
    if pressure_total:
        summary["relativeLoadSharePercent"] = {
            label: round(value / pressure_total * 100, 1) for label, value in pressure.items()
        }
        summary["relativeLoadShareDefinition"] = "CPU/GPU/内存平均利用率归一化，仅表示资源压力占比"
    return summary


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--remover", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    clean_dir = args.output_root / "02_去字后素材"
    report_dir = args.output_root / "04_分析报告"
    log_dir = report_dir / "去字日志"
    clean_dir.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)
    batch_started = time.perf_counter()
    records: list[dict[str, object]] = []
    all_samples: list[dict[str, float]] = []

    for item in config["items"]:
        item_id = str(item["id"])
        source = Path(str(item["source"]))
        output = clean_dir / f"{item_id}_去字母版_1080x1920_30fps_静音.mp4"
        source_before = source.stat()
        source_hash_before = sha256_file(source)
        started = time.perf_counter()
        record: dict[str, object] = {
            "id": item_id,
            "source": str(source),
            "output": str(output),
            "sourceSizeBytes": source_before.st_size,
            "sourceMtimeNsBefore": source_before.st_mtime_ns,
            "sourceSha256Before": source_hash_before,
        }
        if item.get("cacheSource"):
            shutil.copy2(Path(str(item["cacheSource"])), output)
            record["action"] = "cache_hit_copy"
            record["resource"] = {"sampleCount": 0}
        else:
            manual_path: Path | None = None
            if item.get("manualZones"):
                manual_path = log_dir / f"{item_id}_手工定时区.json"
                manual_path.write_text(
                    json.dumps(item["manualZones"], ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            command = [
                str(args.python),
                str(args.remover),
                "--input", str(source),
                "--output", str(output),
                "--ffmpeg", str(args.ffmpeg),
                "--engine", "lama",
                "--analysis-width", "540",
                "--width", "1080",
                "--fps", "30",
                "--scan-full-frame",
                "--process-ranges", str(item.get("processRanges", "")),
                "--keep-ranges", str(item.get("processRanges", "")),
            ]
            if manual_path:
                command.extend(["--manual-zones-json", str(manual_path)])
            sampler = ResourceSampler()
            sampler.start()
            log_path = log_dir / f"{item_id}.log"
            with log_path.open("w", encoding="utf-8") as log_file:
                result = subprocess.run(
                    command,
                    stdout=log_file,
                    stderr=subprocess.STDOUT,
                    text=True,
                )
            sampler.stop()
            all_samples.extend(sampler.samples)
            record["action"] = "lama_inpaint"
            record["exitCode"] = result.returncode
            record["resource"] = summarize_samples(sampler.samples)
            record["log"] = str(log_path)
            if result.returncode != 0:
                raise RuntimeError(f"{item_id} failed; inspect {log_path}")
        source_after = source.stat()
        source_hash_after = sha256_file(source)
        record["sourceMtimeNsAfter"] = source_after.st_mtime_ns
        record["sourceSha256After"] = source_hash_after
        record["sourceUnchanged"] = (
            source_before.st_size == source_after.st_size
            and source_before.st_mtime_ns == source_after.st_mtime_ns
            and source_hash_before == source_hash_after
        )
        record["wallSeconds"] = round(time.perf_counter() - started, 3)
        record["outputSizeBytes"] = output.stat().st_size
        records.append(record)
        print(json.dumps({"completed": item_id, "wallSeconds": record["wallSeconds"]}, ensure_ascii=False), flush=True)

    elapsed = time.perf_counter() - batch_started
    report = {
        "batchId": config["batchId"],
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "batchWallSeconds": round(elapsed, 3),
        "oneTimeEnvironmentSetupExcluded": True,
        "items": records,
        "aggregateResource": summarize_samples(all_samples),
    }
    report_path = report_dir / "去字性能统计.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(report_path), "batchWallSeconds": report["batchWallSeconds"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
