# OpenCode 提问导航

一个 Chrome MV3 扩展，用于增强 `opencode pair` 的 Web 页面：在聊天窗口右侧显示一条垂直的提问导航，hover 查看提问摘要，点击跳转到对应消息。

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`。
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本目录。
4. 刷新 `opencode pair` 打开的页面（默认 `http://127.0.0.1:28894`）。

## 使用

- 右侧的横条对应当前会话里的每一条用户提问，上旧下新。
- 未选中项是短浅灰横条，当前项是长黑条；点击热区比横条本身更大。
- 鼠标悬停或键盘聚焦某条 dash：显示一段统一格式的简短摘要；过长内容会省略，不分标题/正文层级。
- 点击 dash：跳转到对应消息；如果消息较早、页面还没加载，OpenCode 会自动加载更早的历史。
- 滚动聊天时，当前 dash 会跟随高亮；在会话底部时优先高亮最新一条。
- 点击某条提问后会保持选中，直到你再次滚动时间线或使用方向键。
- rail 获得焦点后，可以用 `↑` / `↓` 切换，`Enter` 跳转。

## 实现方式

- 通过同源 `GET /api/session/{sessionID}/message?type=user&order=asc` 获取用户提问，按 `cursor` 翻页（单页上限 200）。
- 跳转复用 OpenCode Web UI 自带的 `#message-<messageID>` 深链；由于 Solid Router 只监听 `popstate`，扩展会先 `history.replaceState`，再补发一个 `popstate` 事件。
- 使用 Shadow DOM 注入 UI，颜色继承 `--v2-*` 主题变量，不修改 OpenCode 源码。
- 新提问通过 `MutationObserver` + 10 秒尾部轮询增量刷新。

## 限制

- 只注入 `http://127.0.0.1/*` 和 `http://localhost/*`，并且只对 OpenCode Web 页面生效；HTTPS 或自定义域名需要自行补充 `manifest.json` 的 `matches`。
- 适配 OpenCode v2.2.0 的 Web UI；如果后续版本调整了 API 或 `#message-` 深链行为，可能需要同步更新 `content.js`。
- 默认按单 server 处理；多 server 或远程隧道场景需要额外解析目标 server 的 API 地址。
- 会话进行中执行 revert 后，导航可能暂时保留被撤销的条目；刷新页面即可恢复（当前只在加载会话时按 `revert.messageID` 过滤）。
- 不向任何外部服务发送数据，只读取本机会话接口。

## 文件

```text
manifest.json   # Chrome MV3 配置
content.js      # 全部逻辑：会话识别、API、Shadow DOM、跳转、滚动跟随
README.md
```
