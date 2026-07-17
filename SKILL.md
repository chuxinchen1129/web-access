---
name: web-access
license: MIT
github: https://github.com/eze-is/web-access
description:
  所有联网操作必须通过此 skill 处理，包括：搜索、网页抓取、登录后操作、网络交互等。
  触发场景：用户要求搜索信息、查看网页内容、访问需要登录的网站、操作网页界面、抓取社交媒体内容（小红书、微博、推特等）、读取动态渲染页面、以及任何需要真实浏览器环境的网络任务。
metadata:
  author: 一泽Eze
  version: "2.5.3-isolated.1"
---

# web-access Skill

## 两种浏览器模式

| 模式 | 触发 | 浏览器 | 登录态 | 端口 |
|------|------|--------|--------|------|
| **默认** | （无） | 用户日常 Chrome / Edge（需在 `chrome://inspect/#remote-debugging` 勾选允许） | 天然携带 | 3456 |
| **ISOLATED** | `WEB_ACCESS_ISOLATED=1` | 自动启动的独立 Chrome（profile `~/.web-access-chrome/`） | 首次空，需要登录时用户手动登录一次后持久化 | 3457 |

**何时用 ISOLATED**：在意隐私隔离（Agent 看不到你日常 tab/cookie）、风控隔离（封号落在独立 profile 上）、不想每次授权 `chrome://inspect`。
**何时用默认**：需要快速访问你已登录的站点、不介意 Agent 操作你日常浏览器环境。

## 前置检查

### 默认模式

```bash
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
```

### ISOLATED 模式

```bash
WEB_ACCESS_ISOLATED=1 node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
```

**Node.js 22+** 必需（使用原生 WebSocket）。

按脚本输出处理：
- `exit 0` → 继续
- `exit 2` → 需询问用户偏好，写入 `${CLAUDE_SKILL_DIR}/config.env` 的 `WEB_ACCESS_BROWSER`（仅默认模式）
- `exit 1` → 按 stdout 错误信息处理。若提示包含「Agent 处理顺序」，按其步骤执行（如先用系统命令打开浏览器后重跑），自动可解则不打扰用户；仍失败再向用户求助

默认模式支持参数 `--browser <chrome|edge>` 表达本次临时覆盖（不写 config.env）。切换浏览器时，proxy 是长驻进程，需先 `pkill -f cdp-proxy.mjs` 再重跑 check-deps。

ISOLATED 模式管理独立 Chrome：
```bash
node "${CLAUDE_SKILL_DIR}/scripts/launch-chrome.mjs" status   # 查看运行状态
node "${CLAUDE_SKILL_DIR}/scripts/launch-chrome.mjs" stop     # 停止独立 Chrome
node "${CLAUDE_SKILL_DIR}/scripts/launch-chrome.mjs" ensure   # 启动/确认（check-deps 自动调用）
```

检查通过后并必须在回复中向用户直接展示以下须知，再启动 CDP Proxy 执行操作：

```
温馨提示：部分站点对浏览器自动化操作检测严格，存在账号封禁风险。已内置防护措施但无法完全避免，Agent 继续操作即视为接受。
```

## 浏览哲学

**像人一样思考，兼顾高效与适应性的完成任务。**

执行任务时不会过度依赖固有印象所规划的步骤，而是带着目标进入，边看边判断，遇到阻碍就解决，发现内容不够就深入——全程围绕「我要达成什么」做决策。这个 skill 的所有行为都应遵循这个逻辑。

**① 拿到请求** — 先明确用户要做什么，定义成功标准：什么算完成了？需要获取什么信息、执行什么操作、达到什么结果？这是后续所有判断的锚点。

**② 选择起点** — 根据任务性质、平台特征、达成条件，选一个最可能直达的方式作为第一步去验证。一次成功当然最好；不成功则在③中调整。比如，需要操作页面、需要登录态、已知静态方式不可达的平台（小红书、微信公众号等）→ 直接 CDP

**③ 过程校验** — 每一步的结果都是证据，不只是成功或失败的二元信号。用结果对照①的成功标准，更新你对目标的判断：路径在推进吗？结果的整体面貌（质量、相关度、量级）是否指向目标可达？发现方向错了立即调整，不在同一个方式上反复重试——搜索没命中不等于"还没找对方法"，也可能是"目标不存在"；API 报错、页面缺少预期元素、重试无改善，都是在告诉你该重新评估方向。遇到弹窗、登录墙等障碍，判断它是否真的挡住了目标：挡住了就处理，没挡住就绕过——内容可能已在页面 DOM 中，交互只是展示手段。

