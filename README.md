# SightFlow.dev

<img width="1201" height="495" alt="image" src="https://github.com/user-attachments/assets/99a7cfec-eb22-4f65-8a76-a6974e46bcf0" />

Official website： [https://sightflow.dev](https://sightflow.dev/)

> **本仓库为改进版**：适配火山引擎 Coding Plan 套餐（免按量计费）、修复 VLM 视觉模型配置、支持多角色 System Prompt 模板一键切换。详见下方「✨ 改进说明」。

# 招募共建开发者
我们相信Agent Computer Use 会是未来10年重要AI革命的基建，如果你也希望参与到这个项目迭代，欢迎联系\

[加入Discord](https://discord.com/invite/8H6KpbXq3t)

## 🔑 AI 模型配置 (API Key / SK Key)

本项目依赖大语言模型/视觉模型（Vision Language Model）驱动 RPA。
目前默认内置使用了**火山引擎 (Volcengine)** 的大模型服务。

### SK Key 的用途
1. **智能对话回复**：由于项目涉及类似微信等的自动抓取，模型会分析聊天界面的截图并生成自然的回复内容（带防止自我循环对话机制）。
2. **VLM 视觉定位引导**：基于屏幕截图和特定 Prompt，让模型自动检测屏幕上的 UI 控件，并返回需要点击的坐标，从而驱动纯视觉的 RPA 流程。

### 如何配置
1. 请前往 [火山引擎控制台 - 方舟原生接口](https://console.volcengine.com/ark) 开通相关服务，并生成/获取你的 API Key。
2. 在项目启动后，点击页面上的**设置 (Settings)** 选项。
3. 将你的 API Key 填入配置中，即可开始测试对应 AI 功能及自动回复了。

### ⭐ Coding Plan 套餐配置（推荐）
> 订阅 [方舟 Coding Plan](https://www.volcengine.com/activity/codingplan) 后，使用专属通道**不产生按量计费费用**。

| 配置项 | 推荐值 |
|:-------|:-------|
| Base URL | `https://ark.cn-beijing.volces.com/api/coding/v3`（OpenAI 兼容） |
| Model（视觉任务必须支持图片输入） | `doubao-seed-2.0-lite` / `doubao-seed-2.1-turbo` / `minimax-m3` / `kimi-k2.7-code` 等 |
| Vision Model | `doubao-seed-2.0-lite`（默认，VLM 布局检测用） |

> ⚠️ 请勿使用 `https://ark.cn-beijing.volces.com/api/v3`：该 Base URL **不会**消耗 Coding Plan 额度，会产生额外费用。
> ⚠️ `deepseek-v4-flash` / `glm-5.2` 等纯文本模型**不支持图片输入**，不可用于截图分析/VLM 检测。

### 🎭 多角色 System Prompt 模板
设置面板支持**预制角色模板一键切换**：
- 内置模板：购物群管理员（小果冻）、医药招商助手、通用客服（简洁）
- 「存为模板」：把当前人设保存为自定义模板（持久化到 settings.json）
- 「删除」：删除自定义模板（预置模板受保护）

## 🚀 快速开始 (Project Setup)

### 1. 安装依赖

```bash
npm install
```

### 2. 本地开发运行

```bash
npm run dev
```
> **提示**：启动后，应用将打开主界面。请记得先去设置填入 skkey 再进行后续测试。

## 📦 打包构建 (Build)

```bash
# 构建 Windows 版本
npm run build:win

# 构建 macOS 版本
npm run build:mac

```

## ✨ 改进说明（相对上游）

1. **Coding Plan 兼容**：默认 Base URL 切换为 `api/coding/v3` 专属通道，避免按量计费欠费（403 AccountOverdueError）。
2. **VLM 视觉模型修复**：修复 RPADevice 只传 apiKey 导致视觉调用回退到旧模型名 + 按量通道的问题；新增 `visionModel` 配置字段，视觉调用独立指定视觉模型。
3. **模型名更新**：`doubao-seed-2-0-lite-260215`（旧）→ `doubao-seed-2.0-lite`（Coding Plan 官方模型名）。
4. **多角色模板**：System Prompt 面板支持预制/自定义角色模板一键切换与持久化。
5. **模型输入框可编辑**：不再硬编码/禁用，支持直接填写任意支持的模型名。

## 开发环境推荐配置

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

