#!/usr/bin/env python3
"""Remove moving white/yellow, dark-outlined captions from vertical product video.

The detector intentionally masks glyphs instead of a full subtitle rectangle so
garment silhouettes and fabric texture receive the smallest possible repair.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

import cv2
import numpy as np


def create_lama_model():
    model_path = os.environ.get("LAMA_MODEL")
    if not model_path:
        from simple_lama_inpainting import SimpleLama

        return SimpleLama()

    import torch
    from PIL import Image
    from simple_lama_inpainting.utils.util import prepare_img_and_mask

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    with open(model_path, "rb") as model_file:
        model = torch.jit.load(model_file, map_location=device)
    model.eval()
    model.to(device)

    class LocalSimpleLama:
        def __call__(self, image: Image.Image | np.ndarray, mask: Image.Image | np.ndarray):
            prepared_image, prepared_mask = prepare_img_and_mask(image, mask, device)
            with torch.inference_mode():
                inpainted = model(prepared_image, prepared_mask)
                result = inpainted[0].permute(1, 2, 0).detach().cpu().numpy()
                result = np.clip(result * 255, 0, 255).astype(np.uint8)
                return Image.fromarray(result)

    return LocalSimpleLama()


def _odd(value: int) -> int:
    return value if value % 2 else value + 1


def detect_caption_mask(
    frame: np.ndarray,
    time_s: float,
    scan_full_frame: bool = False,
) -> tuple[np.ndarray, list[tuple[int, int, int, int]]]:
    height, width = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    b, g, r = cv2.split(frame)
    channel_max = np.maximum(np.maximum(b, g), r)
    channel_min = np.minimum(np.minimum(b, g), r)

    # Captions in this source are white/near-white or pale yellow with a thick,
    # near-black outline. Requiring nearby dark pixels rejects most walls/rugs.
    white = (channel_min >= 168) & ((channel_max - channel_min) <= 52)
    yellow = (
        (hsv[:, :, 0] >= 12)
        & (hsv[:, :, 0] <= 42)
        & (hsv[:, :, 1] >= 65)
        & (hsv[:, :, 2] >= 145)
    )
    dark = (gray <= 92).astype(np.uint8) * 255
    dark_radius = max(5, round(width * 0.009))
    dark_near = cv2.dilate(
        dark,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (_odd(dark_radius), _odd(dark_radius))),
    ) > 0
    core = ((white | yellow) & dark_near).astype(np.uint8) * 255

    # Outside the intro, all useful captions are in the lower 68% of frame.
    # The intro is retained for completeness but is marked low-reuse in report.
    allowed = np.zeros_like(core)
    top = 0 if scan_full_frame or time_s < 2.85 else int(height * 0.32)
    allowed[top : int(height * 0.965), :] = 255
    core = cv2.bitwise_and(core, allowed)

    # Caption rows have a much stronger horizontal concentration of outlined
    # bright pixels than garment/rug detail. This projection also joins phrases
    # separated by large spaces, which contour-only detection tends to miss.
    row_counts = np.count_nonzero(core, axis=1).astype(np.float32)
    row_window = _odd(max(5, round(height * 0.007)))
    row_signal = np.convolve(row_counts, np.ones(row_window) / row_window, mode="same")
    active_rows = (row_signal > max(18.0, width * 0.059)).astype(np.uint8) * 255
    active_rows = cv2.morphologyEx(
        active_rows.reshape(-1, 1),
        cv2.MORPH_CLOSE,
        np.ones((max(7, round(height * 0.014)), 1), np.uint8),
    ).ravel()

    row_bands: list[tuple[int, int, float]] = []
    start: int | None = None
    for index, active in enumerate(active_rows):
        if active and start is None:
            start = index
        if start is not None and (not active or index == height - 1):
            end = index if not active else index + 1
            band_height = end - start
            if height * 0.012 <= band_height <= height * 0.15:
                row_bands.append((start, end, float(row_counts[start:end].sum())))
            start = None
    row_bands = sorted(row_bands, key=lambda item: item[2], reverse=True)[:4]

    boxes: list[tuple[int, int, int, int]] = []
    for y0, y1, _ in sorted(row_bands):
        column_counts = np.count_nonzero(core[y0:y1, :], axis=0).astype(np.float32)
        column_signal = np.convolve(column_counts, np.ones(5) / 5, mode="same")
        active_columns = (column_signal > 0.8).astype(np.uint8) * 255
        active_columns = cv2.morphologyEx(
            active_columns.reshape(1, -1),
            cv2.MORPH_CLOSE,
            np.ones((1, max(21, round(width * 0.065))), np.uint8),
        ).ravel()
        x_start: int | None = None
        for x_index, active in enumerate(active_columns):
            if active and x_start is None:
                x_start = x_index
            if x_start is not None and (not active or x_index == width - 1):
                x_end = x_index if not active else x_index + 1
                if x_end - x_start >= width * 0.16:
                    boxes.append((x_start, y0, x_end - x_start, y1 - y0))
                x_start = None

    # Keep only the caption glyphs and their black outline, not the whole line.
    outline_radius = _odd(max(17, round(width * 0.032)))
    expanded_core = cv2.dilate(
        core,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (outline_radius, outline_radius)),
    )
    mask = np.zeros_like(core)
    pad_x = max(5, round(width * 0.012))
    pad_y = max(5, round(height * 0.008))
    expanded_boxes: list[tuple[int, int, int, int]] = []
    for x, y, w, h in boxes:
        x0 = max(0, x - pad_x)
        y0 = max(0, y - pad_y)
        x1 = min(width, x + w + pad_x)
        y1 = min(height, y + h + pad_y)
        mask[y0:y1, x0:x1] = expanded_core[y0:y1, x0:x1]
        expanded_boxes.append((x0, y0, x1 - x0, y1 - y0))

    return mask, expanded_boxes


def remove_captions(
    frame: np.ndarray,
    time_s: float,
    scan_full_frame: bool = False,
) -> tuple[np.ndarray, np.ndarray, list[tuple[int, int, int, int]]]:
    mask, boxes = detect_caption_mask(frame, time_s, scan_full_frame)
    cleaned = frame.copy()
    height, width = frame.shape[:2]
    crop_pad = max(18, round(width * 0.025))
    for x, y, w, h in boxes:
        x0 = max(0, x - crop_pad)
        y0 = max(0, y - crop_pad)
        x1 = min(width, x + w + crop_pad)
        y1 = min(height, y + h + crop_pad)
        local_mask = mask[y0:y1, x0:x1]
        if cv2.countNonZero(local_mask) == 0:
            continue
        cleaned[y0:y1, x0:x1] = cv2.inpaint(
            cleaned[y0:y1, x0:x1], local_mask, max(3, round(width * 0.005)), cv2.INPAINT_TELEA
        )
    return cleaned, mask, boxes


def _rectangular_caption_mask(shape: tuple[int, int], boxes: list[tuple[int, int, int, int]]) -> np.ndarray:
    height, width = shape
    mask = np.zeros((height, width), np.uint8)
    # Animated captions often have a bright cursor/block just beyond the last
    # outlined glyph. A wider horizontal pad removes that tail as one overlay.
    pad_x = max(10, round(width * 0.045))
    pad_y = max(5, round(height * 0.007))
    for x, y, w, h in boxes:
        cv2.rectangle(
            mask,
            (max(0, x - pad_x), max(0, y - pad_y)),
            (min(width - 1, x + w + pad_x), min(height - 1, y + h + pad_y)),
            255,
            -1,
        )
    return mask


def _manual_zone_masks(
    frame: np.ndarray,
    time_s: float,
    zones: list[dict[str, object]],
) -> tuple[np.ndarray, list[tuple[int, int, int, int]]]:
    """Build masks for timed overlays that the generic outlined-text detector misses."""
    height, width = frame.shape[:2]
    mask = np.zeros((height, width), np.uint8)
    boxes: list[tuple[int, int, int, int]] = []
    for zone in zones:
        if not (float(zone["start"]) <= time_s < float(zone["end"])):
            continue
        x0 = max(0, min(width - 1, round(float(zone["x0"]) * width)))
        y0 = max(0, min(height - 1, round(float(zone["y0"]) * height)))
        x1 = max(x0 + 1, min(width, round(float(zone["x1"]) * width)))
        y1 = max(y0 + 1, min(height, round(float(zone["y1"]) * height)))
        boxes.append((x0, y0, x1 - x0, y1 - y0))
        mode = str(zone.get("mode", "bright"))
        if mode == "rect":
            mask[y0:y1, x0:x1] = 255
            continue

        crop = frame[y0:y1, x0:x1]
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        channel_min = crop.min(axis=2)
        channel_max = crop.max(axis=2)
        white = (channel_min >= 150) & ((channel_max - channel_min) <= 72)
        yellow = (
            (hsv[:, :, 0] >= 10)
            & (hsv[:, :, 0] <= 45)
            & (hsv[:, :, 1] >= 55)
            & (hsv[:, :, 2] >= 140)
        )
        candidates = white | yellow
        if mode == "outlined":
            # The second-pass model region can be imprecise. Requiring a dark
            # neighbour keeps white/yellow outlined captions while avoiding
            # bright garment fibres, floors and carpets inside the wider zone.
            dark = (channel_max <= 112).astype(np.uint8) * 255
            neighbour_radius = _odd(max(5, round(width * 0.011)))
            dark_near = cv2.dilate(
                dark,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (neighbour_radius, neighbour_radius)),
            ) > 0
            candidates = candidates & dark_near
            # Captions form dense horizontal rows. Suppress isolated bright
            # garment seams/highlights that happen to have a dark neighbour.
            row_counts = candidates.sum(axis=1)
            active_rows = (row_counts >= max(6, round(crop.shape[1] * 0.012))).astype(np.uint8)
            active_rows = cv2.dilate(active_rows[:, None], np.ones((9, 1), np.uint8))[:, 0] > 0
            candidates = candidates & active_rows[:, None]
        local = (candidates.astype(np.uint8) * 255)
        # Douyin captions often use a very thick black stroke. The mask must
        # cover that stroke as well as the bright glyph core; otherwise the
        # inpainted frame keeps a black letter-shaped residue.
        radius = _odd(max(15, round(width * 0.045)))
        local = cv2.dilate(
            local,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius, radius)),
        )
        mask[y0:y1, x0:x1] = cv2.bitwise_or(mask[y0:y1, x0:x1], local)
    return mask, boxes


def remove_captions_manual_opencv(
    frame: np.ndarray,
    time_s: float,
    manual_zones: list[dict[str, object]],
) -> tuple[np.ndarray, np.ndarray, list[tuple[int, int, int, int]]]:
    """Fast glyph-only fallback for explicitly timed caption zones."""
    mask, boxes = _manual_zone_masks(frame, time_s, manual_zones)
    if not cv2.countNonZero(mask):
        return frame, mask, []
    cleaned = cv2.inpaint(frame, mask, 5, cv2.INPAINT_TELEA)
    return cleaned, mask, boxes


def remove_captions_lama(
    frame: np.ndarray,
    time_s: float,
    lama: object,
    analysis_width: int = 540,
    scan_full_frame: bool = False,
    manual_zones: list[dict[str, object]] | None = None,
    manual_only: bool = False,
) -> tuple[np.ndarray, np.ndarray, list[tuple[int, int, int, int]]]:
    """Run LaMa on a small analysis crop, then blend only the repaired band at output resolution."""
    from PIL import Image

    output_height, output_width = frame.shape[:2]
    analysis_height = round(output_height * analysis_width / output_width)
    analysis = cv2.resize(frame, (analysis_width, analysis_height), interpolation=cv2.INTER_AREA)
    boxes = [] if manual_only else detect_caption_mask(analysis, time_s, scan_full_frame)[1]
    manual_mask, manual_boxes = _manual_zone_masks(analysis, time_s, manual_zones or [])
    boxes.extend(manual_boxes)
    if not boxes:
        return frame, np.zeros(frame.shape[:2], np.uint8), []

    small_mask = manual_mask.copy() if manual_only else _rectangular_caption_mask(analysis.shape[:2], boxes)
    if not manual_only and cv2.countNonZero(manual_mask):
        # Manual bright-pixel zones deliberately override the rectangular mask
        # inside those zones so nearby garment/background texture is preserved.
        for x, y, w, h in manual_boxes:
            small_mask[y : y + h, x : x + w] = manual_mask[y : y + h, x : x + w]
    if not cv2.countNonZero(small_mask):
        return frame, np.zeros(frame.shape[:2], np.uint8), []
    x0 = max(0, min(box[0] for box in boxes) - round(analysis_width * 0.12))
    y0 = max(0, min(box[1] for box in boxes) - round(analysis_width * 0.12))
    x1 = min(analysis_width, max(box[0] + box[2] for box in boxes) + round(analysis_width * 0.12))
    y1 = min(analysis_height, max(box[1] + box[3] for box in boxes) + round(analysis_width * 0.12))
    crop = analysis[y0:y1, x0:x1]
    crop_mask = small_mask[y0:y1, x0:x1]
    rgb_crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
    repaired = np.asarray(lama(Image.fromarray(rgb_crop), Image.fromarray(crop_mask)))
    repaired = repaired[: crop.shape[0], : crop.shape[1]]
    repaired = cv2.cvtColor(repaired, cv2.COLOR_RGB2BGR)

    scale_x = output_width / analysis_width
    scale_y = output_height / analysis_height
    out_x0, out_y0 = round(x0 * scale_x), round(y0 * scale_y)
    out_x1, out_y1 = round(x1 * scale_x), round(y1 * scale_y)
    out_x1, out_y1 = min(output_width, out_x1), min(output_height, out_y1)
    target_w, target_h = out_x1 - out_x0, out_y1 - out_y0
    repaired_large = cv2.resize(repaired, (target_w, target_h), interpolation=cv2.INTER_CUBIC)
    alpha = cv2.resize(crop_mask, (target_w, target_h), interpolation=cv2.INTER_NEAREST)
    blur_size = _odd(max(5, round(output_width * 0.009)))
    alpha = cv2.GaussianBlur(alpha, (blur_size, blur_size), 0).astype(np.float32) / 255.0
    alpha = alpha[:, :, None]
    cleaned = frame.copy()
    original_patch = cleaned[out_y0:out_y1, out_x0:out_x1].astype(np.float32)
    blended = repaired_large.astype(np.float32) * alpha + original_patch * (1.0 - alpha)
    cleaned[out_y0:out_y1, out_x0:out_x1] = np.clip(blended, 0, 255).astype(np.uint8)

    full_mask = cv2.resize(small_mask, (output_width, output_height), interpolation=cv2.INTER_NEAREST)
    scaled_boxes = [
        (round(x * scale_x), round(y * scale_y), round(w * scale_x), round(h * scale_y))
        for x, y, w, h in boxes
    ]
    return cleaned, full_mask, scaled_boxes


def write_previews(
    input_path: Path,
    output_dir: Path,
    timestamps: list[float],
    width: int,
    scan_full_frame: bool = False,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(input_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open input: {input_path}")
    for time_s in timestamps:
        capture.set(cv2.CAP_PROP_POS_MSEC, time_s * 1000)
        ok, frame = capture.read()
        if not ok:
            raise RuntimeError(f"Cannot read frame at {time_s:.3f}s")
        target_height = round(frame.shape[0] * width / frame.shape[1])
        frame = cv2.resize(frame, (width, target_height), interpolation=cv2.INTER_AREA)
        cleaned, mask, boxes = remove_captions(frame, time_s, scan_full_frame)
        overlay = frame.copy()
        overlay[mask > 0] = (32, 32, 235)
        overlay = cv2.addWeighted(frame, 0.52, overlay, 0.48, 0)
        for x, y, w, h in boxes:
            cv2.rectangle(overlay, (x, y), (x + w, y + h), (20, 220, 255), 2)
        triptych = np.hstack([frame, overlay, cleaned])
        cv2.imwrite(str(output_dir / f"preview_{time_s:05.2f}.jpg"), triptych, [cv2.IMWRITE_JPEG_QUALITY, 94])
    capture.release()


def _parse_ranges(value: str) -> list[tuple[float, float]]:
    ranges: list[tuple[float, float]] = []
    for item in value.split(","):
        if not item.strip():
            continue
        start, end = item.split("-", 1)
        ranges.append((float(start), float(end)))
    return ranges


def process_video(
    input_path: Path,
    output_path: Path,
    ffmpeg_path: Path,
    width: int,
    fps: float,
    engine: str,
    analysis_width: int,
    process_ranges: list[tuple[float, float]],
    keep_ranges: list[tuple[float, float]],
    scan_full_frame: bool,
    manual_zones: list[dict[str, object]],
    manual_only: bool,
) -> None:
    capture = cv2.VideoCapture(str(input_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open input: {input_path}")
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 60.0
    source_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    source_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    height = round(source_height * width / source_width)
    if height % 2:
        height += 1
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(ffmpeg_path), "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}",
        "-r", f"{fps:.6f}", "-i", "-", "-an", "-c:v", "libx264",
        "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(output_path),
    ]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    lama = None
    if engine == "lama":
        lama = create_lama_model()
    if not keep_ranges:
        duration_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = duration_frames / source_fps if duration_frames else float("inf")
        keep_ranges = [(0.0, duration)]
    frame_index = 0
    output_index = 0
    keep_index = 0
    range_output_index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            time_s = frame_index / source_fps
            while keep_index < len(keep_ranges) and time_s >= keep_ranges[keep_index][1]:
                keep_index += 1
                range_output_index = 0
            if keep_index >= len(keep_ranges):
                break
            keep_start, keep_end = keep_ranges[keep_index]
            next_source_time = keep_start + range_output_index / fps
            frame_due = (
                keep_start <= time_s < keep_end
                and next_source_time < keep_end
                and next_source_time <= time_s + 0.5 / source_fps
            )
            if frame_due:
                resized = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
                should_process = not process_ranges or any(start <= time_s < end for start, end in process_ranges)
                if should_process and engine == "lama":
                    cleaned, _, _ = remove_captions_lama(
                        resized,
                        time_s,
                        lama,
                        analysis_width,
                        scan_full_frame,
                        manual_zones,
                        manual_only,
                    )
                elif should_process and manual_only:
                    cleaned, _, _ = remove_captions_manual_opencv(resized, time_s, manual_zones)
                elif should_process:
                    cleaned, _, _ = remove_captions(resized, time_s, scan_full_frame)
                else:
                    cleaned = resized
                assert encoder.stdin is not None
                while next_source_time < keep_end and next_source_time <= time_s + 0.5 / source_fps:
                    encoder.stdin.write(cleaned.tobytes())
                    output_index += 1
                    range_output_index += 1
                    next_source_time = keep_start + range_output_index / fps
                if output_index % 30 == 0:
                    print(f"progress_frames={output_index} time={time_s:.2f}s", flush=True)
            frame_index += 1
    finally:
        capture.release()
        if encoder.stdin:
            encoder.stdin.close()
    return_code = encoder.wait()
    if return_code != 0:
        raise RuntimeError(f"FFmpeg encoder failed with exit code {return_code}")
    print(f"processed_frames={output_index} output={output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--ffmpeg", type=Path)
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--engine", choices=("opencv", "lama"), default="opencv")
    parser.add_argument("--analysis-width", type=int, default=540)
    parser.add_argument("--process-ranges", default="")
    parser.add_argument("--keep-ranges", default="")
    parser.add_argument("--scan-full-frame", action="store_true")
    parser.add_argument("--manual-zones-json", type=Path)
    parser.add_argument(
        "--manual-only",
        action="store_true",
        help="Disable automatic caption detection and repair only the configured manual zones.",
    )
    parser.add_argument("--preview-dir", type=Path)
    parser.add_argument("--preview-times", default="3.5,6.3,8.4,9.8,10.7,12.7,14.45,16.55,17.35")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manual_zones: list[dict[str, object]] = []
    if args.manual_zones_json:
        manual_zones = json.loads(args.manual_zones_json.read_text(encoding="utf-8"))
    timestamps = [float(value) for value in args.preview_times.split(",") if value.strip()]
    if args.preview_dir:
        write_previews(
            args.input,
            args.preview_dir,
            timestamps,
            min(args.width, 540),
            args.scan_full_frame,
        )
    if args.output:
        if not args.ffmpeg:
            raise SystemExit("--ffmpeg is required when --output is used")
        process_video(
            args.input,
            args.output,
            args.ffmpeg,
            args.width,
            args.fps,
            args.engine,
            args.analysis_width,
            _parse_ranges(args.process_ranges),
            _parse_ranges(args.keep_ranges),
            args.scan_full_frame,
            manual_zones,
            args.manual_only,
        )
    if not args.preview_dir and not args.output:
        raise SystemExit("Provide --preview-dir and/or --output")


if __name__ == "__main__":
    main()
