import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(process.argv[2], 'utf8');

function balanced(source, marker, open = '{', close = '}') {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing marker: ${marker}`);
  const start = source.indexOf(open, markerIndex + marker.length);
  let depth = 0, quote = null, escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === open) depth++;
    if (char === close && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unbalanced marker: ${marker}`);
}

function runIIFE(startMarker, endMarker, exportName) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Cannot isolate ${exportName}`);
  const context = {
    window: {},
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    console: { warn() {}, log() {} },
    setTimeout() {}, clearTimeout() {}, Date, Math,
  };
  vm.runInNewContext(html.slice(start, end).replaceAll('</script>', '').replaceAll('<script>', ''), context, { timeout: 2_000 });
  return context.window[exportName].plan;
}

function modality(text = '', type = '') {
  const value = `${type} ${text}`.toLowerCase();
  if (/rest|holiday|no training/.test(value)) return 'recovery';
  if (/cricket|bowl/.test(value)) return 'bowling';
  if (/strength|squat|circuit|brick|hyrox|wall ball|sled/.test(value)) return value.includes('hyrox') || value.includes('brick') ? 'hyrox' : 'strength';
  if (/walk|mobility|recovery/.test(value)) return value.includes('walk') ? 'walk' : 'recovery';
  if (/run|jog|race|tempo|interval|shakeout|parkrun/.test(value)) return 'run';
  return 'other';
}

function distanceMeters(text = '', explicit) {
  if (explicit) return Math.round(Number(explicit) * 1000);
  const match = text.match(/(\d+(?:\.\d+)?)\s*k(?:m)?\b/i);
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

function durationSeconds(text = '') {
  const match = text.match(/(\d+)\s*(?:min|mins|minute)/i);
  return match ? Number(match[1]) * 60 : null;
}

function loadFor(session) {
  if (session.distanceMeters) return Math.max(10, session.distanceMeters / 100);
  if (session.durationSeconds) return Math.max(8, session.durationSeconds / 60 * 1.2);
  return ['strength', 'hyrox', 'bowling'].includes(session.modality) ? 45 : 15;
}

function makeSession({ id, dayOffset, title, type, instructions, reference, explicitKM, strength }) {
  const strengthText = strength
    ? `${strength.focus || ''}\n${(strength.items || []).map(item => `${item.name}: ${item.dose}`).join('\n')}`.trim()
    : '';
  const fullInstructions = [instructions, strengthText].filter(Boolean).join('\n');
  const session = {
    id, dayOffset, title, modality: modality(`${title} ${fullInstructions}`, type),
    distanceMeters: distanceMeters(fullInstructions, explicitKM),
    durationSeconds: durationSeconds(fullInstructions), intensity: type || null,
    instructions: fullInstructions || title, sourceReference: reference,
    estimatedLoad: 0,
    segments: (strength?.items || []).map((item, index) => ({
      id: `${id}-segment-${index + 1}`, kind: 'exercise', repetitions: null,
      distanceMeters: distanceMeters(item.dose), durationSeconds: durationSeconds(item.dose),
      target: item.dose, instructions: item.name,
    })),
  };
  session.estimatedLoad = loadFor(session);
  return session;
}

function convertCalendar(data) {
  const weeks = data.phases.flatMap(phase => phase.schedule.map(week => ({
    id: `personalized-2026-w${week.num}`, index: week.num,
    title: `Week ${week.num} · ${phase.name}`,
    sessions: week.days.flatMap((day, dayIndex) => {
      if (/^(rest|no training|holiday)/i.test(day.trim())) return [];
      return [makeSession({
        id: `personalized-2026-w${week.num}-d${dayIndex + 1}`,
        dayOffset: (week.num - 1) * 7 + dayIndex,
        title: day, type: '', instructions: `${day}. ${week.notes}`,
        reference: `Kash_Annual_Training_Plan_2026.html · phase ${phase.id}, week ${week.num}, day ${dayIndex + 1}`,
      })];
    }),
  })));
  return {
    id: 'personalized-2026-47w', version: 1, title: 'Personalized 47-week calendar',
    summary: 'Fixed-date personalized 2026 calendar from the existing private PWA.',
    modality: 'other', datePolicy: 'fixed', fixedStartDate: '2026-02-22T00:00:00Z',
    sourceID: 'personalized-html', weeks,
  };
}

function convertFixedPlan(plan, metadata) {
  return {
    ...metadata,
    weeks: plan.map((week, weekIndex) => ({
      id: `${metadata.id}-w${week.weekNum || weekIndex + 1}`,
      index: week.weekNum || weekIndex + 1,
      title: `Week ${week.weekNum || weekIndex + 1} · ${week.label || ''}`.trim(),
      sessions: week.days.flatMap((day, dayIndex) => {
        if (day.type === 'rest') return [];
        return [makeSession({
          id: `${metadata.id}-w${week.weekNum || weekIndex + 1}-d${dayIndex + 1}`,
          dayOffset: weekIndex * 7 + dayIndex,
          title: day.title || day.type,
          type: day.type,
          instructions: [day.runLabel, day.runDetail, day.summary].filter(Boolean).join(' · '),
          reference: `Kash_Annual_Training_Plan_2026.html · ${metadata.id}, week ${week.weekNum || weekIndex + 1}, day ${dayIndex + 1}`,
          explicitKM: day.runKm,
          strength: day.strength,
        })];
      }),
    })),
  };
}

const trainingData = vm.runInNewContext(`(${balanced(html, 'const TRAINING_DATA =')})`, Object.create(null), { timeout: 1000 });
const hyroxPlan = runIIFE('(function v25R6HyroxBuild(){', '/* ═══════════════════════════════════════════════════════════════════\n   v2.5.4', 'HYROX_BUILD_2026');
const halfPlan = runIIFE('(function v25R7VedantaHmBuild()', '</script>', 'VEDANTA_HM_BUILD_2026');

const plans = [
  convertCalendar(trainingData),
  convertFixedPlan(hyroxPlan, {
    id: 'hyrox-current', version: 1, title: 'Hyrox Delhi 13-week build',
    summary: 'Fixed-date combined Runna and coach Hyrox build.', modality: 'hyrox',
    datePolicy: 'fixed', fixedStartDate: '2026-04-27T00:00:00Z', sourceID: 'personalized-html',
  }),
  convertFixedPlan(halfPlan, {
    id: 'half-marathon-current', version: 1, title: 'Vedanta Delhi half-marathon build',
    summary: 'Fixed-date half-marathon build following Hyrox Delhi.', modality: 'run',
    datePolicy: 'fixed', fixedStartDate: '2026-07-27T00:00:00Z', sourceID: 'personalized-html',
  }),
];

process.stdout.write(JSON.stringify(plans));

