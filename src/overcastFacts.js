/**
 * What an Overcast layer item actually is, in a few words.
 *
 * Gary B, 25 Sep 2026: the globe's detail cards were vague — "Coastal Flood
 * Warning issue… / WEATHER ALERTS · HIGH · 4h". The rows carry the specifics
 * (the NWS area and expiry, a volcano's alert level and colour code, a
 * quake's depth, a storm's wind and pressure); this turns them into a short
 * title and fact lines. Only fields the feed supplied are shown: a missing
 * value is left out, never filled in. Pure; exported for tests.
 */

const MAX_ATTR_LEN = 240;

/** Keep only primitive attribute values, short, from a feed row. */
export function sanitizeAttributes(attributes) {
  const out = {};
  if (!attributes || typeof attributes !== 'object') return out;
  for (const [k, v] of Object.entries(attributes)) {
    if (typeof v === 'string') {
      const s = v.trim();
      if (s) out[k] = s.slice(0, MAX_ATTR_LEN);
    } else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const firstArea = (v) => str(v).split(/;\s*/)[0] || '';
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const round = (n, d = 0) => (n === null ? null : Number(n.toFixed(d)));

/** "until 18:00 UTC" (same day) or "until 26 Sep 18:00 UTC"; '' when unknown. */
export function untilText(iso, nowMs = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const sameDay = new Date(nowMs).toISOString().slice(0, 10) === d.toISOString().slice(0, 10);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `until ${sameDay ? '' : `${day} `}${hm} UTC`;
}

/**
 * @param {{kind?: string, label: string, attrs?: object, ends?: string}} p
 * @param {number} [nowMs]
 * @returns {{ title: string, facts: string[], summary: string }}
 */
export function describeOvercastPoint(p, nowMs = Date.now()) {
  const a = p.attrs || {};
  const facts = [];
  const add = (...parts) => {
    const line = parts.filter((x) => x !== null && x !== undefined && x !== '').join(' · ');
    if (line) facts.push(line);
  };
  let title = p.label;
  let summary = '';

  switch (p.kind) {
    case 'weather-alert': {
      title = str(a.event) || title;
      add(firstArea(a.areaDesc), p.ends ? untilText(p.ends, nowMs) : '');
      summary = str(a.headline);
      break;
    }
    case 'volcanic-activity': {
      title = str(a.volcano_name) || str(a.name) || title;
      const level = str(a.alert_level);
      const color = str(a.color_code);
      add(level ? `Alert ${level}` : '', color ? `Aviation ${color}` : '');
      const elev = num(a.elevation_m);
      add(str(a.region), elev !== null ? `${Math.round(elev).toLocaleString('en-US')} m` : '');
      summary = str(a.synopsis);
      break;
    }
    case 'earthquake': {
      title = str(a.title) || str(a.place) || title;
      const depth = num(a.depth);
      const felt = num(a.felt);
      add(depth !== null ? `Depth ${round(depth, 1)} km` : '', num(a.tsunami) > 0 ? 'Tsunami flag' : '', felt ? `${felt} felt reports` : '');
      break;
    }
    case 'tropical-storm': {
      title = str(a.name) || title;
      const wind = num(a.wind_speed);
      const pressure = num(a.pressure);
      add(str(a.category), wind !== null ? `${wind} kt` : '', pressure !== null ? `${pressure} mb` : '');
      add(str(a.movement));
      break;
    }
    case 'flood-stage': {
      title = str(a.name) || title;
      add(str(a.flood_category) ? `${cap(str(a.flood_category))} flooding` : '', a.forecast_only === true ? 'Forecast' : '', str(a.state));
      break;
    }
    case 'fema-shelter': {
      title = str(a.name) || title;
      add([str(a.city), str(a.state)].filter(Boolean).join(', '), cap(str(a.status)));
      const pop = num(a.population);
      const capy = num(a.evacuationCapacity);
      add(pop !== null && capy ? `${pop}/${capy} occupied` : '', str(a.organization));
      break;
    }
    case 'fema-disaster': {
      title = str(a.title) || title;
      add(str(a.incidentType), [str(a.designatedArea), str(a.state)].filter(Boolean).join(', '));
      add(str(a.declarationType) ? `Declaration ${str(a.declarationType)}` : '', num(a.disasterNumber) ? `DR-${num(a.disasterNumber)}` : '');
      break;
    }
    case 'nuclear-facility': {
      title = str(a.name) || title;
      const mw = num(a.capacity_mw);
      add(str(a.country), str(a.status), str(a.reactor_type), mw ? `${mw.toLocaleString('en-US')} MW` : '');
      break;
    }
    case 'conflict': {
      title = str(a.title) || title;
      add([str(a.region), str(a.country)].filter(Boolean).join(', '), cap(str(a.type)), cap(str(a.status)));
      add(str(a.parties));
      summary = str(a.description);
      break;
    }
    case 'disease': {
      title = str(a.title) || str(a.description).split(/[.:]/)[0] || title;
      add(str(a.region), cap(str(a.type)));
      summary = str(a.description);
      break;
    }
    case 'satellite': {
      title = str(a.name) || title;
      add(cap(str(a.object_type)), num(a.norad_id) ? `NORAD ${num(a.norad_id)}` : '');
      break;
    }
    default: {
      title = str(a.name) || str(a.title) || title;
      add([str(a.city), str(a.state)].filter(Boolean).join(', ') || str(a.region), str(a.country));
      add(cap(str(a.type)), cap(str(a.status)), str(a.operator));
      summary = str(a.description) || str(a.situation);
    }
  }
  return { title: String(title || '').trim(), facts, summary };
}
