import test from "node:test";
import assert from "node:assert/strict";

import { sendRuntimeMessageBestEffort } from "./runtime-messaging";

test("扩展重载后失效的非关键调试消息不会形成未处理 rejection", async () => {
  const sent: unknown[] = [];

  await assert.doesNotReject(async () => {
    await sendRuntimeMessageBestEffort(
      (message) => {
        sent.push(message);
        return Promise.reject(new Error("Extension context invalidated."));
      },
      { type: "plm:append-debug-record" },
    );
  });

  assert.deepEqual(sent, [{ type: "plm:append-debug-record" }]);
});
