# -*- coding: utf-8 -*-
"""直接打印好版本 engine:start 附近代码"""
import subprocess

repo = r"C:\Users\Administrator\sightflow-desktop-agent"
r = subprocess.run(["git", "show", "516dfa914c:src/main/index.ts"],
                   cwd=repo, capture_output=True)
good = r.stdout.decode("utf-8", errors="replace")
lines = good.split("\n")
for i, line in enumerate(lines):
    if "LocalHooks" in line or "visionModel" in line or "ai: {" in line or "hermesMode" in line:
        start = max(0, i - 2)
        end = min(len(lines), i + 3)
        print(f"--- line {i+1} ---")
        print("\n".join(lines[start:end]))
        print()
