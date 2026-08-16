# 实测 Hermes 带图请求耗时（模拟 SightFlow 布局检测的请求形态）
import base64, json, urllib.request, io, time
from PIL import Image, ImageDraw

img = Image.new('RGB', (900, 600), 'white')
d = ImageDraw.Draw(img)
d.rectangle([30, 30, 200, 200], fill='red')
d.rectangle([300, 300, 600, 500], fill='blue')
d.text((50, 50), 'Chat list', fill='black')
d.text((350, 350), 'Message area', fill='black')
buf = io.BytesIO(); img.save(buf, format='PNG')
img_b64 = base64.b64encode(buf.getvalue()).decode()

KEY = 'desk-94d6e3df-3446-4f2f-880e-cd4164c86907'
body = {
    "model": "hermes-agent",
    "messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
        {"type": "text", "text": "这是一个聊天软件截图。请框选：1.【消息按钮区域】2.【有未读红点的消息项头像】。用 <bbox>x1,y1,x2,y2</bbox> 格式输出，坐标范围 0-1000"}
    ]}],
    "stream": False
}
req = urllib.request.Request("http://127.0.0.1:8642/v1/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"}, method="POST")
t0 = time.time()
try:
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode())
        content = data['choices'][0]['message']['content']
        print(f"耗时: {time.time()-t0:.1f}s")
        print("返回:", content[:300])
except Exception as e:
    print(f"耗时: {time.time()-t0:.1f}s")
    print("ERROR:", e)
    if hasattr(e, 'read'):
        print(e.read().decode()[:300])
