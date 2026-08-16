# 诊断：Hermes api_server + agnes 连通性
import base64, json, urllib.request, io, os, sys
from PIL import Image, ImageDraw

def post(url, body, key, timeout=90):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except Exception as e:
        detail = ""
        if hasattr(e, 'read'):
            detail = e.read().decode()[:400]
        return None, f"{e} {detail}"

KEY = 'desk-94d6e3df-3446-4f2f-880e-cd4164c86907'

# ── 1. Hermes 纯文本 ──
print("=== 1. Hermes api_server 纯文本 ===")
st, r = post("http://127.0.0.1:8642/v1/chat/completions",
    {"model": "hermes-agent", "messages": [{"role": "user", "content": "回复OK两个字"}], "stream": False}, KEY, timeout=60)
print("status:", st, "| resp:", str(r)[:300])

# ── 2. Hermes 带图 ──
print("\n=== 2. Hermes api_server 带图 ===")
img = Image.new('RGB', (400, 200), 'white')
d = ImageDraw.Draw(img)
d.text((20, 40), 'Customer: 丹七片多少钱？', fill='black')
d.text((20, 90), '[我]: 价格好商量', fill='black')
buf = io.BytesIO(); img.save(buf, format='PNG')
img_b64 = base64.b64encode(buf.getvalue()).decode()
st, r = post("http://127.0.0.1:8642/v1/chat/completions",
    {"model": "hermes-agent", "messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
        {"type": "text", "text": "最后一条是谁发的？"}
    ]}], "stream": False}, KEY, timeout=120)
print("status:", st, "| resp:", str(r)[:400])

# ── 3. agnes 直接调用 ──
print("\n=== 3. agnes-2.5-flash 图片识别 ===")
st, r = post("https://api.agnes-ai.cn/v1/chat/completions",
    {"model": "agnes-2.5-flash", "messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
        {"type": "text", "text": "描述这张图"}
    ]}], "stream": False}, 'sk-YxmHWNWM97UiK2JDwm63KL6swaSwSUVA6jZW3bniz2UIVHkU', timeout=90)
print("status:", st, "| resp:", str(r)[:400])
