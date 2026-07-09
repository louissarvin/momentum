/**
 * TxLINE SSE parser — Phase B / B.3.
 *
 * Manual SSE parser because we cannot use EventSource (no custom-header
 * support, and TxLINE requires both `Authorization: Bearer <jwt>` and
 * `X-Api-Token: <apiToken>`).
 *
 * Parse rules (per TxLINE docs and W3C SSE spec):
 *   - Events are separated by a blank line ("\r?\n\r?\n").
 *   - Each event is a sequence of key:value lines.
 *   - Lines beginning with a single ':' are heartbeats — discard.
 *   - Multiple `data:` lines within an event are joined with "\n".
 *   - The parser is stateful over a byte buffer so partial events are safe.
 */

export interface SseEvent {
  /** Optional event name from `event:` line. */
  event?: string;
  /** Concatenated data payload from all `data:` lines in the event. */
  data: string;
  /** Optional last-event-id from `id:` line. */
  id?: string;
  /** Optional retry hint from `retry:` line. */
  retryMs?: number;
}

/**
 * Streaming parser that yields fully-formed events as bytes arrive.
 *
 * Usage:
 *   const parser = createSseParser();
 *   for await (const chunk of stream) {
 *     for (const evt of parser.push(chunk)) {
 *       // handle evt
 *     }
 *   }
 */
export function createSseParser() {
  let buf = '';

  return {
    push(chunk: string | Uint8Array): SseEvent[] {
      const s = typeof chunk === 'string' ? chunk : new TextDecoder('utf-8').decode(chunk);
      buf += s;

      const events: SseEvent[] = [];
      // Events end at blank line — supports both CRLF and LF terminators.
      const parts = buf.split(/\r?\n\r?\n/);
      // The last part is potentially incomplete; keep it in the buffer.
      buf = parts.pop() ?? '';
      for (const raw of parts) {
        const evt = parseEvent(raw);
        if (evt) events.push(evt);
      }
      return events;
    },
    /**
     * Reset internal state — call on reconnect.
     */
    reset(): void {
      buf = '';
    },
  };
}

function parseEvent(raw: string): SseEvent | null {
  const lines = raw.split(/\r?\n/);
  let eventName: string | undefined;
  let id: string | undefined;
  let retryMs: number | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.length === 0) continue;
    // Comments: any line starting with ':' is a heartbeat/comment.
    if (line.startsWith(':')) continue;

    const colonIdx = line.indexOf(':');
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    // Per spec, trim a single leading space after the colon.
    let value = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        eventName = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'id':
        id = value;
        break;
      case 'retry': {
        const n = Number(value);
        if (Number.isFinite(n)) retryMs = n;
        break;
      }
      default:
        // Unknown field — ignore per spec.
        break;
    }
  }

  if (dataLines.length === 0 && !eventName && !id) return null;
  return {
    event: eventName,
    data: dataLines.join('\n'),
    id,
    retryMs,
  };
}
