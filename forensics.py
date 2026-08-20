# -*- coding: utf-8 -*-
"""取证：从 git 对象和 electron-store 找真实 API key"""
import subprocess, re, json, glob, os

repo = r"C:\Users\Administrator\sightflow-desktop-agent"

# 1) git 历史中最老的含 index.ts 的提交
r = subprocess.run(["git", "log", "--format=%H", "--", "src/main/index.ts"],
                   cwd=repo, capture_output=True, text=True)
shas = [s for s in r.stdout.strip().split("\n") if s]
print("commits touching index.ts:", len(shas))
oldest = shas[-1] if shas else None
print("oldest sha:", oldest)

def extract_keys(blob: bytes):
    """从源码字节里找所有 apiKey 值"""
    text = blob.decode("utf-8", errors="replace")
    keys = re.findall(r"apiKey:\s*'([^']*)'", text)
    return keys

if oldest:
    r2 = subprocess.run(["git", "show", f"{oldest}:src/main/index.ts"],
                        cwd=repo, capture_output=True)
    if r2.returncode == 0:
        keys = extract_keys(r2.stdout)
        print(f"oldest version apiKeys (len:value): {[(len(k), k[:12]) for k in keys]}")
        # 找出非占位符的（真正的 UUID 或 sk- 开头）
        real = [k for k in keys if re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", k) or k.startswith("sk-")]
        print("REAL keys in oldest:", [(len(k), k[:10]) for k in real])

# 2) electron-store settings.json（用户真实配置）
candidates = glob.glob(os.path.expanduser(r"~/AppData/Roaming/sightflow-desktop-agent/settings.json"))
candidates += glob.glob(os.path.expanduser(r"~/AppData/Roaming/Electron/settings.json"))
for c in candidates:
    if os.path.exists(c):
        print("settings.json:", c)
        with open(c, encoding="utf-8") as f:
            data = json.load(f)
        ak = data.get("apiKey", "")
        print("user apiKey len:", len(ak), "prefix:", ak[:8])
        print("user model:", data.get("model"), "| aiEngine:", data.get("aiEngine"))
        print("user baseURL:", data.get("baseURL"))
