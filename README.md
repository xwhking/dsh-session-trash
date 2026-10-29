# DSH 对话回收站（dsh-session-trash）

给 DeepSeek Harness（DSH）用的一个小插件：**删除对话 → 进回收站 → 保留 3 天 → 到期自动永久删除**，期间随时可以恢复。

> 📖 想看完整来龙去脉（为什么 DSH 没有删除、四层隐藏机制、踩过的坑），请读 [BLOG.md](BLOG.md)。

> **历史说明（1.4.0 之前）**：那时删除后仍可能看到对话，只能靠重启让它消失——原因见下面第 2 节（活会话靠归档才压得住）。1.4.0 起，冷对话是纯移动、不再留归档痕迹；活会话用临时归档兜底，关掉即彻底隐藏。
>
## 功能

- **删除对话**：会话行的 `...` 菜单里多一项「删除对话」，点一下该对话立刻从所有列表消失。
- **保留 3 天**：删除时间与到期时间记录在 `~/.dsh/dsh-session-trash/state.json`，默认 3 天（可配置）。
- **自动过期**：宿主每 5 分钟检查一次，到期项被永久删除；启动时再补一次。
- **回收站面板**：侧栏底部的垃圾桶图标，列出标题、删除时间、剩余时间，以及**这篇现在处于什么状态**（见下文），可单条「恢复」「彻底删除」，也可「清空回收站」。
- **恢复**：未过期的对话回到原来的工作区。

---

# 原理（重要）

这个插件的难点不在"删文件"，而在于**"删掉"这件事在 DSH 里同时被两个东西决定**。理解这两个东西，就能理解所有行为。

## 1. 决定一篇对话是否出现在列表里的，是两个独立的东西

| | 是什么 | 谁在里面 | 移走它会发生什么 |
|---|---|---|---|
| **磁盘日志** | `~/.dsh/sessions/<工作区>/<会话ID>/session.v4.jsonl.zstd` | 对话的真实内容 | 平台不再有这篇的 summary，**任何列表都不再显示它** |
| **内存 Agent** | 你用过这篇之后平台留在内存里的 `Agent` 对象 | 只是"还开着"这件事 | 平台仍然会把它列出来 |

侧栏的渲染逻辑（从 DSH 打包产物里读到的）是：

```
每个工作区行 = sessionIds（工作区成员） ∩ summaries（平台会话列表）
```

`summaries` 来自平台会话列表，而平台会话列表来自**磁盘日志**。所以：

> **日志一移走，冷对话（平台不再持有 Agent）就从所有列表消失——不需要归档。**

这是本插件的核心做法：**移走日志就是删除**。

## 2. 只有一种情况需要额外手段：对话还"活着"

如果你删的是**刚刚还在用、平台内存里还留着 Agent 的对话**，那么日志虽然移走了，平台列表里**仍然有它**（内容在内存里）。这时侧栏照旧会显示它。

DSH **没有**提供任何"删除/释放会话"的接口，实测确认：

| 查的东西 | 结果 |
|---|---|
| `sessionPersistence` 服务 | 只有 `create / open / flush / stat / list`，**没有 delete** |
| 活会话的 Agent 对象 | 只有 `loopCtx / session / inbox / phase / ctx / send / cancel / …`，**没有 `dispose` / `close` / `destroy` / `stop`** |

所以插件唯一能用的开关就是**归档**，而归档正是"删了还会看见"的来源：它是 DSH 的一个**筛选状态**，被归档的对话仍然存在于归档列表里，而且归档提示上自带**撤销**。

## 3. 于是策略是：移动为主，归档只做临时兜底

```
删除一篇对话：
├─ 先 archiveSession(stopActivity: true)   ← 唯一的用途：停掉还在写这篇日志的工作
├─ 把日志目录移到 ~/.dsh/dsh-session-trash/files/<ID>/
├─ 从工作区成员里摘除（detachSession）
└─ 判断：平台现在还持有它的 Agent 吗？
   ├─ 不持有（绝大多数）→ 立刻取消归档 → 归档列表里干干净净 ✅
   └─ 还持有（你正开着）→ 保留归档，并标记 archiveFallback（临时兜底）
```

**所以：普通对话删除后，归档列表里不会留下任何东西。** 只有"你此刻还开着、删完还继续开着"的那 1～2 篇会用归档兜底。

## 4. 但"删了还在"的真正解法在浏览器里，不在 Host 里

上面这套 Host 逻辑保证的是**内容真的没了、列表数据真的没了**。可"界面上那一行还在"是**另一件事**：侧栏是浏览器画的，它显示什么由浏览器决定，而且：

