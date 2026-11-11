# dsh-modern-web-guidance

把 [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance)（Google Chrome 团队维护的 Web 平台最佳实践语料）接进 DeepSeek Harness，变成四个原生工具加一个技能。

[English](README.md)

```
mwg_search      →  「点遮罩关闭弹窗」该查哪些指南
mwg_retrieve    →  指南全文：写法、坑、必需的降级方案
mwg_list        →  全量 id
mwg_legacy_scan →  整个代码库的旧写法扫描
```

全部**离线**：无 API key、无网络、无遥测，单次检索约 310 ms。

---

## 为什么需要它

模型会写旧写法，因为训练数据里旧代码最多：给 `<dialog>` 已经处理好的弹窗手写焦点陷阱，给 `animation-timeline: view()` 能原生做的滚动显现挂 `scroll` 监听，给两年前就已经 Baseline 的特性加 polyfill。

这份语料是 Chrome、Edge、Firefox、MDN 四方共同维护的 208 篇可检索指南（250 个平台特性），每篇都是「用平台能力做，这是你真正需要的降级」，并附实时的 Baseline 兼容数据。上游评测（2026-11-08 快照，未接入 → 接入）：

| Agent / 模型 | 通过率 |
|---|---|
| antigravity_cli (gemini-4-argon) | 58% → 94% |
| codex_cli (gpt-6.1-sol) | 54% → 82% |
| claude_code (opus-5-5) | 57% → 88% |

本项目把它变成 DSH 的一等能力，而不是每问一句就 shell 一次。

## 安装

### 方式 A — 作为 DSH 插件（推荐）

**一条命令**（打包本仓库 → 装进 DSH profile → 注册 bundle → 复制技能）：

```sh
git clone https://github.com/Aloento/dsh-modern-web-guidance.git
cd dsh-modern-web-guidance
node install.mjs --dry-run   # 先看会改什么
node install.mjs
```

**或者手动：**

```sh
cd "$DSH_HOME/profiles/web"          # 或 headless
pnpm add github:Aloento/dsh-modern-web-guidance
```

然后在该 profile 的 `package.json` 里把包名追加进 `dsh.profile.bundles`：

```json
{
  "dsh": { "profile": { "bundles": ["...", "dsh-modern-web-guidance"] } }
}
```

本包自带 `cordis.patch.yml`，不需要手写 patch 条目。

### 方式 B — 只装技能

把 [`skill/modern-web-guidance/SKILL.md`](skill/modern-web-guidance/SKILL.md) 放进 DSH 会扫描的技能根：

| 根目录 | 优先级 |
|---|---|
| `<项目>/.dsh/skills` | 100 |
| `<项目>/.agents/skills` | 200 |
| `~/.dsh/skills` | 400 |
| `~/.agents/skills` | 500 |

技能 provider 会监听这些目录，**写完即生效，不用重启**。没有插件时，技能通过 CLI 走 bash：

```sh
npx -y modern-web-guidance@latest search "light dismiss dialog"
```

### 方式 C — 其他 agent

上游自带 Claude Code / Codex / Cursor / Gemini / Kimi / Grok 等安装器：

```sh
npx modern-web-guidance@latest install
```

## 用法

### 四个工具

| 工具 | 参数 | 返回 |
|---|---|---|
| `mwg_search` | `query`（2–5 词） | 排序后的 `[{ id, description }]` |
| `mwg_retrieve` | `ids: string[]` | 每个 id 的指南全文，外加 `missing` |
| `mwg_list` | — | 全量 id + 一句话描述 |
| `mwg_legacy_scan` | `path?`、`full?` | 按指南分组的 findings，默认最多 15 条；`full: true` 附原始报告 |

### 查询纪律

索引小且是按「意图」组织的，写成 prompt 的查询效果很差。

| 想做的事 | 查什么 |
|---|---|
| 删除前先确认 | `confirmation dialog` |
| 侧滑抽屉 | `navigation drawer` |
| 表格在手机上能用 | `responsive data table` |
| 列表重排加动画 | `dynamic sort animation` |
| 页面间过渡 | `view transition between pages` |
| 表单错误被正确播报 | `accessible error announcement` |

- **2–5 个词，一次一个能力**：不要 `dialog`，也不要 `responsive table dark mode`。
- **不塞框架名、产品名、文件名**：不要 `close React settings modal on outside click`。
- **说 UI 原语，不说业务意图**：「删之前先确认」→ `confirmation dialog`。
- 描述对得上就 `mwg_retrieve`，**不要**再 `mwg_list`；返回空就换具体名词重试一次，仍无匹配就照常实现。

### 工作流

1. 写任何 UI、CSS 布局/动画、客户端 JS 之前，先 `mwg_search`。
2. `mwg_retrieve` 命中的 id，**连同**所属学科总纲（`html` / `css` / `forms` / `accessibility` / `color` / `performance` / `security`）。
3. 实现时对照指南的写法与降级方案。
4. 回复末尾加 `### Modern Web Guidance` 小节：每条真正用上的指南一行——id、一句非显然选择的说明、该指南中一条规则的原话短引用。

### 全库审计

