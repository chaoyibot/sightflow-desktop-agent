# -*- coding: utf-8 -*-
"""从 516dfa914c 恢复真实 API key，修复工作区文件中的占位符"""
import subprocess, re

repo = r"C:\Users\Administrator\sightflow-desktop-agent"
GOOD_SHA = "516dfa914c"

# 1) 从好版本提取真实 key
r = subprocess.run(["git", "show", f"{GOOD_SHA}:src/main/index.ts"],
                   cwd=repo, capture_output=True)
good = r.stdout.decode("utf-8", errors="replace")
keys = re.findall(r"apiKey:\s*'([^']*)'", good)
print("good version keys:", [(len(k), k[:12]) for k in keys])

# 按块提取（DOUBAO_VISION 块在 AGNES_FALLBACK 块之前，共有 2 组配置）
doubao_keys = re.findall(r"const DOUBAO_VISION = \{\s*apiKey: '([^']*)'", good)
agnes_keys = re.findall(r"const AGNES_FALLBACK = \{\s*apiKey: '([^']*)'", good)
print("doubao keys found:", len(doubao_keys), "| agnes keys found:", len(agnes_keys))

if not doubao_keys or not agnes_keys:
    print("FAILED: cannot extract real keys")
    raise SystemExit(1)

real_doubao = doubao_keys[0]
real_agnes = agnes_keys[0]

# 2) 修复当前工作区文件：按块替换
path = repo + r"\src\main\index.ts"
with open(path, encoding="utf-8") as f:
    src = f.read()

def fix_block(src, const_name, real_key):
    pattern = re.compile(r"(" + const_name + r" = \{\s*apiKey: ')([^']*)(')")
    return pattern.sub(lambda m: m.group(1) + real_key + m.group(3), src)

src2 = fix_block(src, "const DOUBAO_VISION", real_doubao)
src2 = fix_block(src2, "const AGNES_FALLBACK", real_agnes)

with open(path, "w", encoding="utf-8") as f:
    f.write(src2)

# 3) 验证
with open(path, encoding="utf-8") as f:
    v = f.read()
db = re.findall(r"const DOUBAO_VISION = \{\s*apiKey: '([^']*)'", v)
ag = re.findall(r"const AGNES_FALLBACK = \{\s*apiKey: '([^']*)'", v)
print("after fix: doubao blocks:", [(len(k), k[:12]) for k in db])
print("after fix: agnes blocks:", [(len(k), k[:12]) for k in ag])
placeholder_left = v.count("74f1d...e7") + v.count("\u00abreda")
print("placeholders left:", placeholder_left)
assert placeholder_left == 0, "placeholders still present!"
assert all(len(k) >= 30 for k in db + ag), "keys still too short!"
print("FIXED OK")
