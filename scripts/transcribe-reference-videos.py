import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main() -> int:
    if len(sys.argv) < 3:
        raise SystemExit("usage: transcribe-reference-videos.py OUTPUT_DIR AUDIO...")

    output_dir = Path(sys.argv[1])
    output_dir.mkdir(parents=True, exist_ok=True)
    model = WhisperModel("small", device="cpu", compute_type="int8", local_files_only=True)
    prompt = "服装穿搭测评，裤子，腿型，口粮长裤，恶魔之眼鳞纹，夯还是拉，种草，面料，版型，上身"

    for raw_path in sys.argv[2:]:
        audio_path = Path(raw_path)
        segments, info = model.transcribe(
            str(audio_path),
            language="zh",
            beam_size=5,
            best_of=5,
            vad_filter=True,
            word_timestamps=True,
            initial_prompt=prompt,
        )
        rows = []
        transcript = []
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            transcript.append(text)
            rows.append(
                {
                    "start": round(segment.start, 3),
                    "end": round(segment.end, 3),
                    "text": text,
                    "avgLogProb": round(segment.avg_logprob, 4),
                    "noSpeechProb": round(segment.no_speech_prob, 4),
                    "words": [
                        {
                            "start": round(word.start, 3) if word.start is not None else None,
                            "end": round(word.end, 3) if word.end is not None else None,
                            "word": word.word,
                            "probability": round(word.probability, 4),
                        }
                        for word in (segment.words or [])
                    ],
                }
            )

        result = {
            "source": str(audio_path),
            "language": info.language,
            "languageProbability": round(info.language_probability, 4),
            "duration": round(info.duration, 3),
            "segments": rows,
            "text": "".join(transcript),
        }
        output_base = output_dir / audio_path.stem
        output_base.with_suffix(".json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        output_base.with_suffix(".txt").write_text(
            "\n".join(f"[{row['start']:06.2f}-{row['end']:06.2f}] {row['text']}" for row in rows),
            encoding="utf-8",
        )
        print(json.dumps({"file": str(audio_path), "segments": len(rows), "textLength": len(result["text"])}, ensure_ascii=False), flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