只用于开放式现代化改造，不要用来「修这一个组件」。**必须传项目根路径**——工具会拒绝误扫整个家目录：

```sh
npx -y modern-web-guidance@latest legacy-scan . --json
```

每条 finding 都要对照它的 `keepWhen` / `dropWhen` 判据核实——扫描只覆盖有确定性规则的那约 20% 指南。

## 配置

```yaml
- id: modern-web-guidance
  name: dsh-modern-web-guidance
  config:
    enabled: true          # 是否挂载插件
    injectPrompt: true     # 是否把 mwg_* 路由规则注入系统提示
    telemetry: false       # false → 给 CLI 设 DISABLE_TELEMETRY=1
    cwd: ''                # CLI 工作目录，也是 .mwgrc 的查找位置
    cliPath: ''            # 覆盖 CLI 入口（也可用环境变量 MWG_CLI）
    timeoutMs: 60000       # 单次 CLI 调用超时
    cacheTtlMs: 300000     # search/list/retrieve 缓存；0 关闭
    maxRetrieveChars: 120000
```

### 实验特性

Origin Trial 与 volatile（单引擎、近三个月才发布）指南默认被 `retrieve` 拦截。要在某个项目里开启，在项目根放 `.mwgrc`：

```json
{ "allowOriginTrials": true, "allowVolatileFeatures": true }
```

## 工作原理

```
DSH agent
  │  mwg_search / mwg_retrieve / mwg_legacy_scan
  ▼
lib/index.js      cordis 插件——defineTool 注册 + 提示注入
  │
  ▼
lib/bridge.js     启动 `node <modern-web-guidance>/skills/.../modern-web.mjs`
  │               TTL 缓存 · 转存文件回收 · 错误清洗
  ▼
modern-web-guidance（npm 包，17 MB，自包含）
  离线 BM25 + 向量检索，覆盖 208 篇指南
```

上游两个脾气被吞在桥接层里，不暴露给模型：

- **大输出会转存文件**：超过约 9.5 KB 时 CLI 只打印一行路径。桥接层读取、返回并删除临时文件。
- **退出码不可靠**：id 不存在时 CLI 会非零退出，却仍然输出找到的指南。可用输出优先——只有一条指南都没拿到才报错。

上游 CLI 的匿名遥测（安装数、agent 名、取用过的 guide id、检索词，不含原始提示词）默认用 `DISABLE_TELEMETRY=1` 关闭。

## 环境要求

- Node.js ≥ 22
- DSH `>= 0.2.1-rc.2 < 0.4.0-0`
- 磁盘：语料约 9 MB

## 排错

| 现象 | 处理 |
|---|---|
| 工具一直没出现 | 确认 `dsh.profile.bundles` 里有这个包、profile 的 `node_modules` 里有它，然后重启 harness |
| `modern-web-guidance CLI not found` | 在 profile 里 `pnpm add modern-web-guidance`，或设 `cliPath` / `MWG_CLI` |
| `mwg_retrieve` 返回 `missing` | id 不存在——重新 `mwg_search`，不要凭记忆编 id |
| `mwg_search` 返回空 | 换成具体 UI 名词（`dialog`、`popover`、`table`、`form`）再试一次 |
| `mwg_legacy_scan needs an explicit path` | 会话工作区就是家目录；请传项目根，例如 `path: "C:/code/my-app"` |
| `mwg_legacy_scan` 报 `exited N after printing this report` | 扫描途中遇到不可读路径，结果不完整；换更小的目录重跑 |
| 只有技能没有工具 | 这是方式 B 的正常状态，技能通过 bash 调 CLI |
| 安装时 `pnpm` 报错 | Windows 下安装器已绕开 `pnpm.cmd`；pnpm 不在 PATH 时用 `PNPM_JS` 指定 |

## 卸载

```sh
node uninstall.mjs            # 摘掉 bundle 条目、包与技能副本
node uninstall.mjs --dry-run  # 预演
```

装完之后你改过的 `SKILL.md` 会被保留，其余文件不动。

## 开发

```sh
pnpm install
pnpm test          # 14 项离线检查，跑在 mock 的 cordis 上下文里
```

目录：

```
lib/index.js               插件入口：配置、工具、提示注入
lib/bridge.js              CLI 进程桥接、转存回收、错误清洗
skill/modern-web-guidance  只装技能时用的 SKILL.md
cordis.patch.yml           bundle patch（插入插件行）
scripts/pnpm.mjs           跨平台 pnpm 调用
install.mjs / uninstall.mjs
test/verify.mjs            离线检查
```

## 归属与许可

- **本仓库**：MIT，见 [LICENSE](LICENSE)。
- **上游指南**（`modern-web-guidance`）：代码 Apache-2.0，`guides/` 内容 [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)，部分派生自 MDN、W3C、WHATWG 与 IETF 材料。见 [NOTICE](NOTICE)。
- **与 Google 无隶属或背书关系**。这是独立集成；语料、CLI 与技能原文均来自 `GoogleChrome/modern-web-guidance`。
- 本仓库的 `SKILL.md` 是上游技能的改写版，针对 DSH 约定做了调整（Windows 运行方式、离线 CLI 路径、面向模型的工具名）。
