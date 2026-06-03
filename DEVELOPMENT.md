# OpenCode Token Activity — 开发文档

## 项目结构

```
opencode-heatmap/
├── sync.py                        # 数据同步：读 opencode.db → 更新 stats/opencode-tokens.json
├── server.py                      # 本地开发服务器（静态文件 + /sync 触发器）
├── index.html                     # 纯客户端热力图（fetch JSON → JS 渲染）
├── plugins/
│   └── token-tracker.ts           # OpenCode 插件（复制到 ~/.config/opencode/plugins/ 使用）
├── stats/
│   ├── opencode-tokens.json       # 唯一数据源（由 sync.py / 插件生成更新）
│   └── opencode-tokens.js         # script 标签加载版（兼容 file:// 协议）
└── DEVELOPMENT.md
```

---

## 日常使用流程

### 自动模式（OpenCode 插件，推荐）

安装插件后，每次启动 OpenCode 后延迟触发一次后台同步，无需手动运行脚本。
插件首次没有有效本地 stats 数据时会全量读取数据库，之后默认只重算昨天和今天；如果本地 stats 很久没更新，会从最后已有日期补齐。插件不监听 `session.idle`，避免频繁扫描大数据库。
上传到 GitHub Actions 时，首次是 `full` payload；之后是 `patch` payload。workflow 从已发布的 Pages 地址读取旧 stats 合并，然后部署 Pages artifact，不提交 stats 数据到代码分支。
GitHub 上传建议通过 `github.token` 或 `github.tokenEnv` 触发 Actions；token 只需要当前仓库的 `Actions: Read and write` 权限。

详见下方「OpenCode 插件」章节。

### 手动模式 — 本地（不上传 GitHub）

```bash
# 1. 同步数据（读 opencode.db → 更新 stats/opencode-tokens.json）
python sync.py

# 2. 启动本地预览
python server.py

# 或者一步到位：启动时自动同步
python server.py --sync
```

浏览器访问 `http://localhost:8080` 即可看到热力图。
页面会 fetch `stats/opencode-tokens.json` 并用纯 JS 渲染。模型分布只导出 `modelID`，不导出渠道 `providerID`。

### GitHub Pages 模式

```bash
# 1. 同步数据
python sync.py

# 2. 推荐：由 OpenCode 插件触发 GitHub Actions 部署 Pages artifact
# 手动直推仍可用 python sync.py --push，但会产生 stats 数据提交
```

GitHub Pages 使用 GitHub Actions 部署后，`index.html` 直接从部署产物同目录加载 `stats/opencode-tokens.json` 渲染。

---

## sync.py 命令行

```bash
python sync.py                     # 默认：读 DB → 合并到 stats/opencode-tokens.json
python sync.py --db /path/to/db    # 指定 DB 路径
python sync.py --push              # 同步后 git commit + push
python sync.py --dry-run           # 只打印结果，不写文件
python sync.py --full              # 完整重建历史数据
python sync.py --days 14           # 调整默认 1 天增量窗口
```

### DB 路径查找顺序

1. `--db` 参数
2. `OPENCODE_DB` 环境变量
3. `~/.local/share/opencode/opencode.db`（Linux/macOS）
4. `%LOCALAPPDATA%/opencode/opencode.db`（Windows）

---

## server.py 命令行

```bash
python server.py                   # 启动开发服务器，端口 8080
python server.py --port 3000       # 指定端口
python server.py --sync            # 启动前先执行一次 sync
```

### 端点

| 路径 | 说明 |
|------|------|
| `/` | 热力图页面（index.html） |
| `/sync` | 触发一次数据同步 |
| `stats/opencode-tokens.json` | 原始 JSON 数据 |

---

## 数据格式

### stats/opencode-tokens.json

```json
{
  "version": 1,
  "updated_at": "2026-06-03T12:00:00+00:00",
  "daily": [
    {
      "date": "2026-05-16",
      "sessions": 9,
      "tokens": 19969132,
      "tokens_input": 19820643,
      "tokens_output": 148489,
      "tokens_cache_read": 12470912,
      "tokens_cache_write": 0,
      "tokens_reasoning": 59183,
      "longest_turn_ms": 0
    }
  ],
  "stats": {
    "lifetime_tokens": 22291832,
    "peak_daily_tokens": 19969132,
    "longest_turn_sec": 1330981,
    "current_streak_days": 5,
    "longest_streak_days": 12,
    "total_sessions": 44
  }
}
```

### 合并逻辑

`sync.py` 每次运行时：
1. 从 `opencode.db` 读取全量每日数据
2. 加载现有 `stats/opencode-tokens.json`
3. 按日期 merge：DB 中的数据覆盖同日期的旧数据，保留远程已有但本地没有的条目
4. 重新计算 `stats`
5. 写回 `stats/opencode-tokens.json`

---

## 架构图

```
┌─────────────────────────────────────────────┐
│  每日流程                                     │
│                                              │
│  1. 使用 OpenCode → opencode.db 累积数据      │
│  2. python sync.py → 读 DB → 更新 JSON       │
│  3. python sync.py --push → 推送到 GitHub     │
│  4. GitHub Pages 自动部署                      │
│                                              │
│  本地开发:                                     │
│  python server.py --sync → 一键同步+预览       │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  index.html 工作方式                           │
│                                              │
│  浏览器加载 index.html                         │
│    └── fetch("stats/opencode-tokens.json")   │
│         └── JS 渲染热力图 + 统计卡片           │
│                                              │
│  无需后端，纯静态文件                           │
│  GitHub Pages / 本地 server.py 均可           │
└─────────────────────────────────────────────┘
```

---

## OpenCode 插件

### 安装

1. 复制插件到全局插件目录：

```bash
mkdir -p ~/.config/opencode/plugins
cp token-tracker.ts ~/.config/opencode/plugins/
```

2. 在 `~/.config/opencode/opencode.json` 中启用：

```jsonc
{
  "plugin": ["token-tracker"]
}
```

3. 确保 `~/.config/opencode/package.json` 中有 SDK 依赖：

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "*"
  }
}
```

OpenCode 启动时自动 `bun install`。

### 工作方式

- **启动时**：自动执行一次数据同步
- **会话空闲时**（`session.idle` 事件）：再次同步，确保数据最新

### 配置

在 `~/.config/opencode/opencode.json` 中添加 `token-tracker` 配置块：

```jsonc
{
  "plugin": ["token-tracker"],
  "token-tracker": {
    "repo": "/path/to/opencode-heatmap",   // 本地仓库路径
    "push": false                           // true = 同步后自动 git push
  }
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `repo` | opencode-heatmap 仓库本地路径 | `~/opencode-heatmap` |
| `push` | 同步后是否自动 git commit + push | `false` |

设置 `push: true` 后，插件同步完会自动 `git add + commit + push`，配合 GitHub Pages 实现全自动更新。

---

## 旧文件说明

- `data.json` — 旧格式导出文件，已废弃（数据已迁移到 `stats/opencode-tokens.json`）
