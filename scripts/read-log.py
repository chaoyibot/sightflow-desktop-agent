import sys

path = r'C:\Users\Administrator\sightflow-desktop-agent\start-log.txt'
data = open(path, 'rb').read()
text = None
for enc in ['utf-8', 'gbk', 'gb18030']:
    try:
        text = data.decode(enc, errors='replace')  # 容忍坏字节
        print(f'=== 编码 {enc} (宽容模式), 总行数 {text.count(chr(10))} ===')
        break
    except Exception as e:
        print(f'{enc} 失败: {e}')

if text:
    lines = text.split('\n')
    keywords = ['回复模式', 'Engine started', 'callAPI', 'API 错误', '失败', 'getReply 完成',
                'SKIP', '回退', 'agnes', 'hermes', 'vision', '布局', '红点', '异常', 'error', 'Error']
    for i, l in enumerate(lines):
        if any(k in l for k in keywords):
            print(f'{i}: {l[:160]}')
