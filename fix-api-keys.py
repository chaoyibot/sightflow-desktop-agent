# -*- coding: utf-8 -*-
"""修复 startEngine 中的 API Key 占位符（从 updateConfig 处提取真实值替换）"""
import re

path = r"C:\Users\Administrator\sightflow-desktop-agent\src\main\index.ts"
with open(path, encoding="utf-8") as f:
    src = f.read()

# updateConfig 处的 DOUBAO_VISION 是真实的（未修改过）
m = re.search(r"const DOUBAO_VISION = \{\s*apiKey: '([^']+)'", src)
doubao_key = m.group(1) if m else None
m2 = re.search(r"const AGNES_FALLBACK = \{\s*apiKey: '([^']+)'", src)
agnes_key = m2.group(1) if m2 else None

print("doubao_key_len:", len(doubao_key) if doubao_key else "NOT FOUND")
print("agnes_key_len:", len(agnes_key) if agnes_key else "NOT FOUND")

fake_patterns = ["74f1d...e7", "\u00abreda...\u2026\u00bb"]
counts = {p: src.count(p) for p in fake_patterns}
print("fake placeholders:", counts)

if doubao_key and agnes_key:
    src2 = src.replace("74f1d...e7", doubao_key).replace("\u00abreda...\u2026\u00bb", agnes_key)
    with open(path, "w", encoding="utf-8") as f:
        f.write(src2)
    with open(path, encoding="utf-8") as f:
        v = f.read()
    remaining = [p for p in fake_patterns if p in v]
    print("remaining placeholders:", remaining)
    print(f"real doubao occurrences: {v.count(doubao_key)}")
    print(f"real agnes occurrences: {v.count(agnes_key)}")
    print("DONE")
else:
    print("FAILED to find real keys")
