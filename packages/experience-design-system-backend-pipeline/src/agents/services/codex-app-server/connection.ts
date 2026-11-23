import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export class CodexTransportError extends Error {
  constructor(
    readonly reason: string,
    readonly rpcCode?: number,
  ) {
    super(`Codex app-server transport: ${reason}`);
  }
}

export class CodexConnection {
  private readonly requests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private nextId = 0;
  private failure?: CodexTransportError;
  private ended = false;
  private closing?: Promise<void>;
  private resolveClosed!: () => void;
  readonly closed = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });
  readonly ready: Promise<void>;
  readonly startedAt = performance.now();
  startupMs?: number;
  initializationMs?: number;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly limit: number,
    private readonly requestTimeoutMs: number,
    private readonly drainTimeoutMs: number,
    private readonly notify: (method: string, params: unknown) => void,
    private readonly onFailure: (error: CodexTransportError) => void,
    private readonly processGroup: boolean,
  ) {
    child.once('spawn', () => {
      this.startupMs = performance.now() - this.startedAt;
    });
    child.once('error', () => this.fail(new CodexTransportError('process-launch')));
    child.stdin.on('error', () => this.fail(new CodexTransportError('broken-stdin')));
    child.stdout.on('data', (chunk: Buffer) => this.read(chunk));
    child.stderr.on('data', () => {});
    child.once('close', () => {
      this.ended = true;
      if (!this.closing) this.fail(new CodexTransportError('process-exit'));
      this.resolveClosed();
    });
    this.ready = this.request('initialize', { clientInfo: { name: 'eds_import', version: '1' } }).then(() => {
      this.send({ method: 'initialized', params: {} });
      this.initializationMs = performance.now() - this.startedAt;
    });
    void this.ready.catch(() => {});
  }

  get failureReason(): string | undefined {
    return this.failure?.reason;
  }

  get alive(): boolean {
    return !this.failure && !this.ended && !this.closing;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (!this.alive) return Promise.reject(this.failure ?? new CodexTransportError('closed'));
    if (this.requests.size >= 1024) return Promise.reject(new CodexTransportError('request-capacity'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new CodexTransportError('request-timeout')), this.requestTimeoutMs);
      this.requests.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        this.fail(error as CodexTransportError);
      }
    });
  }

  private send(value: unknown): void {
    if (!this.alive || !this.child.stdin.writable) throw this.failure ?? new CodexTransportError('broken-stdin');
    const line = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(line) > this.limit || this.child.stdin.writableLength > this.limit)
      throw new CodexTransportError('buffer-limit');
    this.child.stdin.write(line, (error) => {
      if (error) this.fail(new CodexTransportError('broken-stdin'));
    });
  }

  private read(chunk: Buffer): void {
    if (this.failure) return;
    this.pending += this.decoder.write(chunk);
    if (Buffer.byteLength(this.pending) > this.limit) {
      this.fail(new CodexTransportError('buffer-limit'));
      return;
    }
    let end: number;
    while ((end = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      try {
        const message: unknown = JSON.parse(line);
        if (!isRecord(message)) throw new CodexTransportError('malformed-event');
        if ('id' in message) {
          if ('method' in message) throw new CodexTransportError('unsupported-server-request');
          if (typeof message.id !== 'number') throw new CodexTransportError('unknown-request-id');
          const request = this.requests.get(message.id);
          if (!request) throw new CodexTransportError('unknown-request-id');
          this.requests.delete(message.id);
          clearTimeout(request.timer);
          if (isRecord(message.error) && typeof message.error.code === 'number')
            request.reject(new CodexTransportError('rpc-error', message.error.code));
          else if ('result' in message && !('error' in message)) request.resolve(message.result);
          else {
            request.reject(new CodexTransportError('malformed-response'));
            throw new CodexTransportError('malformed-response');
          }
        } else if (typeof message.method === 'string' && 'params' in message) {
          this.notify(message.method, message.params);
        } else throw new CodexTransportError('malformed-event');
      } catch (error) {
        this.fail(error instanceof CodexTransportError ? error : new CodexTransportError('malformed-event'));
        return;
      }
    }
  }

  fail(error: CodexTransportError): void {
    if (this.failure) return;
    this.failure = error;
    this.pending = '';
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.requests.clear();
    this.onFailure(error);
    void this.close();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      for (const request of this.requests.values()) {
        clearTimeout(request.timer);
        request.reject(new CodexTransportError('closed'));
      }
      this.requests.clear();
      this.child.stdin.end();
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (this.processGroup && this.child.pid) process.kill(-this.child.pid, signal);
          else this.child.kill(signal);
        } catch {}
      };
      if (this.ended) {
        if (this.processGroup) kill('SIGKILL');
        return;
      }
      const term = setTimeout(() => kill('SIGTERM'), this.drainTimeoutMs);
      const force = setTimeout(() => kill('SIGKILL'), this.drainTimeoutMs * 2);
      try {
        await this.closed;
      } finally {
        clearTimeout(term);
        clearTimeout(force);
        if (this.processGroup) kill('SIGKILL');
      }
    })();
    return this.closing;
  }
}
