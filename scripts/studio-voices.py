"""Озвучивает реплики для FamilyQuest через локальный Speech Studio (Higgs Audio v3).

Запуск:  python scripts/studio-voices.py [--speaker papa] [--limit N] [--dry]

Что делает:
 1. создаёт проект в студии на каждого говорящего;
 2. ставит блоки с репликами и голосом;
 3. запускает синтез, ждёт задание;
 4. экспортирует посегментно (per_block) в wav;
 5. копирует файлы в public/audio/voice с именами <событие>-<линия>-<говорящий>.mp3.

Линии: 1 — первая реплика из пары, 2 — вторая. Каждый участник слышит двух других:
папа говорит первую линию, мама — обе, Алёша — вторую (покрывает все пары слушателей).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8797"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "audio" / "voice"
STUDIO_WORKSPACE = Path(r"E:\Программы\Speech Studio\workspace")

VOICE = {"papa": "Евгений Яковлев", "mama": "Мама", "alyosha": "Алёша"}
DISPLAY = {"papa": "Папа", "mama": "Мама", "alyosha": "Алёша"}
LINES = {"papa": [1], "mama": [1, 2], "alyosha": [2]}

PHRASES: dict[str, list[str]] = {
    "task_done": ["Вот это да!", "Как у тебя это получилось?"],
    "task_claimed": ["Вот это задачка!", "Ну попробуй!"],
    "task_approved": ["Умничка!", "Всё сделано!"],
    "task_rejected": ["Не жульничай!", "Так это не делается!"],
    "task_late": ["Лучше поздно, чем никогда!", "Главное, что готово!"],
    "level_up": ["У тебя новый уровень!", "Поздравляю!"],
    "achievement": ["Новый значок, круто!", "Неплохо смотрится!"],
    "streak_7": ["Семь бед — один ответ!", "Целую неделю! Это характер!"],
    "daily_reminder": ["Не забудь, время подходит!", "Осталось так мало времени!"],
}

# Настройки качества Higgs Audio v3: чуть ниже температура — стабильнее произношение,
# фиксированное зерно — воспроизводимость, автоударения включены (важно для русского).
SETTINGS_PATCH = {
    "lang": "ru",
    "engine": "higgs",
    "voice": None,
    "auto_stress": True,
    "normalize": True,
    "loudness": "video",
    "qc": {
        "asr_check": False,
        "strictness": "normal",
        "takes": 1,
        "similarity": False,
        "heuristics": ["clipping", "length", "long_pause", "little_speech"],
    },
}
PARAMS = {
    "temperature": 0.7,
    "top_k": 30,
    "top_p": 0.85,
    "max_tokens": 0,
    "seed_mode": "fixed",
    "seed": 42,
    "steps": 8,
    "speed": 1.0,
}


def api(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"{method} {path} → {error.code}: {detail}") from error
    return json.loads(raw) if raw.strip() else {}


def wait_job(job_id: str, what: str, timeout: float = 900) -> dict:
    started = time.time()
    last_state = ""
    while time.time() - started < timeout:
        job = api("GET", f"/jobs/{job_id}")
        state = job.get("state") or job.get("status") or ""
        if state != last_state:
            print(f"    {what}: {state}")
            last_state = state
        if state in ("done", "completed", "ready", "failed", "error", "cancelled"):
            if state in ("failed", "error", "cancelled"):
                raise RuntimeError(f"{what} завершился со статусом {state}: {json.dumps(job, ensure_ascii=False)[:400]}")
            return job
        time.sleep(2)
    raise RuntimeError(f"{what}: не дождались за {timeout} с")


def new_block(text: str, speaker: str, index: int) -> dict:
    return {
        "id": f"fq{index:04d}" + str(int(time.time() * 1000))[-4:],
        "speaker": DISPLAY[speaker],
        "voice": VOICE[speaker],
        "text": text,
        "direction": "",
        "pause_ms": None,
        "hidden": False,
        "takes": [],
        "active": None,
        "pinned": None,
        "error": None,
        "note": "",
        "marker": "",
        "start": None,
        "end": None,
    }


def build_project(speaker: str, phrases: list[tuple[str, int, str]], dry: bool) -> str:
    created = api("POST", "/projects", {"kind": "speech", "name": f"familyquest-{speaker}"})
    project_id = created["project_id"]
    project = created["project"]
    print(f"  проект {project_id} для {DISPLAY[speaker]} ({len(phrases)} реплик)")

    if dry:
        return project_id

    settings = project["settings"]
    settings.update(SETTINGS_PATCH)
    settings["params"] = {**settings.get("params", {}), **PARAMS}
    settings["voice"] = VOICE[speaker]

    blocks = [new_block(text, speaker, index) for index, (_event, _line, text) in enumerate(phrases, start=1)]
    chapters = project.get("chapters") or [{"id": "chapter1", "title": "", "blocks": []}]
    chapters[0]["blocks"] = blocks
    project["chapters"] = chapters

    body = {key: value for key, value in project.items() if key != "status"}
    api("PUT", f"/projects/{project_id}", body)
    return project_id


def synth(project_id: str) -> None:
    result = api("POST", f"/projects/{project_id}/synth", {})
    job_id = result.get("job_id")
    if not job_id:
        raise RuntimeError(f"синтез не вернул job_id: {result}")
    print(f"  синтез: job {job_id}")
    wait_job(job_id, "синтез")


def export_wavs(project_id: str) -> list[Path]:
    result = api("POST", f"/projects/{project_id}/export", {"format": "wav", "per_block": True})
    job_id = result.get("job_id")
    if job_id:
        print(f"  экспорт: job {job_id}")
        wait_job(job_id, "экспорт")

    folder = STUDIO_WORKSPACE / project_id / "exports"
    deadline = time.time() + 60
    while time.time() < deadline:
        wavs = sorted(folder.rglob("*.wav")) if folder.exists() else []
        if wavs:
            return wavs
        time.sleep(1)
    return []


def to_mp3(wav: Path, target: Path) -> bool:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(wav, target.with_suffix(".wav"))
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--speaker", choices=["papa", "mama", "alyosha", "all"], default="all")
    parser.add_argument("--limit", type=int, default=0, help="сколько реплик на говорящего (0 — все)")
    parser.add_argument("--dry", action="store_true", help="только создать проекты, без синтеза")
    args = parser.parse_args()

    speakers = ["papa", "mama", "alyosha"] if args.speaker == "all" else [args.speaker]
    OUT.mkdir(parents=True, exist_ok=True)

    manifest_path = ROOT / "public" / "audio" / "voice" / "manifest.json"
    manifest = json.loads(manifest_path.read_text("utf-8")) if manifest_path.exists() else {}

    for speaker in speakers:
        phrases: list[tuple[str, int, str]] = []
        for event, pair in PHRASES.items():
            for line in LINES[speaker]:
                phrases.append((event, line, pair[line - 1]))
        if args.limit:
            phrases = phrases[: args.limit]

        print(f"\n=== {DISPLAY[speaker]} ({VOICE[speaker]}) ===")
        project_id = build_project(speaker, phrases, args.dry)
        if args.dry:
            continue

        synth(project_id)
        wavs = export_wavs(project_id)
        if not wavs:
            print("  ⚠ экспорт не дал файлов")
            continue

        print(f"  получено файлов: {len(wavs)}")
        for (event, line, text), wav in zip(phrases, wavs):
            name = f"{event}-{line}-{speaker}.wav"
            target = OUT / name
            shutil.copy2(wav, target)
            manifest[f"{event}-{line}-{speaker}"] = f"./audio/voice/{name}"
            print(f"    {name}  ← {text}")

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"\nманифест: {len(manifest)} реплик → {manifest_path.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        print(f"Ошибка: {error}", file=sys.stderr)
        sys.exit(1)
