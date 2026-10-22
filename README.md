# SPARK DUEL — 双人抢点竞技场

60 秒，一对一，争抢同一个光点。两个独立浏览器连接同一个 Node.js 服务器；房间、目标、得分、时间和胜负全部由服务器裁决。没有本地假对手、账号、数据库或付费服务。

本项目按明确选择的普通本地 React/Node 源码方式交付，未上传代码，未部署公网。实测结果和未验证内容以 `DELIVERY_REPORT.md` 与 `evidence/` 为准，不能仅凭构建成功判为通过。

## 几分钟开始第一局

要求 Node.js **22.12 或以上**，推荐 Node.js 24 LTS；npm 10/11，推荐 11.6.2；现代桌面浏览器。实际开发/验收环境为 macOS、Node.js 24.13.0、npm 11.6.2、Chrome 155。安装依赖需要访问 npm 公共仓库，运行游戏无需外部 API、账号或密钥。

在解压后的项目根目录执行：

```sh
npm ci --cache .work/npm-cache
npm run build
npm start
```

浏览器打开 **http://127.0.0.1:4173**。默认只监听本机，不自动暴露局域网。`Ctrl+C` 停止服务器。一个 Node 进程同时提供前端静态文件和 Socket.IO，没有第二个启动命令。

浏览器 A 输入昵称，点击「创建竞技房间」。复制房间码或邀请链接；浏览器 B 使用另一普通浏览器窗口、隐私窗口或另一浏览器打开链接，也可点击「加入房间」输入昵称和 6 位房间码。两个新标签页应分别创建或加入，而不是复制带有原席位 sessionStorage 的整个标签页。

双方点击「我准备好了」，3 秒后进入同一局。点击金色光点，首次到达服务器的合法操作加 1 分，光点刷新。60 秒结束后，两端分数和赛果一致。双方点击「再来一局」，分数归零，开始新一轮。只有一人同意不会自动重开。

普通两个标签页也能作为两个玩家使用，因为凭证放在 sessionStorage 而非 localStorage；但评审建议使用独立浏览器/隐私会话，以明确验证两个身份。

## 两台真人设备在同一局域网玩

这是可选运行方式，不需要公网服务。在同一个 Wi-Fi/局域网、可信网络中显式启动：

```sh
HOST=0.0.0.0 PORT=4173 npm start
```

两人都打开服务器电脑的局域网 IP，例如 `http://192.168.1.20:4173`，**不要让另一台设备打开 127.0.0.1 或 localhost**。最好创建房间的人也使用同一个局域网地址，确保复制出的邀请链接可被另一台设备访问。防火墙需允许该进程端口，同 Wi-Fi 可能仍有客户端隔离；项目不自动修改防火墙，不保证未知网络可达。本次交付未进行两台物理设备/Wi-Fi 实测。

局域网 HTTP 上浏览器可能不允许剪贴板 API，界面会显示可选择的手动复制框。不要将无 TLS 的服务暴露公网；重连凭证是房间秘密，生产网络需 HTTPS/WSS、可信反向代理与 Origin 配置。

## 开发与测试

```sh
npm run dev       # 同源 Vite 中间件 + Socket.IO；默认同样是 4173
npm test          # 纯规则与真实 Socket.IO 集成测试
npm run check     # TypeScript 检查；build 已包含它
npm run test:e2e  # 游戏服务器运行时，两个独立 Chrome 进程完成真实 60 秒局
```

`npm start` 与 `npm run dev` 不要在同一端口同时启动。端口占用时会明确报错，不自动切换。使用 `PORT=4180 npm start` 可显式换端口；端到端测试对应 `E2E_URL=http://127.0.0.1:4180 npm run test:e2e`。

Playwright 测试优先使用机器已有的 Google Chrome（`channel: chrome`），不会默认下载另一个浏览器。没有 Chrome 时可自行安装 Chrome，或修改测试启动为已安装的 Playwright Chromium。端到端脚本会生成实际截图及 `evidence/browser-results.json`；该脚本输入由自动化执行，不冒充两位真人。WebSocket 延迟是本机模拟的约额外 100ms RTT，不等于真实互联网测量。

依赖由 package-lock.json 固定。npm 默认缓存有权限问题时使用上述项目内 `--cache .work/npm-cache`，无需 sudo 或更改用户全局缓存权限。项目允许经审核所需的 esbuild 安装生命周期；不使用 `--ignore-scripts`。开发依赖审计通过不等于完整安全审计。

## 规则、掉线和房间生命周期