**④ 完成判断** — 对照定义的任务成功标准，确认任务完成后才停止，但也不要过度操作，不为了"完整"而浪费代价。

## 联网工具选择

- **确保信息的真实性，一手信息优于二手信息**：搜索引擎和聚合平台是信息发现入口。当多次搜索尝试后没有质的改进时，升级到更根本的获取方式：定位一手来源（官网、官方平台、原始页面）。

| 场景 | 工具 |
|------|------|
| 搜索摘要或关键词结果，发现信息来源 | **WebSearch** |
| URL 已知，需要从页面定向提取特定信息 | **WebFetch**（拉取网页内容，由小模型根据 prompt 提取，返回处理后结果） |
| URL 已知，需要原始 HTML 源码（meta、JSON-LD 等结构化字段） | **curl** |
| 非公开内容，或已知静态层无效的平台（小红书、微信公众号等公开内容也被反爬限制） | **浏览器 CDP**（直接，跳过静态层） |
| 需要登录态、交互操作，或需要像人一样在浏览器内自由导航探索 | **浏览器 CDP** |
| 网页 / HTML 文档转 PNG（移动端样式、全页截图） | **浏览器 CDP** `/screenshotFull` |

浏览器 CDP 不要求 URL 已知——可从任意入口出发，通过页面内搜索、点击、跳转等方式找到目标内容。WebSearch、WebFetch、curl 均不处理登录态。

**Jina**（可选预处理层，可与 WebFetch/curl 组合使用，由于其特性可节省 tokens 消耗，请积极在任务合适时组合使用）：第三方网络服务，可将网页转为 Markdown，大幅节省 token 但可能有信息损耗。调用方式为 `r.jina.ai/example.com`（URL 前加前缀，不保留原网址 http 前缀），限 20 RPM。适合文章、博客、文档、PDF 等以正文为核心的页面；对数据面板、商品页等非文章结构页面可能提取到错误区块。

进入浏览器层后，`/eval` 就是你的眼睛和手：

- **看**：用 `/eval` 查询 DOM，发现页面上的链接、按钮、表单、文本内容——相当于「看看这个页面有什么」
- **做**：用 `/click` 点击元素、`/scroll` 滚动加载、`/eval` 填表提交——像人一样在页面内自然导航
- **读**：用 `/eval` 提取文字内容，判断图片/视频是否承载核心信息——是则提取媒体 URL 定向读取或 `/screenshot` 视觉识别

浏览网页时，**先了解页面结构，再决定下一步动作**。不需要提前规划所有步骤。

### 补充：本地浏览器资源

用户指向**本人访问过的页面**（"我之前看的那个讲 X 的文章"、"上次打开过的 XX 面板"）或**组织内部系统**（"我们的 XX 平台"、"公司那个 YY 系统"等公网搜不到的目标）时，检索本地浏览器（Chrome / Edge）书签/历史：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/find-url.mjs" [关键词...] [--only bookmarks|history] [--browser chrome|edge] [--limit N] [--since 1d|7h|YYYY-MM-DD] [--sort recent|visits]
```

关键词空格分词、多词 AND，匹配 title + url（可省略）；默认遍历所有已安装的 Chromium 系浏览器（Chrome、Edge），`--browser` 限定单一来源；`--since` / `--sort` 仅作用于历史；默认按最近访问倒序，`--sort visits` 按访问次数排序（适合"高频访问的网站"这类场景）。

### 程序化操作与 GUI 交互

浏览器内操作页面有两种方式：

- **程序化方式**（构造 URL 直接导航、eval 操作 DOM）：成功时速度快、精确，但对网站来说不是正常用户行为，可能触发反爬机制。
- **GUI 交互**（点击按钮、填写输入框、滚动浏览）：GUI 是为人设计的，网站不会限制正常的 UI 操作，确定性最高，但步骤多、速度慢。

根据对目标平台的了解来灵活选择方式。GUI 交互也是程序化方式的有效探测——通过一次真实交互观察站点的实际行为（URL 模式、必需参数、页面跳转逻辑），为后续程序化操作提供依据；同时当程序化方式受阻时，GUI 交互是可靠的兜底。

**站点内交互产生的链接是可靠的**：通过用户视角中的可交互单元（卡片、条目、按钮）进行的站点内交互，自然到达的 URL 天然携带平台所需的完整上下文。而手动构造的 URL 可能缺失隐式必要参数，导致被拦截、返回错误页面、甚至触发反爬。

## 浏览器 CDP 模式

通过 CDP Proxy 直连浏览器，所有操作通过 curl 调用 HTTP API。两种模式 API 完全一致，**仅端口不同**：默认模式 `localhost:3456`，ISOLATED 模式 `localhost:3457`。

**默认模式**：直连用户日常浏览器（Chrome / Edge / Chromium 等 Chromium 系），天然携带登录态。
**ISOLATED 模式**：连自动启动的独立 Chrome，profile 在 `~/.web-access-chrome/`，与用户日常浏览器完全隔离。

若无用户明确要求，不主动操作用户已有 tab（默认模式下），所有操作都在自己创建的后台 tab 中进行，保持对用户环境的最小侵入。不关闭用户 tab 的前提下，完成任务后关闭自己创建的 tab，保持环境整洁。

### 启动

```bash
# 默认模式
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"

