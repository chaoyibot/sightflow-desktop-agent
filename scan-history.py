# -*- coding: utf-8 -*-
"""扫描所有 commit 的 index.ts，追踪 apiKey 演变"""
import subprocess, re

repo = r"C:\Users\Administrator\sightflow-desktop-agent"
r = subprocess.run(["git", "log", "--format=%H", "--", "src/main/index.ts"],
                   cwd=repo, capture_output=True, text=True)
shas = [s for s in r.stdout.strip().split("\n") if s]

UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

for sha in reversed(shas):  # 从旧到新
    r2 = subprocess.run(["git", "show", f"{sha}:src/main/index.ts"],
                        cwd=repo, capture_output=True)
    if r2.returncode != 0:
        continue
    text = r2.stdout.decode("utf-8", errors="replace")
    keys = re.findall(r"apiKey:\s*'([^']*)'", text)
    uuids = [k for k in keys if UUID_RE.fullmatch(k)]
    sk_keys = [k for k in keys if k.startswith("sk-")]
    placeholders = [k for k in keys if "..." in k or "\u2026" in k]
    summary = f"sha={sha[:10]} | keys={len(keys)} | uuid={len(uuids)} | sk={len(sk_keys)} | placeholder={len(placeholders)}"
    if uuids:
        summary += f" | UUID1={uuids[0][:13]}..."
    print(summary)
