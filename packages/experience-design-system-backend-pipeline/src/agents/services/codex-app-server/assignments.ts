import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AgentConversation } from '../../types/agent-run.js';
import type { AgentAssignment, RelatedBatchHandoff } from '../../types/invoker.js';

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const sha256 = /^[a-f0-9]{64}$/;
const same = isDeepStrictEqual;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
interface Session {
  assignment: AgentAssignment;
  conversation?: AgentConversation;
  connection?: object;
  active: boolean;
  transferred: boolean;
  outputDigest?: string;
  admissionDigest?: string;
}

export class AssignmentSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly handoffs = new Map<string, RelatedBatchHandoff>();
  constructor(
    private readonly operationId: string,
    private readonly capacity: number,
  ) {}

  snapshot(input: AgentAssignment, model: string): AgentAssignment {
    if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 256 || !input.binding)
      throw new Error('Invalid persistent assignment');
    const b = input.binding;
    if (
      [b.sourceDigest, b.rulesDigest, b.toolsDigest, b.contextDigest, b.environmentDigest].some(
        (item) => !sha256.test(item),
      ) ||
      b.model !== model ||
      !b.role ||
      b.role.length > 256
    )
      throw new Error('Invalid assignment binding or model');
    if (
      !Array.isArray(input.inventory) ||
      !input.inventory.length ||
      input.inventory.some((item) => typeof item !== 'string' || !item) ||
      new Set(input.inventory).size !== input.inventory.length
    )
      throw new Error('Invalid assignment inventory');
    if (
      !Array.isArray(input.validators) ||
      !input.validators.length ||
      input.validators.some((item) => !item.path || !sha256.test(item.digest))
    )
      throw new Error('Invalid assignment validator references');
    if (
      !Array.isArray(input.admittedPrerequisites) ||
      input.admittedPrerequisites.some(
        (item) => !item.assignmentId || !sha256.test(item.outputDigest) || !sha256.test(item.admissionDigest),
      )
    )
      throw new Error('Invalid admitted assignment prerequisites');
    if (Buffer.byteLength(JSON.stringify(input)) > 512 * 1024) throw new Error('Assignment capacity exceeded');
    return freeze(structuredClone(input));
  }

  claim(assignment: AgentAssignment, conversation?: AgentConversation, handoff?: RelatedBatchHandoff): Session {
    const prior = this.sessions.get(assignment.id);
    if (prior) {
      if (handoff || !same(prior.assignment, assignment)) throw new Error('Changed assignment binding');
      if (prior.active || prior.transferred) throw new Error('Assignment thread already owned or transferred');
      if (!same(prior.conversation, conversation)) throw new Error('Repair requires exact assignment conversation');
      prior.active = true;
      prior.outputDigest = undefined;
      prior.admissionDigest = undefined;
      return prior;
    }
    if (this.sessions.size >= this.capacity) throw new Error('Persistent session capacity exceeded');
    if (conversation && !handoff) throw new Error('Foreign assignment conversation');
    let source: Session | undefined;
    if (handoff) {
      const issued = this.handoffs.get(handoff.token);
      if (
        !issued ||
        !same(issued, handoff) ||
        handoff.operationId !== this.operationId ||
        !same(handoff.binding, assignment.binding)
      )
        throw new Error('Foreign or stale related batch handoff binding');
      source = this.sessions.get(handoff.prerequisite.assignmentId);
      if (
        !source ||
        source.active ||
        source.transferred ||
        source.admissionDigest !== handoff.prerequisite.admissionDigest ||
        source.outputDigest !== handoff.prerequisite.outputDigest ||
        !same(source.conversation, handoff.conversation)
      )
        throw new Error('Related batch handoff session already owned or stale');
      if (conversation && !same(conversation, handoff.conversation))
        throw new Error('Related batch conversation mismatch');
      if (!assignment.admittedPrerequisites.some((item) => same(item, handoff.prerequisite)))
        throw new Error('Related batch handoff requires admitted prerequisite');
      source.transferred = true;
      this.handoffs.delete(handoff.token);
    }
    const session: Session = {
      assignment,
      conversation: source?.conversation,
      connection: source?.connection,
      active: true,
      transferred: false,
    };
    this.sessions.set(assignment.id, session);
    return session;
  }

  hasOtherThreadOwner(session: Session, threadId: string): boolean {
    for (const owner of this.sessions.values()) {
      if (owner !== session && !owner.transferred && owner.conversation?.id === threadId) return true;
    }
    return false;
  }

  admit(id: string, outputDigest: string, admissionDigest: string): void {
    const session = this.sessions.get(id);
    if (
      !session ||
      session.active ||
      session.transferred ||
      !session.outputDigest ||
      session.outputDigest !== outputDigest ||
      !sha256.test(admissionDigest)
    )
      throw new Error('Host admission requires completed exact output digest');
    session.admissionDigest = admissionDigest;
  }

  handoff(id: string): RelatedBatchHandoff {
    const session = this.sessions.get(id);
    if (
      !session ||
      session.active ||
      session.transferred ||
      !session.conversation ||
      !session.admissionDigest ||
      !session.outputDigest
    )
      throw new Error('Related batch handoff requires host admission');
    for (const handoff of this.handoffs.values()) if (handoff.prerequisite.assignmentId === id) return handoff;
    const handoff = freeze({
      operationId: this.operationId,
      token: randomUUID(),
      conversation: session.conversation,
      binding: session.assignment.binding,
      prerequisite: { assignmentId: id, outputDigest: session.outputDigest, admissionDigest: session.admissionDigest },
    });
    this.handoffs.set(handoff.token, handoff);
    return handoff;
  }

  clear(): void {
    this.sessions.clear();
    this.handoffs.clear();
  }
}