# ISOLATED 模式
WEB_ACCESS_ISOLATED=1 node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
```

脚本会依次检查 Node.js、浏览器调试端口，并确保 Proxy 已连接（未运行则自动启动并等待）。Proxy 启动后持续运行。

### Proxy API

所有操作通过 curl 调用 HTTP API。下面示例使用默认模式端口 `3456`；**ISOLATED 模式把 `3456` 换成 `3457`**。

```bash
# 列出已打开的 tab（默认模式连用户日常浏览器 → 用户所有 tab；ISOLATED 模式 → 独立 Chrome 的 tab）
curl -s http://localhost:3456/targets

# 创建新后台 tab（自动等待加载）— URL 走 POST body，避免目标 URL 含 query 时被切分
curl -s -X POST --data-raw 'https://example.com' http://localhost:3456/new

# 页面信息
curl -s "http://localhost:3456/info?target=ID"

# 执行任意 JS：可读写 DOM、提取数据、操控元素、触发状态变更、提交表单、调用内部方法
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'document.title'

# 捕获页面渲染状态（含视频当前帧）
curl -s "http://localhost:3456/screenshot?target=ID&file=/tmp/shot.png"

# 导航（URL 走 POST body，target 走 query）、后退
curl -s -X POST --data-raw 'https://example.com' "http://localhost:3456/navigate?target=ID"
curl -s "http://localhost:3456/back?target=ID"

# 点击（POST body 为 CSS 选择器）— JS el.click()，简单快速，覆盖大多数场景
curl -s -X POST "http://localhost:3456/click?target=ID" -d 'button.submit'

# 真实鼠标点击 — CDP Input.dispatchMouseEvent，算用户手势，能触发文件对话框
curl -s -X POST "http://localhost:3456/clickAt?target=ID" -d 'button.upload'

# 文件上传 — 直接设置 file input 的本地文件路径，绕过文件对话框
curl -s -X POST "http://localhost:3456/setFiles?target=ID" -d '{"selector":"input[type=file]","files":["/path/to/file.png"]}'

# 滚动（触发懒加载）
curl -s "http://localhost:3456/scroll?target=ID&y=3000"
curl -s "http://localhost:3456/scroll?target=ID&direction=bottom"