光点位置用竞技场百分比表示，桌面和手机共享同一 targetId。每个目标只计一次；重复 operationId、旧 targetId、旧 roundId、非成员和结束后的操作被拒绝。客户端不能发送分数、胜者或游戏时间。这个小游戏不是反机器人系统：知道协议的机器人可以自动抢点，首次到服务器的合法消息获胜，网络延迟会影响竞技公平。

刷新携带服务器生成的房间绑定凭证恢复原席位，不创建重复玩家；同一凭证在另一个页面恢复，会撤销旧连接权限并提示席位转移。凭证只存在该标签页的 sessionStorage，不在邀请链接、公开快照或日志中。

游戏进行中断线，服务器检测到掉线后冻结分数和剩余时间；保留窗口是 **30 秒**，双方连接恢复后继续剩余时长。真实异常网络中，底层心跳检测可能需要数秒（5 秒 ping / 8 秒 timeout），所以窗口从服务端检测时刻开始，不承诺用户断网瞬间服务器就知情。倒计时阶段断线返回等待并清除双方准备。结果阶段断线不改变已经裁定的赛果。

超出恢复窗口关闭房间，不用不完整比赛判竞技胜负。主动点击「离开房间」后确认会立即关闭房间，另一端收到通知。无操作的等待/结束房间 15 分钟后过期；房间上限 500，连接上限 1000，每连接最多 30 事件/秒，建房/加入/恢复合计最多 8 次/10 秒，消息最大 8KiB。

服务器重启清除所有内存房间、分数和凭证；重新创建即可。清除浏览器存储、关闭标签页或禁用 sessionStorage 可能无法恢复席位；不能凭昵称夺回。没有持久化、多实例、观战或匹配系统。

## 架构与源码位置

`server/engine.ts` 是可注入时钟的同步权威状态机。`server/app.ts` 负责 HTTP、静态文件、Socket.IO、Origin 与事件速率校验。`server/index.ts` 是启动/停止入口。`shared/protocol.ts` 定义公开快照、凭证和事件数据。`src/useDuel.ts` 负责连接、时钟映射、快照版本和 sessionStorage，`src/App.tsx` 与 `src/styles.css` 渲染产品界面。测试分别在 `tests/` 与 `scripts/e2e.mjs`。

状态为 `LOBBY → COUNTDOWN → PLAYING → FINISHED → COUNTDOWN`，掉线时 `PLAYING → PAUSED → PLAYING` 或关闭。READY 与 REMATCH 是双方标记而非额外状态。裁决函数没有 await，检验当前目标后同步加分和替换目标，阻止同一目标并发重复得分。单实例设计，无不必要分布式组件。

协议事件：`createRoom`、`joinRoom`、`reconnectRoom`、`setReady`、`claimTarget`、`requestRematch`、`leaveRoom`、`syncClock`；服务器发布 `roomState`、`roomClosed`、`sessionReplaced`。所有命令采用 `{ok,data}` 或 `{ok:false,error:{code,message}}` 回应。快照包含 version、roundId、targetId 和 serverNow；不会暴露恢复 token。

## 范围与限制

计划范围包含创建/加入/邀请、准备、倒计时、共享抢点、60 秒结束、双方再赛、刷新与掉线策略、输入/身份/频率检查、响应式界面和真实双浏览器验收。已完成与未完成的最终状态、PASS/PARTIAL/FAIL 与对应证据请读 `DELIVERY_REPORT.md`，避免用计划作为完成证明。

没有公网部署、实际两位真人参与的人工测试、两台物理设备联网实测、跨 Safari/Firefox 实测、持久化和生产级反作弊。不是无限容量承诺；最多连接/房间是拒绝阈值，不是经过压测的吞吐指标。HTTP health 只是运行就绪，不证明双人对局。

视觉为自有 CSS 布局，图标来自 Lucide（ISC），品牌闪电为自有几何图形；不依赖外部字体、照片、商业游戏素材。第三方许可见 `THIRD_PARTY_NOTICES.md`。

## 最终补充验收

最终权威/协议/操作 ID 测试 23 项通过，完整双 Chrome 套件 15 项通过；最后 HTTP 操作 ID 兼容补丁另有 2 项浏览器回归通过。可在服务运行时执行 `node scripts/http-compat.mjs`，明确模拟普通 HTTP 缺少 randomUUID 的浏览器能力，实际验证抢点同步与刷新身份。详见交付报告的版本/回归范围。

本交付的运行入口使用项目内 tsx，安装时保留开发依赖，不使用 `npm ci --omit=dev`。没有要求全局安装 tsx 或 Playwright。
