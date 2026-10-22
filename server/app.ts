import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, extname, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { GameError, RoomManager } from "./engine.js";
import { PROTOCOL, type Reply, type RoomState } from "../shared/protocol.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
export async function createApp(
  options: {
    dev?: boolean;
    durationMs?: number;
    countdownMs?: number;
    graceMs?: number;
    maxRooms?: number;
  } = {},
) {
  let vite:
    | Awaited<ReturnType<(typeof import("vite"))["createServer"]>>
    | undefined;
  const http = createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (req.url?.split("?")[0] === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          ok: true,
          protocol: PROTOCOL,
          roomCount: manager.size,
        }),
      );
      return;
    }
    if (vite) {
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end("Not found");
      });
      return;
    }
    serveStatic(req, res);
  });
  const io = new Server(http, {
    maxHttpBufferSize: 8_192,
    pingInterval: 5_000,
    pingTimeout: 8_000,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) {
        callback(null, true);
        return;
      }
      try {
        const configured =
          process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? [];
        callback(
          null,
          new URL(origin).host === req.headers.host ||
            configured.includes(origin),
        );
      } catch {
        callback(null, false);
      }
    },
  });
  const manager = new RoomManager({
    ...options,
    onState: (state: RoomState) => io.to(state.code).emit("roomState", state),
    onClosed: (code, reason) => {
      io.to(code).emit("roomClosed", { reason });
      io.in(code).socketsLeave(code);
    },
  });
  io.use((socket, next) => {
    if (socket.handshake.auth?.protocol !== PROTOCOL) {
      next(new Error("版本不匹配，请刷新页面。"));
      return;
    }
    if (io.engine.clientsCount > 1_000) {
      next(new Error("服务器连接已满，请稍后。"));
      return;
    }
    next();
  });
  io.on("connection", (socket) => {
    let windowStart = Date.now(),
      requests = 0,
      roomWindow = Date.now(),
      roomRequests = 0;
    const handle = (
      name: string,
      operation: (data: unknown) => unknown,
      expensive = false,
    ) => {
      socket.on(name, (data: unknown, callback: unknown) => {
        const reply =
          typeof callback === "function"
            ? (callback as (result: Reply<unknown>) => void)
            : () => {};
        const now = Date.now();
        if (now - windowStart >= 1_000) {
          windowStart = now;
          requests = 0;
        }
        if (now - roomWindow >= 10_000) {
          roomWindow = now;
          roomRequests = 0;
        }
        if (++requests > 30 || (expensive && ++roomRequests > 8)) {
          reply({
            ok: false,
            error: {
              code: "RATE_LIMIT",
              message: "请求过于频繁，请稍后重试。",
            },
          });
          return;
        }
        try {
          reply({ ok: true, data: operation(data) ?? {} });
        } catch (error) {
          if (error instanceof GameError)
            reply({
              ok: false,
              error: { code: error.code, message: error.message },
            });
          else {
            console.error(
              "游戏事件内部错误",
              name,
              error instanceof Error ? error.message : "Unknown",
            );
            reply({
              ok: false,
              error: {
                code: "INTERNAL",
                message: "服务器暂时无法处理，请重试。",
              },
            });
          }
        }
      });
    };
    handle(
      "createRoom",
      (data) => {
        const seat = manager.create(socket.id, data);
        void socket.join(seat.state.code);
        socket.emit("roomState", seat.state);
        return seat;
      },
      true,
    );
    handle(
      "joinRoom",
      (data) => {
        const seat = manager.join(socket.id, data);
        void socket.join(seat.state.code);
        socket.emit("roomState", seat.state);
        return seat;
      },
      true,
    );
    handle(
      "reconnectRoom",
      (data) => {
        const { seat, replacedSocketId } = manager.reconnect(socket.id, data);
        if (replacedSocketId) {
          const old = io.sockets.sockets.get(replacedSocketId);
          old?.emit("sessionReplaced", {
            message: "这个席位已在另一个页面恢复，请关闭当前页面。",
          });
          old?.disconnect(true);
        }
        void socket.join(seat.state.code);
        socket.emit("roomState", seat.state);
        return seat;
      },
      true,
    );
    handle("setReady", (data) => manager.ready(socket.id, data));
    handle("claimTarget", (data) => manager.claim(socket.id, data));
    handle("requestRematch", (data) => manager.rematch(socket.id, data));
    handle("leaveRoom", () => manager.leave(socket.id));
    handle("syncClock", () => ({ serverNow: Date.now() }));
    socket.on("disconnect", () => manager.disconnect(socket.id));
  });
  const timer = setInterval(() => manager.tick(), 50);
  timer.unref();
  if (options.dev) {
    const { createServer: createVite } = await import("vite");
    vite = await createVite({
      root,
      server: { middlewareMode: true, hmr: { server: http } },
      appType: "spa",
    });
  }
  return {
    http,
    io,
    manager,
    async listen(port = 4173, host = "127.0.0.1") {
      await new Promise<void>((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          http.off("error", reject);
          resolve();
        });
      });
      const address = http.address();
      return typeof address === "object" && address ? address.port : port;
    },
    async close() {
      clearInterval(timer);
      await vite?.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
  } catch {
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }
  const dist = resolve(root, "dist");
  let path = resolve(dist, "." + pathname);
  if (!path.startsWith(dist + sep) && path !== dist) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  if (pathname === "/") path = resolve(dist, "index.html");
  if (!existsSync(path) || !statSync(path).isFile()) {
    res.statusCode = 404;
    res.end("Not found. Run npm run build first.");
    return;
  }
  res.setHeader(
    "Content-Type",
    mime[extname(path)] ?? "application/octet-stream",
  );
  res.setHeader(
    "Cache-Control",
    pathname.startsWith("/assets/")
      ? "public,max-age=31536000,immutable"
      : "no-cache",
  );
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(path);
  stream.on("error", () => {
    res.destroy();
  });
  stream.pipe(res);
}
