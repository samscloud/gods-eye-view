import { createVoiceCommands as bindVoiceCommands } from './sessionCommands.js';
import { createOvercastSession } from './overcastSession.js';

/**
 * Default composition: the Overcast adapter (browser speech + Overcast's LLM
 * gateway). The OpenAI Realtime adapter (./realtimeSession.js) is no longer
 * wired in; callers may still supply another session adapter factory.
 */
export function createVoiceCommands(options) {
  return bindVoiceCommands({
    createSession: createOvercastSession,
    ...options,
  });
}
