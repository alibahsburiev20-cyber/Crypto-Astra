// Каркас мира. Ledger, баланс и Claim добавляются следующим коммитом.
export class World {
  constructor(private state: DurableObjectState, _env: unknown) {}

  async fetch(_request: Request): Promise<Response> {
    return Response.json({ world: this.state.id.toString() });
  }
}
