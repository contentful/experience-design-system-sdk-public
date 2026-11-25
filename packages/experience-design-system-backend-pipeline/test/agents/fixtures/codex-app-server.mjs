import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
const trace = (entry) =>
  process.env.FAKE_CODEX_TRACE &&
  appendFileSync(process.env.FAKE_CODEX_TRACE, JSON.stringify(entry) + "\n");
trace({ kind: "spawn", pid: process.pid });
let initialized = false;
const threads = new Set();
const repeatedThreadId = randomUUID();
const turns = new Map();
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const event = (method, params) => send({ method, params });
const answer = (id, result) => send({ id, result });
const complete = (threadId, turnId, prompt) => {
  if (!turns.has(turnId)) return;
  turns.delete(turnId);
  const item = {
    id: randomUUID(),
    type: "agentMessage",
    text: `FINAL:${prompt}`,
    phase: "final_answer",
  };
  if (prompt === "buffer") {
    process.stdout.write("x".repeat(6000));
    return;
  }
  if (prompt === "unsupported-request") {
    send({
      id: 500,
      method: "item/commandExecution/requestApproval",
      params: { threadId, turnId },
    });
    return;
  }
  if (prompt === "malformed") {
    process.stdout.write("{broken\n");
    return;
  }
  if (prompt === "unknown-request") {
    answer(999999, {});
    return;
  }
  if (prompt === "orphan-exit") {
    const orphan = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    trace({ kind: "orphan", pid: orphan.pid });
    process.exit(7);
  }
  if (prompt === "exit") {
    process.exit(7);
  }
  const target = prompt === "wrong-thread" ? randomUUID() : threadId;
  const targetTurn = prompt === "wrong-turn" ? randomUUID() : turnId;
  event("item/completed", {
    threadId: target,
    turnId: targetTurn,
    item: {
      id: "log",
      type: "commandExecution",
      aggregatedOutput: "DOMAIN_POISON",
    },
  });
  event("item/completed", {
    threadId: target,
    turnId: targetTurn,
    item: {
      id: "comment",
      type: "agentMessage",
      text: "COMMENTARY_POISON",
      phase: "commentary",
    },
  });
  if (prompt !== "empty") {
    event("item/agentMessage/delta", {
      threadId: target,
      turnId: targetTurn,
      itemId: item.id,
      delta: "STREAM_ONLY",
    });
    event("item/completed", { threadId: target, turnId: targetTurn, item });
  }
  event("thread/tokenUsage/updated", {
    threadId,
    turnId,
    tokenUsage: {
      last: {
        inputTokens: 12,
        cachedInputTokens: 4,
        outputTokens: 3,
        reasoningOutputTokens: 1,
        totalTokens: 15,
      },
      total: {
        inputTokens: 200,
        cachedInputTokens: 100,
        outputTokens: 50,
        reasoningOutputTokens: 20,
        totalTokens: 250,
      },
    },
  });
  event("turn/completed", {
    threadId: target,
    turn: {
      id: targetTurn,
      items: [],
      status: ["failed", "rate-limited", "unauthorized"].includes(prompt)
        ? "failed"
        : "completed",
      error: ["failed", "rate-limited", "unauthorized"].includes(prompt)
        ? {
            message: "PRIVATE_ERROR",
            codexErrorInfo:
              prompt === "rate-limited"
                ? "rateLimitExceeded"
                : prompt === "unauthorized"
                  ? "unauthorized"
                  : undefined,
          }
        : null,
    },
  });
};
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  trace({
    kind: request.method,
    id: request.id,
    threadId: request.params?.threadId,
    model: request.params?.model,
  });
  const { id, method, params } = request;
  if (method === "initialize") {
    if (initialized) throw new Error("duplicate initialization");
    initialized = true;
    answer(id, {
      userAgent: "fake",
      platformFamily: "unix",
      platformOs: "test",
    });
  } else if (method === "initialized") {
    if (!initialized) throw new Error("uninitialized");
  } else if (method === "thread/start" || method === "thread/resume") {
    const threadId =
      method === "thread/start"
        ? process.env.FAKE_CODEX_REUSE_THREAD === "1"
          ? repeatedThreadId
          : randomUUID()
        : params.threadId;
    threads.add(threadId);
    answer(id, {
      thread: { id: threadId },
      model: params.model,
      modelProvider: "configured",
      cwd: process.cwd(),
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: { type: "dangerFullAccess" },
    });
  } else if (method === "turn/start") {
    if (!threads.has(params.threadId)) throw new Error("foreign thread");
    const turnId = randomUUID();
    const artifactMatch = params.input[0].text.match(/Prompt artifact: (".*")/);
    const prompt = (
      artifactMatch
        ? readFileSync(JSON.parse(artifactMatch[1]), "utf8")
        : params.input[0].text
    ).split("\n")[0];
    trace({
      kind: "assignment-input",
      threadId: params.threadId,
      text: params.input[0].text,
    });
    turns.set(turnId, params.threadId);
    event("turn/started", {
      threadId: params.threadId,
      turn: { id: turnId, status: "inProgress", items: [] },
    });
    answer(id, { turn: { id: turnId, status: "inProgress", items: [] } });
    if (prompt !== "hang")
      setTimeout(
        () => complete(params.threadId, turnId, prompt),
        prompt === "slow" ? 120 : 5,
      );
  } else if (method === "turn/interrupt") {
    answer(id, {});
    if (turns.has(params.turnId)) {
      turns.delete(params.turnId);
      setTimeout(
        () =>
          event("turn/completed", {
            threadId: params.threadId,
            turn: { id: params.turnId, status: "interrupted", items: [] },
          }),
        15,
      );
    }
  } else {
    send({ id, error: { code: -32601, message: "unknown method" } });
  }
});

input.on("close", () =>
  trace({ kind: "resources-at-stdin-eof", usage: process.resourceUsage() }),
);
