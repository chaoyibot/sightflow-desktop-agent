# 生成带文字的测试图，发给 Hermes 验证视觉能力
import io
from PIL import Image, ImageDraw

img = Image.new('RGB', (800, 400), 'white')
d = ImageDraw.Draw(img)
d.text((30, 30), 'Test message from customer:', fill='black')
d.text((30, 70), '这款丹七片多少钱一盒？', fill='black')
d.text((30, 110), '有没有医保？', fill='black')
d.text((30, 150), '[Right side bubble] 您好，价格好商量，', fill='black')
d.text((30, 190), '欢迎来公司面谈', fill='black')

import base64, json, urllib.request, os
buf = io.BytesIO()
img.save(buf, format='PNG')
img_b64 = base64.b64encode(buf.getvalue()).decode()

key = os.environ.get('API_SERVER_KEY', '').strip()
body = {
    "model": "hermes-agent",
    "messages": [
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
            {"type": "text", "text": "请描述这张截图里的聊天内容，并告诉我最后一条消息是谁发的（左侧=对方，右侧=我）"}
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
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode())
        content = data['choices'][0]['message']['content']
        print("RESPONSE:", content[:600])
except Exception as e:
    print("ERROR:", e)
    if hasattr(e, 'read'):
        print(e.read().decode()[:800])
