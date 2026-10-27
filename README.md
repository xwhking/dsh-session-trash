# DSH 对话回收站（dsh-session-trash）

给 DeepSeek Harness（DSH）用的一个小插件：**删除对话 → 进回收站 → 保留 3 天 → 到期自动永久删除**，期间随时可以恢复。

## 功能

- **删除对话**：在左侧会话行的 `...` 菜单里多一项「删除对话」，点一下该对话立刻从所有列表消失。
- **保留 3 天**：删除时间与到期时间记录在 `~/.dsh/dsh-session-trash/state.json`，默认保留 3 天（可配置）。
- **自动过期**：宿主每 5 分钟检查一次，到期项会被永久删除；插件启动时也会补一次。
- **回收站面板**：侧栏底部的垃圾桶图标，列出被删对话的标题、删除时间、剩余时间，可单条「恢复」或「彻底删除」，也可「清空回收站」。
- **恢复**：未过期的对话会回到原来的工作区和原来的位置。

「彻底删除」会清理这些内容：会话日志目录、投影缓存、归档标记、工作区归属记录。

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
| `index.js` | Host 半：删除 / 恢复 / 彻底删除、过期清理、`/session-trash/api` 接口 |
| `client.js` | 浏览器半：会话菜单项、回收站面板、侧栏图标 |
| `cordis.patch.yml` | bundle 插入行 |
| `locale/zh.json`、`locale/en.json` | 插件列表里显示的标题与说明 |
| `icon.svg` | 插件图标 |

## 数据存放

- 回收站记录：`~/.dsh/dsh-session-trash/state.json`
- 回收站里的会话日志：`~/.dsh/dsh-session-trash/files/<会话ID>/`
- 会话日志：`~/.dsh/sessions/<工作区>/<会话ID>/`
- 投影缓存：`~/.dsh/storages/session_projcache/sessions/<会话ID>.json`
- 最近一次失败的原因：`~/.dsh/dsh-session-trash/last-error.json`

「删除」＝把会话日志目录移出 `~/.dsh/sessions`。平台的会话列表（侧栏就是它渲染的）只认磁盘上的日志，所以移走之后这篇对话在**任何**列表里都不再出现，也无法继续。

为什么不是「归档」：归档会被平台自己的归档列表收进去，而那条归档提示上带着**撤销**，一点就把删掉的对话放回来了——这正是「删了又回来」的原因。所以对有日志的对话，移走日志后插件会立刻把归档标记去掉，既不留归档条目，也不留可撤销的东西。

对于**还没写过日志**的对话（新建但从未落盘），磁盘上没有东西可移走，只能用归档隐藏；后台守卫每 2 秒检查一次，一旦被外部「取消归档」就重新隐藏，直到 3 天到期或「彻底删除」。这类对话在重启 DSH 后彻底消失（磁盘上本来就没有内容）。

## 出问题时

1. 界面会弹出红字说明原因，而不是静默失败。
2. 同样的原因连同调用栈会写到 `~/.dsh/dsh-session-trash/last-error.json`，装到别人机器上排查时可以直接看这个文件。
3. 改完 `index.js` / `client.js` 后需要在插件列表里关掉再打开（或刷新页面），否则跑的还是旧代码。
4. `node scripts/e2e.cjs` 会对着正在跑的 GUI 把「删除 → 恢复 → 彻底删除」跑一遍，并断言**平台的会话列表里真的没有了**（不只是文件挪走了）；加 `E2E_SESSION_ID=<一个可以牺牲的会话ID>` 才会动真实日志（跑完自动还原）。

## 安全说明

插件的 HTTP 接口（`/session-trash/api`）只接受：Host 为回环地址（`127.0.0.1` / `localhost`）、且 Origin 与 Host 同源的请求，其它一律 403。

## 许可

MIT，见 [LICENSE](LICENSE)。
