# 模拟 SightFlow getReply 的 Hermes 请求：要求输出纯回复文本
import base64, json, urllib.request, io, time
from PIL import Image, ImageDraw

img = Image.new('RGB', (800, 500), 'white')
d = ImageDraw.Draw(img)
# 模拟聊天窗口：左侧气泡（对方），右侧气泡（我）
d.rectangle([50, 50, 450, 110], fill='#e8e8e8')
d.text((70, 70), '客户: 丹七片多少钱一盒？有医保吗？', fill='black')
d.rectangle([350, 140, 750, 200], fill='#95ec69')
d.text((370, 160), '[我]: 价格好商量，欢迎来公司面谈', fill='black')
d.rectangle([50, 230, 450, 290], fill='#e8e8e8')
d.text((70, 250), '客户: 那加个微信聊聊？', fill='black')
buf = io.BytesIO(); img.save(buf, format='PNG')
img_b64 = base64.b64encode(buf.getvalue()).decode()

KEY = 'desk-94d6e3df-3446-4f2f-880e-cd4164c86907'
body = {
    "model": "hermes-agent",
    "messages": [{"role": "system", "content": "你是微信自动回复助手。分析截图中的聊天内容，生成合适的回复。规则：1.只输出回复文字本身，不要解释、不要 markdown、不要任何前缀 2.右侧气泡是\"我\"发送的，如果最后一条是右侧气泡则输出 [SKIP] 3.回复要自然口语化 4.这是医药招商场景，产品信息要带医保/基药资质"},
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
            {"type": "text", "text": "请根据截图中的聊天内容进行回复。"}
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
        print("返回内容:", repr(content[:300]))
except Exception as e:
    print(f"耗时: {time.time()-t0:.1f}s")
    print("ERROR:", e)
    if hasattr(e, 'read'):
        print(e.read().decode()[:400])
