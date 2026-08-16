# 验证 agnes-2.5-flash 布局检测 bbox 格式（用真实 SightFlow prompt）
import base64, json, urllib.request, io
from PIL import Image, ImageDraw

# 模拟企业微信三栏布局
img = Image.new('RGB', (1000, 700), 'white')
d = ImageDraw.Draw(img)
# 左侧导航栏
d.rectangle([0, 0, 70, 700], fill='#f0f0f0')
d.rectangle([20, 100, 50, 130], fill='#ff6b6b')  # 消息按钮红点
# 中间消息列表
d.rectangle([70, 0, 330, 700], fill='#fafafa')
d.rectangle([100, 60, 300, 120], fill='#e8e8e8')  # 搜索框
d.rectangle([100, 140, 140, 180], fill='#cccccc')  # 第一行头像
d.ellipse([290, 145, 310, 165], fill='#ff0000')    # 头像红点
# 右侧聊天区
d.rectangle([330, 0, 1000, 700], fill='white')
d.rectangle([350, 40, 990, 90], fill='#e0e0e0')   # header
d.rectangle([350, 100, 990, 700], fill='#ffffff') # chatMainArea
buf = io.BytesIO(); img.save(buf, format='PNG')
img_b64 = base64.b64encode(buf.getvalue()).decode()

PROMPT = """你是一个企业微信布局解析专家。

## 企业微信桌面端布局（三栏式）
- 左侧导航栏：顶部用户头像、功能菜单（消息/通讯录/邮件/日程/工作台），系统分组
- 中间消息列表：顶部搜索框，下方是联系人消息列表，**有未读消息的联系人头像右上角有红色角标**
- 右侧聊天区

## 你的职责
帮我框选以下两个区域，每个区域用 <bbox>x1,y1,x2,y2</bbox> 格式，坐标范围 0-1000：
1. 【消息按钮区域】— 左侧导航栏中的消息按钮区域，包含按钮和红色角标
2. 【有未读红点的消息项头像】— 中间消息列表中**头像右上角带红色未读角标**的消息项（优先第一个有红点的；如果没有红点消息项就框列表第一行的头像区域）"""

body = {"model": "agnes-2.5-flash", "messages": [{"role": "user", "content": [
    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
    {"type": "text", "text": PROMPT}
]}], "stream": False}
req = urllib.request.Request("https://api.agnes-ai.cn/v1/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "Authorization": "Bearer sk-YxmHWNWM97UiK2JDwm63KL6swaSwSUVA6jZW3bniz2UIVHkU"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode())
        content = data['choices'][0]['message']['content']
        print("agnes 返回:", content[:400])
        # 用修复后的 parseBBoxes 逻辑验证
        import re
        regex = re.compile(r'<([a-z_0-9]+)>\s*([\d.]+)\s*[,，\s]\s*([\d.]+)\s*[,，\s]\s*([\d.]+)\s*[,，\s]\s*([\d.]+)\s*</\1>', re.I)
        found = [m.groups() for m in regex.finditer(content) if 'bbox' in m.group(1).lower() or 'bounding' in m.group(1).lower()]
        print(f"\n解析到 {len(found)} 个 bbox: {found}")
except Exception as e:
    print("ERROR:", e)
    if hasattr(e, 'read'):
        print(e.read().decode()[:400])