- 活会话（还开着）即使日志移走，**宿主仍会在会话列表里返回它**——`ctx.sessions` / `sessionController` 没有任何删除/驱逐接口（实测确认，两个成熟竞品也都写进了 README）；
- DSH 的归档筛选有「显示已归档」这一档，**那一档会把归档行当正常行渲染出来**。

所以仅靠 Host 层做不到"条目一定不渲染"。**必须让浏览器自己决定不画它。**

插件因此在客户端加了第 4 层：

```
已删会话 id 集合（浏览器 localStorage）
        ↓
侧栏渲染出 [data-row-key="session:<id>"] 时
        ↓
若 id 在集合里 → 该行 display:none（不渲染）
        ↓
MutationObserver 监听侧栏变化，刷新/切档/宿主再推列表也照样隐藏
```

效果：**删完当场消失；归档筛选切到哪一档都不会再出现；刷新页面也不会回来。** 这是唯一能覆盖所有情况的方案，因为"显示什么"终究由浏览器决定，而 Host 给不了删除接口。

- 恢复时把 id 从集合里移除，行立刻恢复渲染；
- 启动时与 Host 回收站对账，把旧版本删过的 id 也补上隐藏；
- 集合存在 `localStorage`（key `dsh-session-trash.hidden.v1`），重启浏览器也保留。

> 这层与归档无关：**归档负责"当场消失"，CSS 负责"永远不显示"，移日志负责"真删"**，三者职责分开。

## 5. 兜底会自动撤销（这就是"僵尸"也能清掉的原因）

插件每 2 秒检查一次回收站里带 `archiveFallback` 标记的对话：

| 平台还持有 Agent | 归档标记 | 插件动作 |
|---|---|---|
| 是 | 已设置 | 不动它（这是唯一能隐藏它的手段） |
| 是 | **被清掉了**（平台撤销） | **重新归档** —— 撤销放不回删掉的对话 |
| 否（平台放手了） | 已设置 | **取消归档** —— 现在靠"日志不在"隐藏就够了 |
| 否 | 已清掉 | 清掉标记，收工 |

这就是为什么：**空壳会话（`blank`）删掉后，等你关掉它/重启，插件会自动把归档标记撤掉**，归档列表不会长期挂着它。

判定"还持有"用的是 `ctx.get('agents')?.get(id) !== undefined`。这只回答"平台内存里还有没有这篇"，**不是**"它是不是正在跑"——后者用的是另一套 `agent/status` 事件。

## 6. 恢复与彻底删除

| 操作 | 做什么 |
|---|---|
| **恢复** | 把日志目录搬回原工作区 → `attachSession` 挂回工作区成员 → 取消归档 |
| **彻底删除** | 删掉回收站副本 / 残留日志 / 投影缓存 → 摘除工作区成员 → 若平台已不持有则清掉归档标记（避免归档集合累积死 id）；仍持有则保留标记，否则会立刻重新出现在列表里 |

## 7. 几个必须知道的边界

1. **侧栏条目：删除后一定不再渲染**（第 4 层的 CSS 兜底保证，与归档档位、宿主内存状态无关）。这是本插件对"删了还在"的最终回答。
2. **内容：真删**。日志移出 `~/.dsh/sessions`，进回收站 `files/`，可恢复 3 天。
3. **唯一残留**：活会话的 Agent 在宿主内存里，DSH 没有驱逐接口，**只能靠重启 DSH 才彻底释放**——但那只是内存状态，侧栏已经不会显示它，所以不影响使用。
4. **从未落盘的对话**（新建但一条消息都没发）没有日志可移，用归档隐藏 + CSS 不渲染；重启 DSH 后彻底消失。
5. **正在运行的对话**不会被硬删：`archiveSession(stopActivity: true)` 会先停掉它，避免它继续往一个已被移走的路径写。
6. **删除是可以后悔的**：3 天内都在回收站里，点「恢复」原样搬回（字节一致）。超过 3 天或点「彻底删除」才是真的没了。

回收站面板每条会标出当前状态：

| 标记 | 含义 |
|---|---|
| 日志已移走，任何列表都看不到 | 正常删除，纯移动 |
| 你仍开着它，关闭后会彻底隐藏 | 走了临时归档兜底，关掉即彻底隐藏并撤销归档 |
| 没有落盘内容，重启后彻底消失 | 从未落盘的空壳 |

---

## 安装

前置条件：已安装 DSH 桌面版，profile 里有 `plugin_manager`（默认自带）。

推荐用 DSH 里的 Agent 执行 `plugin_manager`（Web 侧栏 **Plugins** 页也能做同样的操作）。

### 方式一：git 地址安装（推荐）

```
plugin_manager  action: install_bundle
                target: github:<你的用户名>/dsh-session-trash
```

### 方式二：克隆到本地后安装

```bash
git clone https://github.com/<你的用户名>/dsh-session-trash.git D:\plugins\dsh-session-trash
```

