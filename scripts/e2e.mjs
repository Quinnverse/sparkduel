import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = process.env.E2E_URL ?? "http://127.0.0.1:4173";
const directory = resolve(process.env.EVIDENCE_DIR ?? "evidence");
await mkdir(directory, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  url: base,
  browser: "",
  method:
    "两个独立 Chrome 进程/隔离上下文，真实 HTTP + Socket.IO；自动化输入，不是两位真人实测",
  conditions:
    "默认 60 秒局，WebSocket 单向各 50ms 固定延迟（约额外 100ms RTT）",
  checks: [],
  errors: [],
  captures: [],
  expectedTransportErrors: [],
};
const browsers = [];
const wireClaims = [];
let intentionallyOffline = false;
function pass(name, evidence) {
  report.checks.push({ name, status: "PASS", evidence });
  console.log("PASS", name, JSON.stringify(evidence));
}
function track(page, label) {
  page.on("pageerror", (error) =>
    report.errors.push({ label, type: "pageerror", message: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      const entry = { label, type: "console", message: message.text() };
      if (
        label === "A" &&
        intentionallyOffline &&
        /WebSocket|ERR_INTERNET_DISCONNECTED/.test(entry.message)
      )
        report.expectedTransportErrors.push(entry);
      else report.errors.push(entry);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.errors.push({
        label,
        type: "http",
        status: response.status(),
        url: response.url(),
      });
  });
}
async function delaySocket(context, label) {
  await context.routeWebSocket("**/socket.io/**", (ws) => {
    const upstream = ws.connectToServer();
    upstream.onMessage((message) =>
      setTimeout(() => {
        try {
          ws.send(message);
        } catch {
          /* closed during navigation */
        }
      }, 50),
    );
    ws.onMessage((message) => {
      const content = String(message);
      if (content.includes('"claimTarget"')) {
        const event = JSON.parse(content.slice(content.indexOf("[")));
        wireClaims.push({
          label,
          roundId: event[1].roundId,
          targetId: event[1].targetId,
          operationId: event[1].operationId,
        });
      }
      setTimeout(() => {
        try {
          upstream.send(message);
        } catch {
          /* closed during navigation */
        }
      }, 50);
    });
  });
}
async function snapshot(page) {
  return page.evaluate(() => ({
    code: document.querySelector('[data-testid="room-code"]')?.textContent,
    phase: document.querySelector(".app")?.getAttribute("data-status"),
    round: document.querySelector(".app")?.getAttribute("data-round"),
    version: Number(
      document.querySelector(".app")?.getAttribute("data-version"),
    ),
    players: [0, 1].map((n) =>
      document
        .querySelector(`[data-testid="seat-${n}"]`)
        ?.getAttribute("data-player-id"),
    ),
    scores: [0, 1].map((n) =>
      Number(document.querySelector(`[data-testid="score-${n}"]`)?.textContent),
    ),
    target: document
      .querySelector('[data-testid="target"]')
      ?.getAttribute("data-target-id"),
    result: document.querySelector('[data-testid="result"]')?.textContent,
    timer: document.querySelector('[data-testid="timer"]')?.textContent,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  }));
}
async function phase(page, state, timeout = 10_000) {
  await page.locator(`.app[data-status="${state}"]`).waitFor({ timeout });
}
async function capture(page, filename) {
  await page.screenshot({ path: resolve(directory, filename), fullPage: true });
  report.captures.push(filename);
}
async function equalScores(a, b, scores) {
  await a.waitForFunction(
    (values) =>
      values.every(
        (score, n) =>
          Number(
            document.querySelector(`[data-testid="score-${n}"]`)?.textContent,
          ) === score,
      ),
    scores,
  );
  await b.waitForFunction(
    (values) =>
      values.every(
        (score, n) =>
          Number(
            document.querySelector(`[data-testid="score-${n}"]`)?.textContent,
          ) === score,
      ),
    scores,
  );
}
try {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  for (let i = 0; i < 2; i++)
    browsers.push(await chromium.launch({ channel: "chrome", headless: true }));
  report.browser = browsers[0].version();
  const ca = await browsers[0].newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const cb = await browsers[1].newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await delaySocket(ca, "A");
  await delaySocket(cb, "B");
  const a = await ca.newPage(),
    b = await cb.newPage();
  track(a, "A");
  track(b, "B");
  await a.goto(base);
  await a.getByText("服务器已连接", { exact: true }).waitFor();
  await capture(a, "01-home-desktop.png");
  await a.getByLabel("你的昵称").fill("Nova");
  await a.getByRole("button", { name: "创建竞技房间", exact: true }).click();
  await phase(a, "LOBBY");
  const code = await a.getByTestId("room-code").textContent();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  await a.getByRole("button", { name: "复制房间码", exact: true }).click();
  await a.getByText("房间码已复制", { exact: true }).waitFor();
  const clipboard = await a.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipboard, code);
  await a.getByRole("button", { name: "复制邀请链接", exact: true }).click();
  await a.getByText("邀请链接已复制", { exact: true }).waitFor();
  const invitation = await a.evaluate(() => navigator.clipboard.readText());
  assert.equal(new URL(invitation).searchParams.get("room"), code);
  assert.ok(!invitation.includes("token"));
  await b.goto(invitation);
  await b.getByText("服务器已连接", { exact: true }).waitFor();
  await b.getByLabel("你的昵称").fill("Echo");
  await b.getByRole("button", { name: "加入竞技房间", exact: true }).click();
  await phase(b, "LOBBY");
  await a.getByText("Echo", { exact: true }).waitFor();
  pass("独立浏览器加入同房 / 邀请复制", {
    code,
    a: (await snapshot(a)).code,
    b: (await snapshot(b)).code,
  });
  await capture(a, "02-room-lobby.png");
  await a.getByRole("button", { name: "我准备好了", exact: true }).click();
  await b.getByRole("button", { name: "我准备好了", exact: true }).click();
  await phase(a, "COUNTDOWN");
  await capture(a, "03-countdown.png");
  await phase(a, "PLAYING");
  await phase(b, "PLAYING");
  const start = Date.now();
  const firstA = await snapshot(a),
    firstB = await snapshot(b);
  assert.equal(firstA.round, firstB.round);
  assert.equal(firstA.target, firstB.target);
  assert.ok(firstA.timer === "01:00" || firstA.timer === "00:59");
  pass("同轮次同目标 / 正常 60 秒局", {
    round: firstA.round,
    target: firstA.target,
    timer: firstA.timer,
  });
  await a.getByTestId("target").click();
  await equalScores(a, b, [1, 0]);
  await b.getByTestId("target").click();
  await equalScores(a, b, [1, 1]);
  await a.getByTestId("target").click();
  await equalScores(a, b, [2, 1]);
  await capture(a, "04-playing-player-a.png");
  await capture(b, "05-playing-player-b.png");
  pass("操作实时改变另一客户端分数", {
    a: await snapshot(a),
    b: await snapshot(b),
  });
  await phase(a, "FINISHED", 65_000);
  await phase(b, "FINISHED");
  const endA = await snapshot(a),
    endB = await snapshot(b);
  assert.deepEqual(endA.scores, [2, 1]);
  assert.deepEqual(endA.scores, endB.scores);
  assert.equal(endA.result, "漂亮，你赢了！");
  assert.equal(endB.result, "差一点，下局再战。");
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 59_000 && elapsed < 64_000);
  await capture(a, "06-result.png");
  pass("完整 60 秒局结束 / 一致权威赛果", {
    elapsedMs: elapsed,
    scores: endA.scores,
    resultA: endA.result,
    resultB: endB.result,
  });
  await a.getByRole("button", { name: "再来一局", exact: true }).click();
  assert.equal((await snapshot(a)).phase, "FINISHED");
  await b.getByRole("button", { name: "再来一局", exact: true }).click();
  await phase(a, "COUNTDOWN");
  await equalScores(a, b, [0, 0]);
  await phase(a, "PLAYING");
  await phase(b, "PLAYING");
  assert.notEqual((await snapshot(a)).round, firstA.round);
  pass("Gate A：双人闭环、结束与双方再赛", {
    newRound: (await snapshot(a)).round,
    scores: [0, 0],
  });
  // 通过 Gate A 后，在同一真实浏览器会话继续可靠性验收。
  const beforeRefresh = await snapshot(a);
  await a.reload();
  await phase(a, "PLAYING");
  await a.getByText("实时对局中", { exact: true }).waitFor();
  const afterRefresh = await snapshot(a);
  assert.equal(afterRefresh.round, beforeRefresh.round);
  assert.equal(afterRefresh.code, code);
  assert.deepEqual(afterRefresh.players, beforeRefresh.players);
  assert.equal(afterRefresh.players.filter(Boolean).length, 2);
  pass("游戏中刷新恢复同一席位", {
    before: beforeRefresh,
    after: afterRefresh,
  });
  intentionallyOffline = true;
  await ca.setOffline(true);
  await phase(b, "PAUSED", 15_000);
  const paused = await snapshot(b);
  await b.waitForTimeout(1_500);
  assert.equal((await snapshot(b)).timer, paused.timer);
  assert.equal(await b.getByTestId("target").count(), 0);
  await capture(b, "07-disconnect-paused.png");
  await ca.setOffline(false);
  await phase(a, "PLAYING", 12_000);
  await phase(b, "PLAYING");
  intentionallyOffline = false;
  pass("真实网络断开 / 冻结 / 30 秒窗口内恢复", {
    paused,
    resumed: await snapshot(b),
  });
  // 两个页面先取得同一目标句柄；模拟 RTT 让裁决快照不会抢先替换另一页面目标。
  const ta = await a.getByTestId("target").elementHandle(),
    tb = await b.getByTestId("target").elementHandle();
  const targetA = await ta.getAttribute("data-target-id"),
    targetB = await tb.getAttribute("data-target-id");
  assert.equal(targetA, targetB);
  // DOM pointer events are routed through the normal React event handlers, not state writes.
  await Promise.all([
    ta.evaluate((node) =>
      node.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    ),
    tb.evaluate((node) =>
      node.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    ),
  ]);
  await a.waitForFunction(
    () =>
      [0, 1].reduce(
        (sum, n) =>
          sum +
          Number(
            document.querySelector(`[data-testid="score-${n}"]`)?.textContent,
          ),
        0,
      ) === 1,
  );
  const raceA = await snapshot(a);
  await equalScores(a, b, raceA.scores);
  assert.equal(
    raceA.scores.reduce((x, y) => x + y),
    1,
  );
  const raceMessages = wireClaims.filter(
    (message) => message.targetId === targetA,
  );
  assert.equal(raceMessages.length, 2);
  assert.deepEqual(raceMessages.map((message) => message.label).sort(), [
    "A",
    "B",
  ]);
  pass("两个浏览器争抢同一个目标只计 1 分", {
    messages: raceMessages,
    targetA,
    targetB,
    scores: raceA.scores,
  });
  // 第三会话确认满员与错误码；随后手机尺寸验证不横向溢出。
  const cc = await browsers[1].newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const c = await cc.newPage();
  track(c, "C");
  await c.goto(`${base}/?room=${code}`);
  await c.getByText("服务器已连接", { exact: true }).waitFor();
  await c.getByLabel("你的昵称").fill("Third");
  await c.getByRole("button", { name: "加入竞技房间", exact: true }).click();
  await c.getByRole("alert").filter({ hasText: "房间已满" }).waitFor();
  pass("第三浏览器满员拒绝", { code });
  await c.getByLabel("房间码", { exact: true }).fill("ZZZZZZ");
  await c.getByRole("button", { name: "加入竞技房间", exact: true }).click();
  await c.getByRole("alert").filter({ hasText: "没有找到这个房间" }).waitFor();
  pass("错误房间码中文反馈", { invalidCode: "ZZZZZZ" });
  assert.equal((await snapshot(c)).horizontalOverflow, false);
  await capture(c, "08-mobile-join-error.png");
  pass("390px 手机加入页无横向溢出", { width: 390 });
  await a.getByRole("button", { name: "离开房间", exact: true }).click();
  await a.getByRole("button", { name: "确认离开", exact: true }).click();
  await phase(a, "HOME");
  await phase(b, "HOME");
  await b.getByRole("alert").filter({ hasText: "房间已关闭" }).waitFor();
  pass("中途主动退出关闭双方房间", {});
  await c.goto(base);
  await c.getByText("服务器已连接", { exact: true }).waitFor();
  await capture(c, "09-mobile-home.png");
  assert.equal((await snapshot(c)).horizontalOverflow, false);
  await c.getByText("怎么玩？查看游戏规则", { exact: true }).click();
  await c
    .getByText(
      "两人加入同一房间并准备，3 秒后开局。点击金色光点，先到服务器的操作得 1 分，60 秒后高分者获胜。平分即平局，双方同意可再来一局。",
      { exact: true },
    )
    .waitFor();
  await c.getByLabel("你的昵称").fill("Mobile");
  await c.getByRole("button", { name: "创建竞技房间", exact: true }).click();
  await phase(c, "LOBBY");
  const mobileCode = await c.getByTestId("room-code").textContent();
  // 模拟浏览器没有 Clipboard API，仅验证正常降级分支，不修改游戏状态。
  await c.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await c.getByRole("button", { name: "复制邀请链接", exact: true }).click();
  const fallback = c.getByLabel("手动复制邀请");
  await fallback.waitFor();
  assert.equal(
    new URL(await fallback.inputValue()).searchParams.get("room"),
    mobileCode,
  );
  pass("剪贴板 API 不可用时手动复制降级（模拟权限条件）", { mobileCode });
  await b.getByLabel("房间码", { exact: true }).fill(mobileCode);
  await b.getByRole("button", { name: "加入竞技房间", exact: true }).click();
  await phase(b, "LOBBY");
  await c.getByRole("button", { name: "我准备好了", exact: true }).click();
  await b.getByRole("button", { name: "我准备好了", exact: true }).click();
  await phase(c, "COUNTDOWN");
  assert.ok(Number(await c.getByTestId("countdown").textContent()) <= 3);
  await phase(c, "PLAYING");
  await phase(b, "PLAYING");
  await c.getByTestId("target").tap();
  await equalScores(c, b, [1, 0]);
  assert.equal((await snapshot(c)).horizontalOverflow, false);
  await capture(c, "12-mobile-playing.png");
  pass("手机完整规则、开局定位、触控抢点与另一端同步", {
    mobile: await snapshot(c),
    peer: await snapshot(b),
  });
  await c.getByRole("button", { name: "离开房间", exact: true }).click();
  await c.getByRole("button", { name: "确认离开", exact: true }).click();
  await phase(b, "HOME");
  assert.deepEqual(report.errors, []);
  pass("无未处理页面异常、控制台错误、HTTP 4xx/5xx", { errors: report.errors });
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = error.stack ?? String(error);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(
    resolve(directory, "browser-results.json"),
    JSON.stringify(report, null, 2),
  );
  for (const browser of browsers) await browser.close();
}
