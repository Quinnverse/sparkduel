# SPARK DUEL 交付与验收报告

## 交付结论

**本地可运行软件与双浏览器技术验收：PASS。两位真人跨物理设备人工验收：PARTIAL，尚未执行。**

已交付 React / TypeScript / Vite 前端、Node.js / Socket.IO 权威后端、依赖锁文件、运行说明、自动化测试及实际运行截图。两个独立 Chrome 进程完成同房正常 60 秒对局、实时共享得分、一致结果和双方再赛；另在内置浏览器两个标签页通过真实控件完成一局平局及刷新/再赛。没有本地假对手，没有客户端权威分数，没有上传源码、收费服务或公网部署。

必须区分“真实浏览器/真实网络连接”和“真人参与”：所有本次输入由工具执行，不能声称已由两名真人签收。软件支持两个真人分别操作的席位，评审可按 README 自行完成真人验收。

## 启动交付

在项目根目录使用 Node.js 22.12+（推荐 24）和 npm 执行：

```sh
npm ci --cache .work/npm-cache
npm run build
npm start
```

打开 **http://127.0.0.1:4173**，另一个独立浏览器会话通过房间码或邀请链接加入。一个命令同时服务前端和 Socket.IO，无数据库和密钥。不要使用 `npm ci --omit=dev`，本交付运行入口使用项目内 tsx。端口有冲突会报错，显式设置 PORT 即可。详情及局域网运行步骤见 [README](README.md)。

实际本机环境：macOS、Node.js 24.13.0、npm 11.6.2、Google Chrome 155.0.8059.85。初始目录为空，无既有游戏源码或额外官方交付说明。接口额外约定、官方截止时间均为 UNKNOWN。

## Gate A：PASS

两个独立 Chrome 进程连接同一服务，房间 `Y6DZR7`，共同轮次 `f305e7d3-ea1e-4c3b-824c-4cb1b9360d9f`，共同初始目标 `cc1d8e91-7ce0-4129-befa-0bd4579ab53c`。A 得分后 B 显示 1:0，B 操作后双方 1:1，A 再操作后双方 2:1。正常 60 秒服务端裁决结束，A 显示“漂亮，你赢了！”，B 显示“差一点，下局再战。”，分数一致。

脚本从两个页面均渲染 PLAYING 后计时，测得剩余等待 59,738ms；该数包含页面观察起点差，不是把局长改为 59 秒。服务器使用固定 60,000ms，前一次同样正常局的脚本等待为 60,211ms。两个浏览器同意再赛后，共同新轮次 `8ae20b98-dfc2-4c3a-806c-ba7127397cb7`，分数 0:0。

原始证据：[浏览器结果](evidence/browser-results.json)、[A 实时对局截图](evidence/04-playing-player-a.png)、[B 实时对局截图](evidence/05-playing-player-b.png)、[赛果截图](evidence/06-result.png)。

## Gate B：PASS，注明验证层级

真实浏览器验证了满员拒绝、错误房间码、游戏中刷新保持原 playerId、实际离线网络开关造成暂停、剩余时间冻结、恢复原轮次、主动退出关闭双方房间。并发浏览器测试记录 A/B 实际发送相同 roundId 和 targetId 的两个 claimTarget 消息，只有总计 1 分；不是仅看一张分数截图推断并发。

重复 operationId、旧 targetId、旧 roundId、到时但尚未 tick 的点击、结束后点击、非成员、被替换旧 socket、两人同时掉线、一人先恢复、重连超时清理、房间容量/空闲过期、异常输入和协议版本/速率限制由规则及真实 Socket.IO 测试覆盖。**这些边界不是全部逐项在浏览器实测**；30 秒超时与 15 分钟空闲过期用注入时钟确定性验证，未等待真实 15 分钟。

最终 [规则和 Socket.IO 日志](evidence/unit-and-socket-tests.txt) 为 **23/23 PASS**。其中 19 项权威规则、2 项操作 ID、2 项真实 Socket.IO 集成。未使用测试结果伪造人类参与或生产压测。

## Gate C：PASS

深色原创界面、蓝/珊瑚双席位、金色目标、可复制房间码和链接、中文规则、准备/等待/倒计时/暂停/结束反馈、得分动画、双方同意再赛和移动布局均已实现。390px 手机浏览器 emulation 中无横向溢出，完整规则可展开，倒计时定位竞技场，触控抢点实际使另一端得分改变。

剪贴板真实复制成功经过校验；API 不可用条件通过明确的环境模拟验证手动复制回退，不把它说成真实用户拒绝权限。尊重 reduced-motion，有可访问标签；尚未完成专业屏幕阅读器/全 WCAG 验收。

实际浏览器发现并修复了倒计时首帧短暂显示 4、手机看不到完整规则、手机再赛方向文案及 HTTP 缺少 randomUUID 兼容性。没有为了画面修改权威计分规则。

截图：[桌面首页](evidence/01-home-desktop.png)、[等待房间](evidence/02-room-lobby.png)、[倒计时](evidence/03-countdown.png)、[断线暂停](evidence/07-disconnect-paused.png)、[手机触控](evidence/12-mobile-playing.png)。

## Gate D：PASS（真实浏览器，不代表真人签收）

要求的五条流程均有证据：A 创建/B 加入完成正常整局；两个浏览器同时操作同一目标只计一分；游戏中 A 刷新恢复原席位；结束后双方再赛重置；错误房间码显示中文错误。`browser-results.json` 共 **15 个 PASS 检查项**，无未处理页面错误或非预期 HTTP/控制台错误。

