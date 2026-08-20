# -*- coding: utf-8 -*-
"""对比 516dfa914c(好版本) 的 LocalHooks ai 配置写法"""
import subprocess, re

repo = r"C:\Users\Administrator\sightflow-desktop-agent"
r = subprocess.run(["git", "show", "516dfa914c:src/main/index.ts"],
                   cwd=repo, capture_output=True)
good = r.stdout.decode("utf-8", errors="replace")

# 找 engine:start 里的 LocalHooks 块
m = re.search(r"localHooks = new LocalHooks\(\{.*?\n    \}\)", good, re.S)
if m:
    print("=== 好版本 LocalHooks 块 ===")
    print(m.group(0)[:800])
