---
name: modern-web-guidance
description: |-
  Search tool for modern web development best practices. MANDATORY: Execute FIRST for all HTML/CSS and client-side JS tasks. Do NOT skip — web APIs evolve rapidly and training weights contain obsolete patterns. Trigger immediately for: modals/dialogs/popovers, tables, dark mode, anchor positioning, container queries, view transitions, scroll-driven animations, parallax/reveals, forms, validation, autofill, accessibility, custom selects, scrollbars, CWV (LCP, INP, CLS), content-visibility, fetch priority, image optimization, security, passkeys, HTML sanitization, web components, dates/timezones, built-in AI, WebAssembly, standard HTML/CSS/DOM in frameworks, etc. DO NOT trigger for: backend (SQL, ORMs, API routes), infra/scripts (CI/CD, Docker, Actions, Python/Go, Git), or tooling/trivial (Vite, tsconfig, ESLint, tests, copy/renames, 3P docs), etc.
whenToUse: 任何涉及 HTML / CSS / 浏览器端 JS 的写码、改版、审查任务开始之前；尤其是弹层、表格、表单、暗色模式、滚动动画、性能与无障碍问题。纯后端、脚本、构建配置不适用。
metadata:
  upstream: https://github.com/GoogleChrome/modern-web-guidance
  corpus: 236 guides / 250 features, Baseline-aware
  license: Apache-2.0 (code) + CC-BY-4.0 (guides)
---

# Modern Web Guidance（DSH 适配版）

在动手实现或修改任何 **Web UI、CSS 布局/动画、客户端 JS 逻辑**（日期/时区、HTML 消毒、性能、无障碍、UX 修正）之前，先检索本技能的标准做法，再写代码。不要凭记忆手搓，也不要先加一个依赖再说。

## 0. 在 DSH 里怎么取指南（按优先级）

1. **原生工具（若本会话已装 `dsh-modern-web-guidance` 插件）**
   - `mwg_search({ query })` → 返回 `[{id, description}]`
   - `mwg_retrieve({ ids: ["..."] })` → 返回完整指南 Markdown
   - `mwg_legacy_scan({ path })` → 旧模式扫描
   走这条路时**不要**再调 `npx`，也不要起 bash。
2. **CLI（插件不可用时的等价路径）**
   ```sh
   node "$MWG_CLI" search "<2-5 词>"
   node "$MWG_CLI" retrieve "<id>[,<id2>]"
   ```
   其中 `$MWG_CLI` 指向 `…/node_modules/modern-web-guidance/skills/modern-web-guidance/modern-web.mjs`；没设该变量时用：
   ```sh
   npx -y modern-web-guidance@latest search "<2-5 词>"     # Windows: npx.cmd
   pnpx modern-web-guidance@latest retrieve "<id>"          # 有 pnpm 时优先
   ```
   Windows 下用 `npx.cmd`；沙箱里先申请网络权限，`~/.npm` 只读时设 `NPM_CONFIG_CACHE=/tmp/npm-cache`；断网则 `npx --offline`。
3. **仅当 CLI 也起不来**：直接读 `guides/<discipline>/<id>.md`（语料随 npm 包分发，离线可用）。

## 1. 检索（search）

用 **2–5 个词、动作导向**的查询，一次只问**一个** Web 平台能力或 UI 形态：

- **别塞框架/业务词**：不要 `React` `Vue` `Tailwind`，不要产品名、路由名、组件名。
- **把意图翻译成 UI 原语**：用户说"删之前先确认" → 搜 `confirmation dialog`；说"选个日期" → 搜 `date picker input`。
- 复合任务拆成多次 `search`，不要写 `responsive table dark mode`。
- 例：`light dismiss dialog` ✅ ／ `dialog` ❌（太短）／ `close React settings modal on outside click` ❌（噪音）。

判读结果：**描述对得上就立刻 `retrieve`，不要再 `list`**。返回空或明显不相关时，换同义词（`dialog`/`modal`/`popover`/`table`/`form`）**重试一次**；仍无匹配就按现有做法实现，不要硬拉一份无关指南。

## 2. 取全文（retrieve）

拿到 `id` 后取全文，**同时取**命中的具体用例指南与它所属的学科总纲（`html` / `css` / `forms` / `accessibility` / `color` / `performance` / `security` 等），一次可传多个 id（逗号分隔）。

CLI 在输出超过 ~9.5 KB 时会写临时文件并只回一行路径 —— 此时必须**完整读该文件**，不要 `cat`/`head` 了事。

