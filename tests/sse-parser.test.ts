import { describe, it, expect } from 'vitest';
import { parseSSEChunk, type SSEParserState } from '../src/client/hooks/useSSE.js';

function initialState(): SSEParserState {
  return { buffer: '', currentEventType: '' };
}

describe('parseSSEChunk', () => {
  it('parses simple data event', () => {
    const chunk = 'data: {"message":"hello"}\n';
    const result = parseSSEChunk(chunk, initialState());

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      type: 'message',
      data: { message: 'hello' }
    });
  });

  it('parses event with custom type', () => {
    const chunk = 'event: phase\ndata: {"phase":1}\n';
    const result = parseSSEChunk(chunk, initialState());

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      type: 'phase',
      data: { phase: 1 }
    });
  });

  it('parses multiple events in single chunk', () => {
    const chunk = 'event: a\ndata: {"n":1}\nevent: b\ndata: {"n":2}\n';
    const result = parseSSEChunk(chunk, initialState());

    expect(result.events).toHaveLength(2);
    expect(result.events[0].type).toBe('a');
    expect(result.events[1].type).toBe('b');
  });

  it('buffers incomplete lines across chunks', () => {
    const state = initialState();

    // First chunk ends mid-line
    const result1 = parseSSEChunk('data: {"partial', state);
    expect(result1.events).toHaveLength(0);
    expect(result1.state.buffer).toBe('data: {"partial');

    // Second chunk completes the line
    const result2 = parseSSEChunk('":true}\n', result1.state);
    expect(result2.events).toHaveLength(1);
    expect(result2.events[0].data).toEqual({ partial: true });
  });

  it('preserves event type across data lines', () => {
    const chunk = 'event: contract\ndata: {"name":"A"}\ndata: {"name":"B"}\n';
    const result = parseSSEChunk(chunk, initialState());

    expect(result.events).toHaveLength(2);
    expect(result.events[0].type).toBe('contract');
    expect(result.events[1].type).toBe('contract');
  });

  it('ignores comment lines', () => {
    const chunk = ': this is a comment\ndata: {"valid":true}\n';
    const result = parseSSEChunk(chunk, initialState());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].data).toEqual({ valid: true });
  });

  it('ignores empty lines', () => {
    const chunk = '\n\ndata: {"value":1}\n\n';
    const result = parseSSEChunk(chunk, initialState());

    expect(result.events).toHaveLength(1);
  });

  it('handles whitespace in event type', () => {
    const chunk = 'event:  spaced  \ndata: {"x":1}\n';
    const result = parseSSEChunk(chunk, initialState());

    expect(result.events[0].type).toBe('spaced');
  });

  it('maintains state across multiple calls', () => {
    let state = initialState();

    const result1 = parseSSEChunk('event: first\n', state);
    state = result1.state;
    expect(result1.events).toHaveLength(0);
    expect(state.currentEventType).toBe('first');

    const result2 = parseSSEChunk('data: {"done":true}\n', state);
    expect(result2.events).toHaveLength(1);
    expect(result2.events[0].type).toBe('first');
  });
});
