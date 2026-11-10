// Сообщение ошибки = код. Через RPC Durable Object надёжно доходит именно message,
// поэтому Worker превращает код в HTTP-статус по таблице.
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
