// Каркас лобби. Выдача мест добавляется следующим коммитом.
export class WorldLobby {
  constructor(private state: DurableObjectState, _env: unknown) {}

  async fetch(_request: Request): Promise<Response> {
    return Response.json({ lobby: true });
  }
}
