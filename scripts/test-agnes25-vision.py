# 测试 agnes-2.5-flash 图片识别（新地址 + 新 key）
import base64, json, urllib.request, io
from PIL import Image, ImageDraw

img = Image.new('RGB', (800, 400), 'white')
d = ImageDraw.Draw(img)
d.text((30, 30), 'Customer: 丹七片多少钱一盒？', fill='black')
d.text((30, 70), 'Customer: 有医保吗？', fill='black')
d.text((30, 130), '[我]: 价格好商量，欢迎来公司面谈', fill='black')

buf = io.BytesIO()
img.save(buf, format='PNG')
img_b64 = base64.b64encode(buf.getvalue()).decode()

KEY = 'sk-YxmHWNWM97UiK2JDwm63KL6swaSwSUVA6jZW3bniz2UIVHkU'
MODEL = 'agnes-2.5-flash'
BASE_URL = 'https://api.agnes-ai.cn/v1'

body = {
    "model": MODEL,
    "messages": [
        {"role": "system", "content": "你是微信自动回复助手。分析截图中的聊天内容并回复。规则：1.只输出回复文字 2.最后一条是右侧气泡（我发的）则输出 [SKIP] 3.回复要自然口语化"},
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
            {"type": "text", "text": "请根据截图中微信聊天窗口的最新消息进行回复。"}
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
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode())
        content = data['choices'][0]['message']['content']
        print("STATUS 200 OK")
        print("RESPONSE:", content[:400])
except Exception as e:
    print("ERROR:", e)
    if hasattr(e, 'read'):
        print(e.read().decode()[:600])
