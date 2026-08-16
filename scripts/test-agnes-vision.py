# 测试 agnes-2.5-flash 新配置（新 key + 图片能力）
import base64, json, urllib.request, io
from PIL import Image, ImageDraw

img = Image.new('RGB', (800, 400), 'white')
d = ImageDraw.Draw(img)
d.text((30, 30), 'Test message from customer:', fill='black')
d.text((30, 70), '这款丹七片多少钱一盒？', fill='black')
d.text((30, 110), '有没有医保？', fill='black')

buf = io.BytesIO()
img.save(buf, format='PNG')
img_b64 = base64.b64encode(buf.getvalue()).decode()

KEY = 'sk-YxmHWNWM97UiK2JDwm63KL6swaSwSUVA6jZW3bniz2UIVHkU'
MODEL = 'agnes-2.5-flash'
BASE_URL = 'https://apihub.agnes-ai.com/v1'

body = {
    "model": MODEL,
    "messages": [
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
            {"type": "text", "text": "请描述这张截图里的聊天内容，最后一条是谁发的"}
        ]}
    ],
    "stream": False
}
req = urllib.request.Request(
    f"{BASE_URL}/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"},
    method="POST"
)
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
        content = data['choices'][0]['message']['content']
        print("OK:", content[:400])
except Exception as e:
    print("ERROR:", e)
    if hasattr(e, 'read'):
        print(e.read().decode()[:500])
