import type { Transport } from "@modelcontextprotocol/server";

/**
 * Pipes every JSON-RPC message between two transports, unchanged, both ways.
 *
 * Used when the stdio package starts with no REGISTRUM_API_KEY (#61): the local
 * end is the user's MCP client on stdio, the remote end is the hosted keyless
 * endpoint. A byte-level relay rather than a re-implemented server, so the
 * hosted endpoint stays the one place that owns the anonymous caps, the signup
 * nudge and the tool set - nothing here can drift from it.
 */
export async function relay(local: Transport, remote: Transport): Promise<void> {
  let closing = false;
  const closeBoth = () => {
    if (closing) return;
    closing = true;
    void local.close().catch(() => undefined);
    void remote.close().catch(() => undefined);
  };

  local.onmessage = (message) => {
    remote.send(message).catch((e: Error) => {
      // A request that never reached the endpoint must still be answered, or
      // the user's client waits on it until its own timeout.
      if ("id" in message && "method" in message) {
        void local
          .send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32603, message: `Registrum hosted endpoint unreachable: ${e.message}` },
          })
          .catch(() => undefined);
      }
    });
  };
  remote.onmessage = (message) => {
    local.send(message).catch(() => closeBoth());
  };
  local.onclose = closeBoth;
  remote.onclose = closeBoth;
  remote.onerror = (e) => process.stderr.write(`registrum-mcp: hosted endpoint error: ${e.message}\n`);

  await remote.start();
  await local.start();
}
