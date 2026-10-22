import test from "node:test";
import assert from "node:assert/strict";
import { randomFillSync } from "node:crypto";
import { operationId } from "../src/operationId.js";
test("安全上下文使用 UUID，格式满足服务端操作去重校验", () => {
  assert.match(operationId(), /^[a-zA-Z0-9_-]{8,80}$/);
});
test("普通 HTTP 无 randomUUID 时使用 getRandomValues，仍有唯一合法 ID", () => {
  const source = {
    getRandomValues: (bytes: Uint8Array) => randomFillSync(bytes),
  };
  const ids = Array.from({ length: 1000 }, () => operationId(source));
  assert.equal(new Set(ids).size, 1000);
  assert.ok(ids.every((id) => /^[a-f0-9]{32}$/.test(id)));
});