# 关闭 tab
curl -s "http://localhost:3456/close?target=ID"
```

### 页面内导航

两种方式打开页面内的链接：

- **`/click`**：在当前 tab 内直接点击用户视角中的可交互单元，简单直接，串行处理。适合需要在同一页面内连续操作的场景，如点击展开、翻页、进入详情等。
- **`/new` + 完整 URL**：使用目标链接的完整地址（包含所有URL参数），在新 tab 中打开。适合需要同时访问多个页面的场景。

很多网站的链接包含会话相关的参数（如 token），这些参数是正常访问所必需的。提取 URL 时应保留完整地址，不要裁剪或省略参数。URL 通过 POST body 原样传入 `/new` 或 `/navigate`。

> **v2.5.3 迁移提示**：若引用的站点经验文件（`references/site-patterns/*.md`）或其它脚本中仍含 `GET /new?url=...` 或 `/navigate?target=...&url=...` 的旧写法，调用会收到迁移指引。按 [`references/migration-2.5.3.md`](references/migration-2.5.3.md) 就地改写为 POST body 后再使用，并顺手把该站点经验文件更新掉。

### 媒体资源提取

判断内容在图片里时，用 `/eval` 从 DOM 直接拿图片 URL，再定向读取——比全页截图精准得多。

需要把整个页面（或 HTML 文档）以 PNG 形式保存时，用 `/screenshotFull` —— 支持**设备模拟**（默认移动端 414×900、DPR 2，CSS `@media (max-width)` 断点会按移动端生效）+ **全页截图**（截到 `scrollHeight`，不会只截首屏）。详见 `references/cdp-api.md`。典型场景：HTML 报告 / 备调文档转图片便于 AirDrop 或微信传文件、网页设计快照、移动端 vs 桌面端双视图对比。

### 技术事实
- 页面中存在大量已加载但未展示的内容——轮播中非当前帧的图片、折叠区块的文字、懒加载占位元素等，它们存在于 DOM 中但对用户不可见。以数据结构（容器、属性、节点关系）为单位思考，可以直接触达这些内容。
- DOM 中存在选择器不可跨越的边界（Shadow DOM 的 `shadowRoot`、iframe 的 `contentDocument`等）。eval 递归遍历可一次穿透所有层级，返回带标签的结构化内容，适合快速了解未知页面的完整结构。
- `/scroll` 到底部会触发懒加载，使未进入视口的图片完成加载。提取图片 URL 前若未滚动，部分图片可能尚未加载。
- 拿到媒体资源 URL 后，公开资源可直接下载到本地后用读取；需要登录态才可获取的资源才需要在浏览器内 navigate + screenshot。
- 短时间内密集打开大量页面（如批量 `/new`）可能触发网站的反爬风控。
- 平台返回的"内容不存在""页面不见了"等提示不一定反映真实状态，也可能是访问方式的问题（如 URL 缺失必要参数、触发反爬）而非内容本身的问题。

### 视频内容获取

用户浏览器真实渲染，截图可捕获当前视频帧。核心能力：通过 `/eval` 操控 `<video>` 元素（获取时长、seek 到任意时间点、播放/暂停/全屏），配合 `/screenshot` 采帧，可对视频内容进行离散采样分析。

### 登录判断

**默认模式**：用户日常浏览器天然携带登录态，大多数常用网站已登录。

**ISOLATED 模式**：独立 Chrome 首次空 profile，所有站点都是未登录态。用户手动登录一次后 profile 持久化，下次自动保留。

登录判断的核心问题只有一个：**目标内容拿到了吗？**

打开页面后先尝试获取目标内容。只有当确认**目标内容无法获取**且判断登录能解决时，才告知用户：
- 默认模式："请在你的浏览器中登录 [网站名]，完成后告诉我继续。"
- ISOLATED 模式："请在弹出的独立 Chrome 窗口里登录 [网站名]（profile 会记住登录态，下次无需重复），完成后告诉我继续。"

登录完成后无需重启任何东西，直接刷新页面继续。

### 任务结束

用 `/close` 关闭自己创建的 tab，必须保留用户原有的 tab 不受影响（默认模式下尤其重要）。

Proxy 持续运行，不建议主动停止：
- **默认模式**：proxy 重启后需要在浏览器中重新授权 CDP 连接（`chrome://inspect/#remote-debugging`）
- **ISOLATED 模式**：proxy 重启无需重新授权；独立 Chrome 进程也建议保留，关闭后下次启动 profile 仍在但需重新拉起 Chrome

## 并行调研：子 Agent 分治策略

任务包含多个**独立**调研目标时（如同时调研 N 个项目、N 个来源），鼓励合理分治给子 Agent 并行执行，而非主 Agent 串行处理。

**好处：**
- **速度**：多子 Agent 并行，总耗时约等于单个子任务时长
- **上下文保护**：抓取内容不进入主 Agent 上下文，主 Agent 只接收摘要，节省 token

**并行 CDP 操作**：每个子 Agent 在当前浏览器实例中（默认模式连用户日常浏览器；ISOLATED 模式连独立 Chrome），自行创建所需的后台 tab（`/new`），自行操作，任务结束自行关闭（`/close`）。所有子 Agent 共享一个浏览器、一个 Proxy，通过不同 targetId 操作不同 tab，无竞态风险。

**ISOLATED 模式下并行**：若主 Agent 希望子 Agent 也用独立 Chrome，需在子 Agent prompt 中说明 `WEB_ACCESS_ISOLATED=1` 环境变量需要传递（子 Agent 加载 skill 后会读这个环境变量）。否则子 Agent 会走默认模式连用户日常浏览器。

**子 Agent Prompt 写法：目标导向，而非步骤指令**
- 必须在子 Agent prompt 中写 `必须加载 web-access skill 并遵循指引` ，子 Agent 会自动加载 skill，无需在 prompt 中复制 skill 内容或指定路径。
- 子 Agent 有自主判断能力。主 Agent 的职责是说清楚**要什么**，仅在必要与确信时限定**怎么做**。过度指定步骤会剥夺子 Agent 的判断空间，反而引入主 Agent 的假设错误。**避免 prompt 用词对子 Agent 行为的暗示**：「搜索xx」会把子 Agent 锚定到 WebSearch，而实际上有些反爬站点需要 CDP 直接访问主站才能有效获取内容。主 Agent 写 prompt 时应描述目标（「获取」「调研」「了解」），避免用暗示具体手段的动词（「搜索」「抓取」「爬取」）。

**分治判断标准：**

| 适合分治 | 不适合分治 |
|----------|-----------|
| 目标相互独立，结果互不依赖 | 目标有依赖关系，下一个需要上一个的结果 |
| 每个子任务量足够大（多页抓取、多轮搜索） | 简单单页查询，分治开销大于收益 |
| 需要 CDP 浏览器或长时间运行的任务 | 几次 WebSearch / Jina 就能完成的轻量查询 |

## 信息核实类任务

核实的目标是**一手来源**，而非更多的二手报道。多个媒体引用同一个错误会造成循环印证假象。

搜索引擎和聚合平台是信息发现入口，是**定位**信息的工具，不可用于直接**证明**真伪。找到来源后，直接访问读取原文。同一原则适用于工具能力/用法的调研——官方文档是一手来源，不确定时先查文档或源码，不猜测。

| 信息类型 | 一手来源 |
|----------|---------|
| 政策/法规 | 发布机构官网 |
| 企业公告 | 公司官方新闻页 |
| 学术声明 | 原始论文/机构官网 |
| 工具能力/用法 | 官方文档、源码 |

**找不到官网时**：权威媒体的原创报道（非转载）可作为次级依据，但需向用户说明："未找到官方原文，以下核实来自[媒体名]报道，存在转述误差可能。"单一来源时同样向用户声明。

## 站点经验

操作中积累的特定网站经验，按域名存储在 `references/site-patterns/` 下。

确定目标网站后，如果前置检查输出的 site-patterns 列表中有匹配的站点，必须读取对应文件获取先验知识（平台特征、有效模式、已知陷阱）。经验内容标注了发现日期，当作可能有效的提示而非保证——如果按经验操作失败，回退通用模式并更新经验文件。

CDP 操作成功完成后，如果发现了有必要记录经验的新站点或新模式（URL 结构、平台特征、操作策略），主动写入对应的站点经验文件。只写经过验证的事实，不写未确认的猜测。

文件格式：
```markdown
---
domain: example.com
aliases: [示例, Example]
updated: 2026-03-19
---
## 平台特征
架构、反爬行为、登录需求、内容加载方式等事实

## 有效模式
已验证的 URL 模式、操作策略、选择器

## 已知陷阱
什么会失败以及为什么
```
经验/陷阱内容标注发现日期，当作"可能有效的提示"而非"保证正确的事实"。

## 故障排查

### ISOLATED 模式

| 现象 | 处理 |
|------|------|
| `chrome: 启动超时（15s 内端口未就绪）` | 可能 Chrome 进程已存在但 profile 锁住。先 `node launch-chrome.mjs stop` 再 `ensure` |
| 端口 9224 被其他进程占用 | 设 `WEB_ACCESS_CHROME_PORT=其他端口` 同时设 `WEB_ACCESS_CHROME_PROFILE=独立路径` 避免混淆 |
| 独立 Chrome 找不到（如自定义路径） | 设 `WEB_ACCESS_CHROME_PATH=/path/to/chrome` |
| profile 损坏 / 行为异常 | `rm -rf ~/.web-access-chrome/` 后重新 `ensure`（会丢失登录态） |
| 想用 Edge / Chromium 而非 Chrome | 把可执行文件软链到 Chrome 标准路径，或设 `WEB_ACCESS_CHROME_PATH` |

### 默认模式

| 现象 | 处理 |
|------|------|
| `browser: 未连接` | 浏览器地址栏打开 `chrome://inspect/#remote-debugging`，勾选允许 |
| `browser: needs decision` | 写 `${CLAUDE_SKILL_DIR}/config.env` 的 `WEB_ACCESS_BROWSER=<chrome|edge>` |
| 切换浏览器后 proxy 仍连旧浏览器 | `pkill -f cdp-proxy.mjs` 后重跑 check-deps |

## References 索引

| 文件 | 何时加载 |
|------|---------|
| `references/cdp-api.md` | 需要 CDP API 详细参考、JS 提取模式、错误处理时 |
| `references/site-patterns/{domain}.md` | 确定目标网站后，读取对应站点经验 |