然后：

```
plugin_manager  action: install_bundle
                target: D:\plugins\dsh-session-trash
```

### 方式三：Release 压缩包

1. 在仓库 **Releases** 页下载 `dsh-session-trash-<版本>.tgz`。
2. 解压到固定目录，例如 `D:\plugins\dsh-session-trash`。
3. `install_bundle`，`target` 填该目录绝对路径。

安装完刷新页面，侧栏会出现垃圾桶图标，会话菜单里会出现「删除对话」。

> 从本地目录安装时，profile 里记的是 `link:<目录>`。**不要删除或移动那个目录**，否则插件失效。

### 安装/更新时报 EPERM（Windows）

```
[ERR_PNPM_EPERM] [importPackage ...\node_modules\dsh-session-trash]
EPERM: operation not permitted, rename '..._tmp_1234_1' -> '...\dsh-session-trash'
```

原因是 `link:` 安装会生成一个 **junction（目录联接）**，而 pnpm 更新时是「把临时目录 rename 覆盖过去」，NTFS 不允许这样替换 reparse point，于是每次都失败，临时目录被丢进 `node_modules\.ignored`。

修复（只删 junction 本身，不会碰你的源码目录）：

```bash
node scripts/fix-link-install.cjs C:\Users\<你>\.dsh\profiles\desktop          # 先试运行
node scripts/fix-link-install.cjs C:\Users\<你>\.dsh\profiles\desktop --yes    # 执行修复
```

然后重新 `install_bundle` 即可。

> 脚本会先确认目标是 junction、删除后确认源目录仍在；如果那里是真目录，它会拒绝删除。
> 也可以手动处理：在 `node_modules` 里对 `dsh-session-trash` 点右键删除（**不要**按住什么键递归删除），再清掉 `node_modules\.ignored`，然后重装。

## 配置

打开 profile 的 `cordis.patch.yml`，找到 `session-trash` 那一行改 `config`：

```yaml
- id: session-trash
  name: 'dsh-session-trash'
  config:
    retentionDays: 3      # 保留天数
```

改完重新启用插件生效。

## 目录结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：删除 / 恢复 / 彻底删除、过期清理、隐藏守卫、`/session-trash/api` |
| `client.js` | 浏览器半：会话菜单项、回收站面板、侧栏图标 |
| `cordis.patch.yml` | bundle 插入行 |
| `locale/zh.json`、`locale/en.json` | 插件列表里显示的标题与说明 |
| `icon.svg` | 插件图标 |
| `README.md` | 安装与原理速查（本文件） |
| `BLOG.md` | 完整分享文章：功能、实现、踩坑、下载 |
| `scripts/e2e.cjs` | 端到端验收（见下） |
| `scripts/fix-link-install.cjs` | 修复 Windows 上 `link:` 安装的 EPERM 报错 |
| `scripts/check-*.cjs` | 静态检查：package.json 无 BOM、包名/模块 ID 一致、中英字典键一致、隐藏守卫决策表、客户端隐藏层 |

## 数据存放

- 回收站记录：`~/.dsh/dsh-session-trash/state.json`
- 回收站里的会话日志：`~/.dsh/dsh-session-trash/files/<会话ID>/`
- 会话日志：`~/.dsh/sessions/<工作区>/<会话ID>/`
- 投影缓存：`~/.dsh/storages/session_projcache/sessions/<会话ID>.json`
- 最近一次失败的原因：`~/.dsh/dsh-session-trash/last-error.json`

## 出问题时

1. 界面会弹出红字说明原因，而不是静默失败。
2. 同样的原因连同调用栈会写到 `~/.dsh/dsh-session-trash/last-error.json`，装到别人机器上排查时可以直接看这个文件。
3. 改完 `index.js` / `client.js` 后需要在插件列表里关掉再打开（或刷新页面），否则跑的还是旧代码。
4. 静态检查：`npm run check`。
5. 端到端：`node scripts/e2e.cjs`（只读）或
   `E2E_SESSION_ID=<一个可以牺牲的冷会话ID> node scripts/e2e.cjs`（会动真实日志，跑完自动还原）。
   它会断言**平台的会话列表里真的没有了**、**冷对话删除后归档集合里没有它**，而不只是文件挪走了。

> GUI 端口每次启动可能不同（例如 `127.0.0.1:1349`）。脚本默认用 `1349`，可用 `E2E_ORIGIN` / `ST_ORIGIN` 覆盖。

## 安全说明

插件的 HTTP 接口（`/session-trash/api`）只接受：Host 为回环地址（`127.0.0.1` / `localhost`）、且 Origin 与 Host 同源的请求，其它一律 403。

## 许可

MIT，见 [LICENSE](LICENSE)。
