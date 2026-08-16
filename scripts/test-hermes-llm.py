import base64, json, urllib.request, os

# 1x1 红色像素 PNG
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
img_b64 = base64.b64encode(png).decode()

key = os.environ.get('API_SERVER_KEY', '').strip()
body = {
    "model": "hermes-agent",
    "messages": [
        {"role": "system", "content": "你是测试助手，只回复两个字：收到"},
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
            {"type": "text", "text": "看图说话"}
        ]}
    ],
    "stream": False
}
req = urllib.request.Request(
    "http://127.0.0.1:8642/v1/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    method="POST"
)
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
        print("STATUS:", resp.status)
        print("RESPONSE:", json.dumps(data, ensure_ascii=False)[:500])
except Exception as e:
    print("ERROR:", e)
    if hasattr(e, 'read'):
        print(e.read().decode()[:500])
