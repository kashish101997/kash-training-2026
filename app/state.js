import { localDay } from './models.js';

export const STATE_KEY = 'kash_os_state_v4';
export const LEGACY_KEY = 'kash_fitness_2026_v3';

export const DEFAULT_PRACTICES = Object.freeze([
  { id: 'dharma-breath', title: 'Five quiet breaths', minutes: 2, order: 0, active: true },
  { id: 'dharma-verse', title: 'Read one Gita verse', minutes: 5, order: 1, active: true },
  { id: 'dharma-gratitude', title: 'Write one gratitude', minutes: 2, order: 2, active: true },
  { id: 'dharma-review', title: 'Evening review', minutes: 5, order: 3, active: true },
]);

export function defaultState() {
  return {
    schemaVersion: 4,
    migratedAt: null,
    practices: DEFAULT_PRACTICES.map(value => ({ ...value })),
    practiceCompletions: [],
    measurements: [],
    bloodSugar: [],
    journal: [],
    workouts: [],
    meals: [],
    injuries: [],
    notificationPreference: false,
    lastRefreshAt: null,
  };
}

export function loadState() {
  const existing = parse(localStorage.getItem(STATE_KEY));
  if (existing?.schemaVersion === 4) return normalize(existing);
  const migrated = migrateLegacy(parse(localStorage.getItem(LEGACY_KEY)));
  saveState(migrated);
  return migrated;
}

export function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify({ ...state, schemaVersion: 4 }));
}

export function migrateLegacy(legacy) {
  const state = defaultState();
  if (!legacy || typeof legacy !== 'object') {
    state.migratedAt = new Date().toISOString();
    return state;
  }
  state.migratedAt = new Date().toISOString();
  state.measurements = [...(legacy.measurements || [])];
  for (const weight of legacy.weights || []) {
    const kg = Number(weight.kg ?? weight.weight ?? weight.value);
    if (!Number.isFinite(kg)) continue;
    if (state.measurements.some(item => item.date === weight.date && Number(item.weight ?? item.weightKilograms) === kg)) continue;
    state.measurements.push({ id: weight.id || `legacy-weight-${weight.date}-${kg}`, timestamp: `${weight.date || localDay()}T06:00:00`, date: weight.date || localDay(), weightKilograms: kg, notes: weight.notes || '', source: 'legacy' });
  }
  state.bloodSugar = [...(legacy.bloodSugar || [])];
  state.workouts = [...(legacy.workouts || [])];
  state.meals = [...(legacy.meals || []), ...(legacy.foodLog || [])];
  state.injuries = [...(legacy.injuries || [])];
  if (Array.isArray(legacy.dharmaPractices) && legacy.dharmaPractices.length) {
    state.practices = legacy.dharmaPractices.map((item, index) => ({
      id: item.id || `legacy-practice-${index}`,
      title: item.title || item.name || `Practice ${index + 1}`,
      minutes: Number(item.minutes || 5), order: index, active: item.active !== false,
    }));
  }
  return normalize(state);
}

export function mergeRemoteState(state, entities) {
  const merged = { ...state };
  const records = [...entities.values()];
  const dataOf = kind => records.filter(record => record.kind === kind).map(record => ({ ...record.data, _revision: record.revision, _entityID: record.id }));
  const remotePractices = dataOf('practice_template');
  if (remotePractices.length) merged.practices = remotePractices.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  merged.practiceCompletions = dedupe([...merged.practiceCompletions, ...dataOf('practice_completion')]);
  const remoteWeights = dataOf('weights').map(item => ({
    ...item,
    id: item.id || item._entityID,
    timestamp: item.timestamp || (item.date ? `${item.date}T06:00:00` : null),
    weightKilograms: item.weightKilograms ?? item.kg ?? item.weight ?? item.value,
    source: item.source || 'legacy sync',
  }));
  merged.measurements = dedupe([...merged.measurements, ...dataOf('body_measurement'), ...dataOf('measurements'), ...remoteWeights]);
  merged.bloodSugar = dedupe([...merged.bloodSugar, ...dataOf('bloodSugar')]);
  merged.journal = dedupe([...merged.journal, ...dataOf('journal')]);
  merged.workouts = dedupe([...merged.workouts, ...dataOf('workout'), ...dataOf('workouts')]);
  merged.meals = dedupe([...merged.meals, ...dataOf('meals'), ...dataOf('foodLog')]);
  merged.injuries = dedupe([...merged.injuries, ...dataOf('injuries')]);
  return normalize(merged);
}

function normalize(value) {
  const base = defaultState();
  return {
    ...base, ...value, schemaVersion: 4,
    practices: Array.isArray(value.practices) && value.practices.length ? value.practices : base.practices,
    practiceCompletions: value.practiceCompletions || [],
    measurements: value.measurements || [], bloodSugar: value.bloodSugar || [],
    journal: value.journal || [], workouts: value.workouts || [], meals: value.meals || [], injuries: value.injuries || [],
  };
}

function dedupe(values) {
  const map = new Map();
  for (const item of values.filter(Boolean)) {
    const key = item.id || item.uuid || item._entityID || `${item.date || item.timestamp}:${item.title || item.name || item.value || ''}`;
    map.set(String(key), { ...(map.get(String(key)) || {}), ...item });
  }
  return [...map.values()];
}

function parse(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}
