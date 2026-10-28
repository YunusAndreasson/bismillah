import type { Socket } from "node:net";

interface Pending {
  execute: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Commands and replies on one QEMU monitor connection. */
export class QmpClient {
  private buffer = "";
  private readonly waiting = new Map<number, Pending>();
  private readonly socket: Socket;
  private readonly timeoutMs: number;
  private nextId = 0;
  private failure: Error | null = null;

  constructor(socket: Socket, timeoutMs = 30_000) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (let nl = this.buffer.indexOf("\n"); nl >= 0; nl = this.buffer.indexOf("\n")) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        try {
          const parsed: unknown = JSON.parse(line);
          if (!parsed || typeof parsed !== "object") throw new Error("invalid QMP response");
          const reply = parsed as Record<string, unknown>;
          const id = reply["id"];
          if (typeof id !== "number") continue; // Greeting or asynchronous event.
          const pending = this.waiting.get(id);
          if (!pending) continue; // A late reply to a timed-out request.
          if (!("return" in reply) && !("error" in reply)) throw new Error("invalid QMP response");
          this.waiting.delete(id);
          clearTimeout(pending.timer);
          if ("error" in reply)
            pending.reject(new Error(`qmp ${pending.execute}: ${JSON.stringify(reply["error"])}`));
          else pending.resolve(reply["return"]);
        } catch {
          this.abort(new Error("invalid QMP response"));
          socket.destroy();
          return;
        }
      }
    });
    socket.on("error", (error) => this.abort(error));
    socket.once("close", () => this.abort(new Error("QMP connection closed")));
  }

  private abort(error: Error): void {
    this.failure ??= error;
    for (const pending of this.waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    this.waiting.clear();
  }

  async command(execute: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (this.failure) throw this.failure;
    if (this.socket.destroyed || !this.socket.writable) throw new Error("QMP connection closed");
    const id = ++this.nextId;
    const message = JSON.stringify({ execute, arguments: args, id }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`qmp ${execute}: timed out`));
      }, this.timeoutMs);
      this.waiting.set(id, { execute, resolve, reject, timer });
      this.socket.write(message, (error) => {
        if (error) this.abort(error);
      });
    });
  }
}
