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
- 会话日志：`~/.dsh/sessions/<工作区>/<会话ID>/`
- 投影缓存：`~/.dsh/storages/session_projcache/sessions/<会话ID>.json`

「删除」只在保留期内把记录移入回收站，会话日志不动；到期或「彻底删除」才真正删文件。

## 安全说明

插件的 HTTP 接口（`/session-trash/api`）只接受：Host 为回环地址（`127.0.0.1` / `localhost`）、且 Origin 与 Host 同源的请求，其它一律 403。

## 许可

MIT，见 [LICENSE](LICENSE)。
