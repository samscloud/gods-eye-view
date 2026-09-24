import test from 'node:test';
import assert from 'node:assert/strict';
import { flyToAustin, setOvercastEmbedStartView, OVERCAST_EMBED_START } from '../camera.js';

test('teardown before the initial camera delay prevents a late flight', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let flights = 0;
  let cancelled = 0;
  const stop = flyToAustin({
    isDestroyed: () => false,
    camera: {
      setView() {},
      flyTo() {
        flights++;
      },
      cancelFlight() {
        cancelled++;
      },
    },
  });
  stop();
  t.mock.timers.tick(1000);
  assert.equal(flights, 0);
  assert.equal(cancelled, 1);
});

test('the Command Center embed opens on the whole Earth, not Austin at street level', () => {
  let view = null;
  setOvercastEmbedStartView({ camera: { setView: (v) => { view = v; } } });
  assert.ok(view, 'setView called');
  assert.ok(OVERCAST_EMBED_START.height >= 15_000_000);
  const r = Math.hypot(view.destination.x, view.destination.y, view.destination.z);
  assert.ok(r > 6_378_137 + 15_000_000, 'camera is far enough out to see a hemisphere');
});