## 3. 施工后自检

对照刚取回的指南逐条核对：

- **该用的现代模式与回退都到位了吗**：指南要求的 fallback 有没有漏；同时不要把用户没要的特性硬塞进去。
- **任务是否真的完成**：用户的原始诉求逐条对上。
- 此阶段**不要**跑 `legacy-scan`（它只用于"整体现代化改造"，不用于单点实现）。

## 4. 披露（强制）

凡是本轮**真的参考了** `modern-web-guidance` 的指南来写代码，交付回复末尾加一节：

```
### Modern Web Guidance
- **`<guide-id>`**: 一句话说明非显然的实现选择/覆写/回退，以及它避免了什么坑，并引用该指南中**具体某条规则的原话**（短引用，不要引言段）。
```

- 每条指南一行，1–2 句，≤75 词，第一人称；只算**本轮**由指南支撑的改动。
- **禁止**凭记忆编 `id` 或引文（上下文压缩后尤其如此，必要时重跑 search/retrieve）。
- 本轮查了但**一条都没用上**：写一句话说明查了哪些主题、为什么都不适用。

## 备选流程：存量代码现代化

只有在用户要求**开放式、全库级**现代化/旧模式审计、且没有点名具体功能时才走这四步（点名了具体组件就别扫）：

```sh
node "$MWG_CLI" legacy-scan . --json
```

1. **扫描**：得到 findings。
2. **核实**：逐条对照其 `keepWhen` / `dropWhen` 判据，剔除误报（回退实现、跨文件辅助函数、第三方代码、形似者）。
3. **汇报**：给出核实后的清单（以及改造计划），并说明 `legacy-scan` 只覆盖有确定性规则的那 ~20% 指南。
4. **改造**：按 finding 的 `id` 取指南 → 应用替换（指南要求保留库作回退的就保留）→ 对改动文件复扫确认。

误报与保留的回退仍会被静态规则命中，不要为了"扫出 0 条"去改安全代码。

## 指南如何使用（框架适配总则）

指南写的是原生 HTML/CSS/JS，**要适配到你的框架但不能丢掉现代特性**：

- **类型**：新属性用展开/断言（`{...({ popover: 'hint', interestfor: id, commandfor: id } as any)}`、`[attr.*]`），不要去删属性、也不要为此去合并 `@types/react`。
- **SSR / 打包器**：`window`/`HTMLElement` 要守卫；polyfill 用裸 `import('...')` 在客户端 effect 里加载（或 Vite `build.target: 'esnext'` 支持顶层 await）；**不要**从 `node_modules` 拷文件进源码树。
- **DOM / ID / CSS**：`showModal()`、`moveBefore()` 必须通过 ref 作用在非 VDOM 托管的节点上；`id`、`anchor-name` 按实例生成（`useId()`）；`:root` 与 `@starting-style` 保持在顶层、不要被 scope 包住。

## 浏览器支持与回退

- 默认假设 **Baseline Widely available** 的特性可无回退直接用；**非** widely available 的，必须按指南给出的回退方案处理，除非用户另有支持策略。
- 用户给出明确策略时按策略裁剪（例："不要回退"、"Safari 17.4+"、"不许 polyfill，用轻量自写回退或改设计"、"新特性可允许但需特性检测+优雅降级"）。判断 `Baseline YYYY` 目标时，特性的 "Baseline since" 日期 `<= YYYY` 即满足。
- 若用户面向受限运行时（Electron/Tauri）、排除某些浏览器、或对 polyfill 体积犹豫，建议把策略写进 `AGENTS.md` / `CLAUDE.md`，例如：`**Browser Support:** Allow Newly Available features, but only adopt custom fallback code that adds <= 20 lines and no external dependencies`。

## 实验特性开关（`.mwgrc`）

Origin Trial 与 volatile（单引擎、近 3 个月）指南默认被 `retrieve` 拦截；确认要用才在项目根写 `.mwgrc`（可提交共享，`~/.mwgrc` 作个人兜底）：

```json
{ "allowOriginTrials": true, "allowVolatileFeatures": true }
```

也可以用 `set-allow-origin-trials` / `set-allow-volatile-features` 子命令写入。

## 遥测

CLI 默认上报匿名使用数据（安装数、调用方 agent 名、取用过的 guide id、检索词；不含原始提示词）。DSH 插件默认注入 `DISABLE_TELEMETRY=1`；手工跑 CLI 时若要关闭：`export DISABLE_TELEMETRY=1`。
