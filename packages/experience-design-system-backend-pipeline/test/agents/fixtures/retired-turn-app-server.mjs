import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const threads = new Map();
const active = new Map();
const trace = (value) => {
  if (process.env.RETIRED_TURN_TRACE)
    appendFileSync(
      process.env.RETIRED_TURN_TRACE,
      JSON.stringify(value) + "\n",
    );
};
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const event = (method, params) => send({ method, params });
const answer = (id, result) => send({ id, result });
trace({ kind: "spawn" });

function retiredEvents(threadId, history) {
  for (const turnId of history) {
    event("turn/started", {
      threadId,
      turn: { id: turnId, status: "inProgress", items: [] },
    });
    event("item/completed", {
      threadId,
      turnId,
      item: {
        id: randomUUID(),
        type: "agentMessage",
        phase: "final_answer",
        text: "RETIRED_OUTPUT",
      },
    });
    event("turn/completed", {
      threadId,
      turn: { id: turnId, status: "completed", items: [] },
    });
  }
}

function finish(threadId, turnId, output) {
  if (!active.delete(turnId)) return;
  event("item/completed", {
    threadId,
    turnId,
    item: {
      id: randomUUID(),
      type: "agentMessage",
      phase: "final_answer",
      text: output,
    },
  });
  threads.get(threadId).push(turnId);
  trace({ kind: "completed", threadId, turnId });
  event("turn/completed", {
    threadId,
    turn: { id: turnId, status: "completed", items: [] },
  });
}

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (method === "initialize") {
    answer(id, {
      userAgent: "retired-turn-fixture",
      platformFamily: "unix",
      platformOs: "test",
    });
  } else if (method === "initialized") {
    return;
  } else if (method === "thread/start" || method === "thread/resume") {
    const threadId =
      method === "thread/resume" ? params.threadId : randomUUID();
    threads.set(threadId, []);
    trace({ kind: method, threadId });
    answer(id, { thread: { id: threadId }, model: params.model });
  } else if (method === "turn/start") {
    const plan = JSON.parse(params.input[0].text.split("\n")[0]);
    const history = threads.get(params.threadId);
    const turnId =
      plan.reusedId ??
      (plan.mode === "reuse"
        ? history[plan.reuseIndex ?? history.length - 1]
        : randomUUID());
    const turn = { id: turnId, status: "inProgress", items: [] };
    active.set(turnId, params.threadId);
    trace({
      kind: "turn/start",
      threadId: params.threadId,
      turnId,
      order: plan.order,
    });
    const notify = () => {
      if (plan.mode === "late") retiredEvents(params.threadId, history);
      event("turn/started", { threadId: params.threadId, turn });
    };
    const complete = () => {
      if (plan.mode !== "hang")
        setTimeout(
          () => finish(params.threadId, turnId, plan.output),
          plan.delayMs ?? 5,
        );
    };
    if (plan.order === "response-first") {
      answer(id, { turn });
      setTimeout(() => {
        notify();
        complete();
      }, 10);
    } else {
      notify();
      setTimeout(() => {
        answer(id, { turn });
        complete();
      }, 10);
    }
  } else if (method === "turn/interrupt") {
    answer(id, {});
    if (active.delete(params.turnId))
      event("turn/completed", {
        threadId: params.threadId,
        turn: { id: params.turnId, status: "interrupted", items: [] },
      });
  }
});
