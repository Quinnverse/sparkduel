interface RandomSource {
  randomUUID?: () => string;
  getRandomValues: (bytes: Uint8Array) => Uint8Array;
}
/** 操作去重标识不是身份凭证；普通局域网 HTTP 可能没有 randomUUID。 */
export function operationId(source: RandomSource = globalThis.crypto): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  return Array.from(source.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
