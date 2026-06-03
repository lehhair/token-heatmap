# OpenCode Token Heatmap

OpenCode 的 Token 活动热力图，类似 GitHub 贡献图。展示每日 Token 用量、模型分布等。

![](https://img.shields.io/badge/python-3.10+-blue)

## 快速开始

### 1. 同步数据

```bash
python sync.py
```

自动查找 `~/.local/share/opencode/opencode.db`，读取数据后生成 `stats/opencode-tokens.json`。

指定 DB 路径：

```bash
python sync.py --db /path/to/opencode.db
```

### 2. 本地预览

```bash
python server.py
```

浏览器访问 `http://localhost:8080`。也可以直接用浏览器打开 `index.html`（通过 `.js` 文件兼容 `file://` 协议）。

### 3. 部署到 GitHub Pages

启用 GitHub Pages 后，页面会从部署产物里的 `stats/opencode-tokens.json` 加载数据。推荐用 OpenCode 插件触发 GitHub Actions 部署 Pages artifact，不需要把数据提交进代码分支，也不需要给本地 token 仓库写权限。

GitHub Pages 的 Source 请选择 `GitHub Actions`，不要选 `Deploy from a branch`。

### 4. 嵌入到其他网站

```html
<script src="https://your-name.github.io/opencode-heatmap/embed.js" defer></script>
<opencode-token-heatmap></opencode-token-heatmap>
```

组件背景透明，样式封装在 Shadow DOM 里，不会污染宿主页面。需要指定数据地址时可以加 `data-src`：

```html
<script src="https://your-name.github.io/opencode-heatmap/embed.js" defer></script>
<opencode-token-heatmap data-src="https://your-name.github.io/opencode-heatmap/stats/opencode-tokens.json"></opencode-token-heatmap>
```

## 自动同步（OpenCode 插件）

安装插件后，每次启动 OpenCode 后延迟触发一次后台同步。

### 安装

```bash
mkdir -p ~/.config/opencode/plugins
cp plugins/token-tracker.ts ~/.config/opencode/plugins/
```

在 `~/.config/opencode/opencode.json` 中启用：

```json
{
  "plugin": ["token-tracker"]
}
```

确保 `~/.config/opencode/package.json` 有依赖：

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "*"
  }
}
```

OpenCode 启动时会自动 `bun install`。

### 插件配置

创建 `~/.config/opencode/token-tracker.json`：

```json
{
  "repo": "/path/to/opencode-heatmap",
  "days": 1,
  "github": {
    "owner": "your-github-name",
    "repo": "opencode-heatmap",
    "workflow": "update-token-stats.yml",
    "ref": "master",
    "token": "github_pat_xxx",
    "tokenEnv": "TOKEN_HEATMAP_GITHUB_TOKEN"
  }
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `repo` | 本地仓库路径 | `~/opencode-heatmap` |
| `days` | 插件每次增量重算的最近天数，`1` 表示昨天和今天 | `1` |
| `github` | 触发 GitHub Actions 上传 stats 的配置，可用 `token` 或 `tokenEnv` 提供 token | 未启用 |

> 注意：配置写在单独的 `token-tracker.json` 中，因为 `opencode.json` 有严格 schema 校验，不允许自定义顶层 key。

插件只在 OpenCode 启动后延迟触发一次后台同步，不监听 `session.idle`。首次没有有效本地 stats 数据时全量初始化，之后默认只重算昨天和今天；如果本地 stats 很久没更新，会从最后已有日期补齐。配置 `github` 后，插件会触发 GitHub Actions 写入 `stats/`，本地 token 不直接 push 仓库内容。

上传到 GitHub Actions 时分两种模式：首次初始化发送 `full` payload；之后只发送 `patch` payload，也就是最近重算的日期数据。workflow 会从已发布的 Pages 地址读取旧 `stats/opencode-tokens.json` 并合并 patch，然后重新部署 Pages artifact，不产生 `data: update token stats` 这类数据提交。如果已发布页面还没有 stats，patch 会失败并提示先做一次 full 初始化。

如果把 token 写进 `token-tracker.json`，只放在本机配置目录，不要提交到仓库。建议 Fine-grained token 只给当前仓库的 `Actions: Read and write` 权限。

### 创建 GitHub Token

插件触发 GitHub Actions 需要一个 Fine-grained personal access token。这个 token 不需要 `Contents` 写权限，只需要能触发当前仓库的 Actions。

1. 打开 GitHub，点击右上角头像
2. 进入 `Settings`
3. 左侧滚到底，进入 `Developer settings`
4. 进入 `Personal access tokens`
5. 选择 `Fine-grained tokens`
6. 点击 `Generate new token`
7. `Token name` 填：`token-heatmap-actions`
8. `Expiration` 建议选 `90 days` 或你能接受的较短时间
9. `Resource owner` 选择你的账号
10. `Repository access` 选择 `Only select repositories`
11. 在仓库列表里只选择这个仓库，例如 `token-heatmap`
12. 展开 `Repository permissions`
13. 找到 `Actions`，设置为 `Read and write`
14. `Contents` 保持 `No access` 或不授予写权限
15. `Metadata` 会自动是只读，保持默认即可
16. 点击 `Generate token`
17. 复制生成的 token，它只会显示一次

然后把 token 写入本机配置文件 `~/.config/opencode/token-tracker.json`：

```json
{
  "repo": "/path/to/opencode-heatmap",
  "days": 1,
  "github": {
    "owner": "your-github-name",
    "repo": "token-heatmap",
    "workflow": "update-token-stats.yml",
    "ref": "master",
    "token": "github_pat_xxx"
  }
}
```

如果不想把 token 明文写在配置里，也可以用环境变量：

```json
{
  "repo": "/path/to/opencode-heatmap",
  "days": 1,
  "github": {
    "owner": "your-github-name",
    "repo": "token-heatmap",
    "workflow": "update-token-stats.yml",
    "ref": "master",
    "tokenEnv": "TOKEN_HEATMAP_GITHUB_TOKEN"
  }
}
```

Windows PowerShell 设置环境变量：

```powershell
setx TOKEN_HEATMAP_GITHUB_TOKEN "github_pat_xxx"
```

设置完后重启 OpenCode。插件会在启动后后台生成 stats，并触发 `.github/workflows/update-token-stats.yml`。workflow 只会把 `index.html` 和 `stats/opencode-tokens.json/js` 打包成 Pages artifact 并部署，不会提交 stats 数据到仓库。

## 命令参考

### sync.py

```bash
python sync.py                     # 同步数据
python sync.py --db /path/to/db    # 指定 DB 路径
python sync.py --push              # 同步 + git push
python sync.py --dry-run           # 只打印结果不写文件
python sync.py --full              # 完整重建历史数据
python sync.py --days 14           # 调整增量同步窗口，默认 1
```

DB 路径查找顺序：`--db` 参数 > `OPENCODE_DB` 环境变量 > `~/.local/share/opencode/opencode.db`

`--push` 会直接提交并推送 `stats/`，只适合你手动维护仓库时使用。插件自动上传推荐走 GitHub Actions Pages artifact，不需要本地 token 拥有 `Contents` 写权限，也不会污染代码提交记录。

### server.py

```bash
python server.py                   # 启动开发服务器 (端口 8080)
python server.py --port 3000       # 指定端口
python server.py --sync            # 启动前先同步一次
```

| 路径 | 说明 |
|------|------|
| `/` | 热力图页面 |
| `/sync` | 触发数据同步 |

## 页面功能

- **统计卡片**：总 Token、峰值、最长任务、连续天数
- **热力图**：最近一年每日活动，颜色深浅表示用量，点击查看详情
- **详情弹窗**：点击方格显示 Token 细分柱状图（Input/Output/Cache Read/Cache Write/Reasoning）+ 模型分布
- **模型分布**：按消息数占比显示，点击图例突出对应模型
- **深色模式**：跟随系统 `prefers-color-scheme`

## 项目结构

```
opencode-heatmap/
├── index.html                  # 纯客户端热力图页面
├── sync.py                     # 数据同步脚本
├── server.py                   # 开发服务器
├── plugins/
│   └── token-tracker.ts        # OpenCode 自动同步插件
├── stats/
│   ├── opencode-tokens.json    # 数据文件 (fetch 加载)
│   └── opencode-tokens.js      # 数据文件 (script 标签加载, 兼容 file://)
└── DEVELOPMENT.md              # 开发文档
```

## 数据来源

所有数据来自 OpenCode 的 SQLite 数据库 (`opencode.db`)：

- **Token 统计**：`part` 表中 `type='step-finish'` 的记录，按 `part.time_created` 分天
- **模型分布**：`part` JOIN `message` 表，通过 `message.data.modelID` 按模型汇总，同样按 `part.time_created` 分天；不导出 `providerID`
- **最长任务**：`message` 表中 assistant 消息的 `time.completed - time.created`

> 按 `part.time_created` 而非 `session.time_created` 分天，确保跨天 session 的 token 归到正确的日期。
