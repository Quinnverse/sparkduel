import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const url = process.env.E2E_URL ?? "http://127.0.0.1:4173";
const dir = resolve(process.env.EVIDENCE_DIR ?? "evidence");
await mkdir(dir, { recursive: true });
const result = {
  method:
    "真实浏览器和真实 Socket.IO；只模拟普通 HTTP 中缺少 crypto.randomUUID，不修改游戏状态",
  checks: [],
  errors: [],
};
const browser = await chromium.launch({ channel: "chrome" });
try {
  const first = await browser.newContext(),
    second = await browser.newContext();
  await first.addInitScript(() =>
    Object.defineProperty(window.crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    }),
  );
  const a = await first.newPage(),
    b = await second.newPage();
  for (const p of [a, b])
    p.on("pageerror", (e) => result.errors.push(e.message));
  await a.goto(url);
  await a.getByText("服务器已连接", { exact: true }).waitFor();
  assert.equal(await a.evaluate(() => typeof crypto.randomUUID), "undefined");
  await a.getByLabel("你的昵称").fill("HTTP-Test");
  await a.getByRole("button", { name: "创建竞技房间", exact: true }).click();
  const code = await a.getByTestId("room-code").textContent();
  await b.goto(`${url}/?room=${code}`);
  await b.getByText("服务器已连接", { exact: true }).waitFor();
  await b.getByLabel("你的昵称").fill("Peer");
  await b.getByRole("button", { name: "加入竞技房间", exact: true }).click();
  await a.getByRole("button", { name: "我准备好了", exact: true }).click();
  await b.getByRole("button", { name: "我准备好了", exact: true }).click();
  await a.getByTestId("target").waitFor();
  await a.getByTestId("target").click();
  await a.waitForFunction(
    () =>
      document.querySelector('[data-testid="score-0"]').textContent === "01",
  );
  await b.waitForFunction(
    () =>
      document.querySelector('[data-testid="score-0"]').textContent === "01",
  );
  result.checks.push({
    name: "无 randomUUID 的浏览器仍可抢点并同步得分",
    status: "PASS",
    scores: [1, 0],
  });
  const player = await a.getByTestId("seat-0").getAttribute("data-player-id");
  await a.reload();
  await a.getByText("实时对局中", { exact: true }).waitFor();
  assert.equal(
    await a.getByTestId("seat-0").getAttribute("data-player-id"),
    player,
  );
  assert.equal(await a.getByTestId("score-0").textContent(), "01");
  result.checks.push({
    name: "兼容条件下刷新不改变席位与分数",
    status: "PASS",
  });
  await a.screenshot({
    path: resolve(dir, "13-http-compat-playing.png"),
    fullPage: true,
  });
  await a.getByRole("button", { name: "离开房间", exact: true }).click();
  await a.getByRole("button", { name: "确认离开", exact: true }).click();
  await b.getByRole("alert").filter({ hasText: "房间已关闭" }).waitFor();
  assert.deepEqual(result.errors, []);
  result.status = "PASS";
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.status = "FAIL";
  result.failure = error.stack ?? String(error);
  console.error(result.failure);
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(dir, "http-compat-results.json"),
    JSON.stringify(result, null, 2),
  );
  await browser.close();
}
