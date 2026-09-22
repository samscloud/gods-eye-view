/**
 * Overcast voice adapter — our AI, not OpenAI Realtime.
 *
 * Speech → text in the browser (Web Speech API). The text and the globe's own
 * action tools go to the Overcast server (globe.assistant), which calls the
 * Overcast LLM gateway: Qwen on the platform Ollama box, or the user's own key.
 * Tool calls come back and run through the same action runner the Realtime
 * adapter used; results go back to the model until it answers in words, which
 * the browser speaks (speechSynthesis). No audio leaves the browser.
 *
 * Implements the adapter contract in ./session.js: start, stop, sendText,
 * sendMapEvent, plus `capabilities` (no cost meter, no push-to-talk).
 */
import { createActionTools } from './actionSchemas.js';
import { ACTION_DESCRIPTIONS } from '../../server/providers/openai/toolDescriptions.js';
import { realtimeInstructions } from '../../server/providers/openai/instructions.js';

const ENDPOINT = '/api/trpc/globe.assistant';
/** Tool round-trips per spoken request before we stop and say so. */
const MAX_ROUNDS = 6;
/** Conversation turns kept (user + assistant + tool messages). */
const MAX_HISTORY = 24;
/** Tool results are data for the model; cap what one result can inject. */
const MAX_RESULT_CHARS = 6000;

let cachedTools = null;
export function overcastTools() {
  cachedTools ||= createActionTools(ACTION_DESCRIPTIONS).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description || '', parameters: t.parameters },
  }));
  return cachedTools;
}

export function overcastInstructions() {
  return [
    realtimeInstructions()
      .replace(/You are GEV Voice Control[^.]*\./, 'You are Overcast Voice, a concise voice controller for the Overcast live globe.')
      .replace(/God's Eye View/g, 'Overcast')
      .replace(/\bGEV\b/g, 'Overcast'),
    'Replies are read aloud: keep them to one or two short sentences, no lists, no markdown.',
  ].join('\n');
}

function speechRecognitionCtor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

function clip(value) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  } catch {
    text = String(value);
  }
  return text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + '…' : text;
}

/** One call to the Overcast assistant. Exported for tests. */
export async function askOvercast(messages, { fetchImpl = globalThis.fetch, signal } = {}) {
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ json: { messages, tools: overcastTools() } }),
    signal,
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* status decides */
  }
  if (!response.ok || body?.error) {
    const message = body?.error?.json?.message || body?.error?.message || `assistant HTTP ${response.status}`;
    if (response.status === 401) throw new Error('Sign in to Overcast to use voice');
    throw new Error(message);
  }
  const data = body?.result?.data?.json;
  if (!data || typeof data !== 'object') throw new Error('assistant returned nothing');
  return data; // { content, toolCalls: [{ id, name, arguments }], model }
}

export function createOvercastSession({ emit, runAction, signal: lifetime, fetchImpl = globalThis.fetch }) {
  const history = [];
  let recognition = null;
  let active = false;
  let turn = null; // AbortController of the request in flight

  const state = (s, detail) => emit({ type: 'state', state: s, detail });

  function speak(text) {
    const synth = globalThis.speechSynthesis;
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    synth.speak(u);
  }

  function trimHistory() {
    while (history.length > MAX_HISTORY) history.shift();
    // Never start the window on a dangling tool message.
    while (history.length && history[0].role === 'tool') history.shift();
  }

  async function handle(text) {
    const said = String(text || '').trim();
    if (!said) return;
    turn?.abort();
    const controller = new AbortController();
    turn = controller;
    const signal = AbortSignal.any([controller.signal, lifetime]);
    emit({ type: 'transcript', role: 'user', text: said, final: true });
    history.push({ role: 'user', content: said });
    trimHistory();
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        state('thinking', 'Thinking…');
        const out = await askOvercast(
          [{ role: 'system', content: overcastInstructions() }, ...history],
          { fetchImpl, signal },
        );
        if (signal.aborted) return;
        const calls = Array.isArray(out.toolCalls) ? out.toolCalls : [];
        if (!calls.length) {
          const reply = String(out.content || '').trim();
          history.push({ role: 'assistant', content: reply });
          emit({ type: 'transcript', role: 'assistant', text: reply, final: true });
          emit({ type: 'completion' });
          speak(reply);
          break;
        }
        history.push({
          role: 'assistant',
          content: String(out.content || ''),
          tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } })),
        });
        for (const call of calls) {
          let args = {};
          try {
            args = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            history.push({ role: 'tool', tool_call_id: call.id, content: clip({ ok: false, error: 'arguments were not valid JSON' }) });
            continue;
          }
          let result;
          try {
            result = await runAction(call.name, args, { signal });
          } catch (error) {
            if (signal.aborted) return;
            result = { ok: false, error: error?.message || String(error) };
          }
          history.push({ role: 'tool', tool_call_id: call.id, content: clip(result) });
        }
        if (round === MAX_ROUNDS - 1) {
          const reply = 'I ran out of steps on that one.';
          emit({ type: 'transcript', role: 'assistant', text: reply, final: true });
          speak(reply);
        }
      }
      if (active) state('listening', 'Listening');
    } catch (error) {
      if (signal.aborted) return;
      const reason = error?.message || String(error);
      emit({ type: 'transcript', role: 'assistant', text: `Voice unavailable: ${reason}`, final: true });
      state(active ? 'listening' : 'error', reason);
    } finally {
      if (turn === controller) turn = null;
    }
  }

  function startRecognition() {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return false;
    recognition = new Ctor();
    recognition.lang = globalThis.navigator?.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) void handle(r[0]?.transcript || '');
      }
    };
    recognition.onspeechstart = () => {
      globalThis.speechSynthesis?.cancel();
      emit({ type: 'interruption', reason: 'user-speech' });
    };
    // Chrome ends continuous recognition after silence; keep listening while on.
    recognition.onend = () => {
      if (active) {
        try {
          recognition.start();
        } catch {
          /* already restarting */
        }
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        active = false;
        state('error', 'Microphone permission denied');
      }
    };
    recognition.start();
    return true;
  }

  return {
    controller: null,
    capabilities: { costControls: false, pushToTalk: false },
    async start() {
      active = true;
      if (!startRecognition()) {
        // No speech recognition in this browser: typed commands still work.
        state('listening', 'Voice input not supported in this browser — type instead');
        return;
      }
      state('listening', 'Listening');
    },
    stop() {
      active = false;
      turn?.abort();
      turn = null;
      try {
        recognition?.stop();
      } catch {
        /* not running */
      }
      recognition = null;
      globalThis.speechSynthesis?.cancel();
    },
    sendText(text) {
      void handle(text);
    },
    sendMapEvent() {
      /* Map events are Realtime-session context; the request-response model reads state through tools. */
    },
  };
}
