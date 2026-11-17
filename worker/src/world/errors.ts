// Сообщение ошибки = код. Через RPC Durable Object надёжно доходит именно message,
// поэтому Worker превращает код в HTTP-статус по таблице.
export class ApiError extends Error {
  status: number;
  code: string;
  /** Необязательный Retry-After в секундах для 429. */
  retryAfter?: number;
  constructor(status: number, code: string, retryAfter?: number) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
