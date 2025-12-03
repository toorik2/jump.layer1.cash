/**
 * SSE Stream Hook
 * Clean abstraction for Server-Sent Events via fetch
 */

export interface SSEEvent {
  type: string;
  data: any;
}

export type SSEEventHandler = (event: SSEEvent) => void;

/**
 * Parse SSE stream from fetch response
 * Yields events as they arrive
 */
async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEventType = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim() || line.startsWith(':')) continue;

      if (line.startsWith('event:')) {
        currentEventType = line.substring(6).trim();
        continue;
      }

      if (line.startsWith('data:')) {
        const data = JSON.parse(line.substring(5).trim());
        yield { type: currentEventType || 'message', data };
      }
    }
  }
}

/**
 * Stream SSE events from a POST endpoint
 */
export async function streamSSE(
  url: string,
  body: object,
  onEvent: SSEEventHandler,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok || !response.body) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.error) {
        errorMessage = errorData.error;
        if (errorData.message) errorMessage += `: ${errorData.message}`;
        if (errorData.retryAfter) errorMessage += ` (retry after ${errorData.retryAfter}s)`;
      }
    } catch {
      if (response.statusText) errorMessage += `: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  const reader = response.body.getReader();

  for await (const event of parseSSEStream(reader)) {
    onEvent(event);
  }
}
