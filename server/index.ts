import { createApp } from "./app.js";
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT 必须在 1024–65535。");
const app = await createApp({ dev: process.argv.includes("--dev") });
try {
  await app.listen(port, host);
  console.log(
    `SPARK DUEL 已启动：http://${host}:${port} （${process.argv.includes("--dev") ? "开发" : "构建后运行"}模式，60 秒/局）`,
  );
} catch (error) {
  await app.close();
  console.error("启动失败：", error instanceof Error ? error.message : error);
  process.exit(1);
}
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
  });
