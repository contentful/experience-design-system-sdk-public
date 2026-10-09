const ERROR_BODY_LOG_CAP = 16384;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
    public readonly guidance?: string,
  ) {
    super(message);
    if (body) {
      const trimmed = body.length > ERROR_BODY_LOG_CAP ? body.slice(0, ERROR_BODY_LOG_CAP) + '…' : body;
      this.message = `${message}\n${trimmed}`;
    }
  }
}
