# Oh My Claudian

**让 Agent 在 Obsidian 里整理笔记，把零散信息变成可以开始的下一步。**

接入你已有的 Claude Code、Codex 或其他受支持的 Agent：对照来源笔记、起草带链接的总结、查看文件修改差异，并把结果保留为 Markdown。

[安装插件](https://community.obsidian.md/plugins/oh-my-claudian) · [快速开始](#快速开始) · [试一个完整工作流](#试一个完整工作流) · [English](README.md) · [版本更新](https://github.com/lee259/oh-my-claudian/releases) · [反馈问题](https://github.com/lee259/oh-my-claudian/issues)

![Obsidian 中的 Oh My Claudian：来源笔记、聊天和展开的文件修改差异](assets/PreviewCurrent.png)

*真实 Obsidian 界面，使用示例对话内容；外观随主题和提供商变化。*

## 从一个结果开始

- **整理零散笔记。** 附上项目简介和研究笔记，让 Agent 比较来源，生成带笔记链接的总结。
- **直接改进草稿。** 选中文本，提出修改要求，查看逐词差异后应用内联编辑结果。
- **阅读长任务。** 完成的工具过程折叠成可展开摘要，方便看最新回答，也方便回看过程。
- **沿用已有 Agent。** 在侧栏中使用提供商自己的认证、模型、权限，以及它支持的命令和技能。

## 快速开始

需要 **Obsidian 桌面版 1.7.2 或更高版本**，以及至少一个受支持的 Agent。插件采用 MIT 协议，免费使用；模型服务的订阅、API 费用和使用额度由所选提供商决定。安装插件不包含模型订阅。

### 1. 安装插件

在 Obsidian 打开 **设置 → 第三方插件 → 浏览**，搜索 **Oh My Claudian**，安装并启用。也可以打开[插件目录页](https://community.obsidian.md/plugins/oh-my-claudian)。

### 2. 先接好一个 Agent

选你已经在用的 CLI，在终端确认它能启动和完成认证，再配置插件中的同一提供商。

| | Claude Code | Codex |
| --- | --- | --- |
| 安装与认证 | 按 [Claude Code 官方快速开始](https://code.claude.com/docs/en/quickstart)安装；在终端运行 `claude`，按提示登录。 | 按 [Codex 官方指南](https://developers.openai.com/codex/cli/)安装；在终端运行 `codex`，按提示登录。 |
| 已有账号 | 沿用 Claude Code 支持的账号或 API 配置。 | 沿用 Codex 支持的账号或 API 配置。 |
| 插件设置 | 打开 **设置 → Oh My Claudian → 提供商 → Claude Code**，启用提供商。 | 打开 **设置 → Oh My Claudian → 提供商 → Codex**，启用提供商。 |
| 就绪检查 | 检查 **就绪状态**，必要时设置 CLI 路径，并启用一个聊天模型。 | 检查 **就绪状态**，加载模型目录，并启用一个聊天模型。 |

就绪状态会检查提供商是否启用、CLI 是否可用、模型目录是否可用，以及是否选择了聊天模型。受支持的 CLI 可以提供安装或更新操作，执行前展示命令供确认，执行后检查结果。认证由提供商自己的 CLI 完成。

CLI 在终端可用、插件却找不到时，在对应提供商设置中填写 **CLI 可执行文件的绝对路径**。从桌面启动的 Obsidian 与终端的 `PATH` 可能不同。

### 3. 得到第一条回答

从命令面板打开 **Oh My Claudian: Open chat view**，或点击功能区图标。选择已启用的模型，输入 `@` 选择一篇笔记，发送：

> 请用三个要点概括这篇笔记，附上来源笔记链接，并建议一个下一步。先不要修改任何文件。

发送前，确认输入框中已出现笔记附件标签；发送后，检查聊天中的回答。先确认这一步能完成，再尝试下面的写入工作流。没有可选模型或收不到回答时，先看[常见问题](#常见问题)。

## 试一个完整工作流

将 [`docs/demo-vault`](docs/demo-vault) 中三篇示例笔记复制到 **测试仓库**，在该仓库安装并配置插件，使用 `@` 附上三篇笔记。

1. 让 Agent 比较来源，提出三个可执行的下一步，暂不改文件。
2. 看过计划后，请它向 `Project Brief.md` 添加 `Next steps` 小节，每条行动链接到来源笔记。
3. 提供商返回受支持的编辑数据时，展开文件编辑卡片查看 diff，再打开笔记确认结果。聊天工具的写入可能已按提供商权限执行；内联编辑另有预览后应用的流程。

[示例操作指南](docs/demo.md) 提供可复制的提示词、检查结果的方法和演示录制方案。不同模型的输出和速度会有差异。

如果它帮助你处理了笔记，欢迎给[仓库点一个 Star](https://github.com/lee259/oh-my-claudian)，帮助其他人发现项目。具体的使用反馈和问题报告也很有价值。

## 与 Claudian 的关系

Oh My Claudian 基于 [Yishen Tu 的 Claudian](https://github.com/YishenTu/claudian) 分叉而来，保留原项目的 MIT 协议和基础工作流，包括聊天、`@` 引用、slash commands 和内联编辑。目前独立维护，并非 Claudian 官方版本。

| 你的需要 | 可以在这个版本中尝试 |
| --- | --- |
| 在仓库中使用 Cursor Agent 或 Oh My Pi | 与 Claude Code、Codex、Grok Build、OpenCode 和 Pi 一起提供内置集成。 |
| 配置本地 Agent 时需要指引 | 提供商专属的就绪状态，以及受支持的 CLI 安装／更新入口。 |
| 长对话中方便查看过程和修改 | 展开已完成工作摘要、文件 diff，并保留阅读位置。 |
| 操作 Obsidian 的笔记结构 | Claude、Codex、OpenCode 和 Pi 可以检查反向链接、管理属性，以及通过 Obsidian 移动文件并更新链接。 |

这些是本项目的维护重点。上游独立演进，对比时请查看 [Claudian 当前 README](https://github.com/YishenTu/claudian#readme)。已有配置满足需要时，可以继续使用原来的版本。

## 把回答保存为笔记

在聊天消息中选中内容，点击浮层里与「引用」并列的「保存到笔记」，可编辑、预览选中内容，再新建笔记或追加到已有笔记。选区中的标题、强调、链接、列表、表格和代码块会从渲染内容还原为 Markdown；路径中的文件夹须已存在。保存成功后可打开笔记，或在弹窗内撤销本次正文。撤销会保留后来追加的内容，遇到冲突则停止；新建的笔记文件会保留。

## 支持的提供商

内置 Claude Code、Codex、Cursor Agent、Grok Build、Oh My Pi（OMP）、OpenCode 和 Pi。具体认证、权限、规划、历史、模型目录、命令、技能及 MCP 能力由各提供商决定；界面仅展示所选提供商支持的功能。[官方文档入口](README.md#supported-providers)

## 常见问题

| 问题 | 先检查什么 |
| --- | --- |
| 找不到 CLI | 对应提供商的就绪状态、可执行文件绝对路径，以及 Obsidian 的 `PATH`。 |
| 没有可选模型 | 先确认 CLI 登录成功，重新检查／加载模型目录，再启用聊天模型。 |
| Claude 订阅能用，插件却认证失败 | 检查是否继承了冲突的 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`。见[凭证冲突指引](README.md#claude-authentication-fails-while-the-cli-subscription-works)。 |
| 某个按钮或命令没有出现 | 核对所选提供商是否支持该能力。 |
| 工具成功，但文件卡片没有 diff | 提供商需要返回受支持的编辑数据；成功状态本身不包含修改行。 |

报告问题时，请提供插件版本、Obsidian 版本、系统、提供商、CLI 版本和复现步骤。日志和截图中请移除密钥和私人笔记内容。

## 数据与权限

插件采用本地优先设计，不发送插件遥测。提示词、附件和工具结果会发送到你所选的提供商及其配置的模型服务；CLI 版本检查和配置的 MCP 服务也可能访问网络。

仓库是 Agent 的工作目录，不是操作系统级隔离环境。CLI、shell、MCP 或子进程可能访问当前系统账号允许访问的文件和服务。使用前检查提供商权限，尤其是自动批准、浏览器、MCP 和外部路径相关设置。

显式附上外部文件并不意味着授予写入权限；受支持的提供商会对仓库外直接编辑采用审批流程。[完整说明](README.md#safety-and-privacy)

## 开发与协议

[开发及构建](README.md#development) · [贡献指南](CONTRIBUTING.md) · [MIT 协议](LICENSE)