故意断网时有一条预期 `ERR_INTERNET_DISCONNECTED` WebSocket 控制台错误，原样保存在 `expectedTransportErrors`；没有隐藏或把断网日志算成意外失败。测试给 WebSocket 每方向固定 50ms 延迟，约额外 100ms RTT，这是本地模拟，不是公网测量。

内置浏览器另一局：房间 `DAYCVU`，双方操作后 1:1，A 刷新仍同轮次同目标；正常结束双方显示平局，再赛新轮次双方 0:0。证据：[额外浏览器记录](evidence/in-app-browser-results.json)、[刷新截图](evidence/10-in-app-playing-refresh.png)、[再赛截图](evidence/11-in-app-rematch.png)。

## 最终代码与回归范围

完整 60 秒 + 15 项浏览器验收通过后，最后只补充了普通 HTTP 操作 ID 回退和跨局反馈清理，**没有改动后端裁决、局长、房间和目标规则**。最终代码再次 TypeScript/Vite 构建及 23 项测试通过；针对修改路径用实际浏览器模拟没有 randomUUID，验证仍可抢点、另一端分数同步、刷新保持身份/分数，2 项兼容回归 PASS。没有再次声称未重跑的完整 60 秒套件是在最后这次构建上重跑。

最终构建日志：[build-log.txt](evidence/build-log.txt)。兼容结果：[http-compat-results.json](evidence/http-compat-results.json)；实图：[HTTP 兼容对局](evidence/13-http-compat-playing.png)。通过 `node scripts/http-compat.mjs` 可复现该针对性回归。

依赖审计：[dependency-audit.json](evidence/dependency-audit.json) 为 0 已知告警。第一次旧开发依赖审计发现问题后，按返回修复版本更新了 Vite、tsx、Playwright；没有修改全局运行环境。独立只读代码审查未找到可直接复现的问题，见 [code-review.json](evidence/code-review.json)，它不代替动态测试或安全保证。

## 刷新、断线与隐私选择

服务器生成 32 字节随机恢复 token，房间绑定，存于 sessionStorage；邀请和公开快照不含 token。恢复原席位会撤销旧连接权威。客户端不缓存权威分数，也不使用 socket.id 做长期身份。

对局断线在服务端检测后暂停，30 秒内两人均恢复继续剩余时间，超时关闭，不将未完成比赛判为竞技胜负。倒计时掉线返回等待并取消准备。结束后掉线不改变既有赛果。主动退出须界面确认，关闭整个双人房间。重启清除内存房间；缺少存储或凭证无法凭昵称夺回。

默认只监听本机，不自动修改防火墙、路由、系统权限或购买服务。开发缓存权限失败后改用项目缓存，没有 sudo、删除缓存或接管私人账号。

## 评审视角自检

| 评审项 | 结果 | 证据或限制 |
| --- | --- | --- |
| 几分钟启动第一局 | PASS | npm ci/build/start，单进程同源运行，README 双人步骤 |
| 两人同房同局 | PASS | 独立 Chrome 相同 roomCode / roundId / targetId |
| 操作实时影响对方 | PASS | 共享 2:1 得分和同目标并发 1 分 |
| 服务器统一胜负 | PASS | 权威规则 + 两端相反视角一致赛果 |
| 完整开始/结束/再赛 | PASS | 正常 60 秒局和双方同意清零 |
| 房间生命周期和异常 | PASS | 浏览器刷新/离线/退出，规则测试过期/关闭 |
| 无重复计分和旧连接操纵 | PASS | 单元、真实 Socket.IO 与浏览器并发 |
| 基本审美与操作反馈 | PASS | 实际桌面/手机截图与触控测试 |
| 可复现运行和交付 | PASS | 锁文件、源码、测试、README、真实日志 |
| 无过度设计 | PASS | 无数据库/账号/付费/排行榜/分布式 |
| 两名真人跨物理设备签收 | PARTIAL | 支持方式已说明，本次未执行真人/Wi-Fi 测试 |
| 公网部署 | 未执行 | 非强制且未获生产发布授权，不声称上线 |

## 已知限制与未做功能

单实例内存房间，服务器重启丢失状态。容量阈值不是压测成绩。没有多实例一致性、机器人检测、延迟补偿、持久化、观战、账号或排行榜；首次到服务器的合法消息得分，网络延迟会影响公平。

未验证 Safari/Firefox、真实手机硬件、两台电脑跨 Wi-Fi、真实公网 HTTPS/WSS 和大规模负载。普通 HTTP 局域网剪贴板可能不可用，有手动回退；无 randomUUID 的操作 ID 回退已模拟验证。公网需单独授权与安全部署，不能直接暴露开发服务。

保留首次浏览器脚本失败证据：[browser-first-attempt.json](evidence/browser-first-attempt.json)。原因是昵称“Nova 你”被错误按精确“Nova”匹配，已改成稳定 playerId 比较后整套通过，不宣称从未出错。

## 源码包干净复现：PASS

从实际候选 ZIP 解压到没有 node_modules 的独立目录，执行 npm ci、npm run build、npm test 成功。23 项测试全部通过，19 个源码/静态/构建文件的 SHA256 与已验收版本一致，无差异。证据：[reproduction-validation.json](evidence/reproduction-validation.json)。最终打包仅补入本节与复现证据，不改变任何已验证源码或构建产物。
