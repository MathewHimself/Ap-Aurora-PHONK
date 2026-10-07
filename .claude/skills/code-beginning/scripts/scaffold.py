#!/usr/bin/env python3
"""Создаёт каркас проекта по структуре Code beginning.

Использование:
    python3 scaffold.py <папка-проекта> ["Название проекта"]

Существующие файлы не перезаписываются: скрипт добавляет только недостающие.
"""
import shutil
import sys
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "assets" / "template"


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    target = Path(sys.argv[1]).resolve()
    title = sys.argv[2] if len(sys.argv) > 2 else target.name

    created, skipped = [], []
    for src in sorted(TEMPLATE.rglob("*")):
        rel = src.relative_to(TEMPLATE)
        dst = target / rel
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
            continue
        if dst.exists():
            skipped.append(str(rel))
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.suffix in {".html", ".css", ".js"}:
            dst.write_text(src.read_text(encoding="utf-8").replace("{{PROJECT_TITLE}}", title), encoding="utf-8")
        else:
            shutil.copy2(src, dst)
        created.append(str(rel))

    print(f"Проект: {target}")
    for f in created:
        print(f"  + {f}")
    for f in skipped:
        print(f"  = {f} (уже есть, не тронут)")


if __name__ == "__main__":
    main()
