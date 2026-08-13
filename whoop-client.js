(function () {
  'use strict';

  const node = id => document.getElementById(id);
  const metricIDs = ['recovery', 'strain', 'sleep', 'rhr', 'hrv', 'resp', 'weight'];
  let working = false;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfter = payload.retryAfter;
      throw error;
    }
    return payload;
  }

  function setStatus(text, state = 'idle') {
    const status = node('whoop-status');
    if (!status) return;
    status.textContent = text;
    status.dataset.state = state;
  }

  function setWorking(value) {
    working = value;
    document.querySelectorAll('[data-whoop-action]').forEach(button => { button.disabled = value; });
  }

  function value(id, content, unit = '', source = 'Official WHOOP API') {
    const target = node(`whoop-${id}`);
    if (!target) return;
    const available = content !== null && content !== undefined && content !== '';
    target.dataset.available = String(available);
    target.innerHTML = available
      ? `${escapeHTML(String(content))}${unit ? `<span class="whoop-metric-unit">${escapeHTML(unit)}</span>` : ''}`
      : 'Unavailable';
    const sourceNode = node(`whoop-${id}-source`);
    if (sourceNode) sourceNode.textContent = available ? source : 'WHOOP has not scored this input yet';
  }

  function escapeHTML(text) {
    return text.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }

  function hours(milliseconds) {
    if (milliseconds == null) return null;
    return (Number(milliseconds) / 3_600_000).toFixed(1);
  }

  function localTime(date) {
    if (!date) return 'not synced yet';
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? 'not synced yet' : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function resetMetrics() {
    metricIDs.forEach(id => value(id, null));
    const workout = node('whoop-latest-workout');
    if (workout) workout.innerHTML = '<strong>No WHOOP workout imported</strong>Connect and sync to load workout summaries.';
  }

  function render(data) {
    const connect = node('whoop-connect');
    const sync = node('whoop-sync');
    const disconnect = node('whoop-disconnect');
    if (!data.connected) {
      setStatus('Not connected', 'idle');
      connect.hidden = false;
      sync.hidden = true;
      disconnect.hidden = true;
      resetMetrics();
      return;
    }
    const name = [data.user?.firstName, data.user?.lastName].filter(Boolean).join(' ');
    setStatus(name ? `Connected · ${name}` : 'Connected', data.lastError ? 'error' : 'connected');
    connect.hidden = true;
    sync.hidden = false;
    disconnect.hidden = false;
    const recovery = data.latest?.recovery;
    const cycle = data.latest?.cycle;
    const sleep = data.latest?.sleep;
    const body = data.latest?.body;
    value('recovery', recovery?.recoveryScore, '%');
    value('strain', cycle?.strain == null ? null : Number(cycle.strain).toFixed(1), '/ 21');
    value('sleep', sleep?.performancePercentage, '%');
    value('rhr', recovery?.restingHeartRate, 'bpm');
    value('hrv', recovery?.hrvRMSSDMilliseconds == null ? null : Number(recovery.hrvRMSSDMilliseconds).toFixed(0), 'ms');
    value('resp', sleep?.respiratoryRate == null ? null : Number(sleep.respiratoryRate).toFixed(1), 'rpm');
    value('weight', body?.weightKilograms == null ? null : Number(body.weightKilograms).toFixed(1), 'kg');
    const workout = data.recentWorkouts?.[0];
    const workoutNode = node('whoop-latest-workout');
    if (workoutNode) {
      workoutNode.innerHTML = workout
        ? `<strong>${escapeHTML(workout.title || 'WHOOP workout')}</strong>${escapeHTML(localTime(workout.startedAt))} · ${workout.whoop?.strain == null ? 'strain unavailable' : `strain ${Number(workout.whoop.strain).toFixed(1)}`} · ${workout.movingSeconds == null ? 'duration unavailable' : `${Math.round(workout.movingSeconds / 60)} min`}`
        : '<strong>No recent WHOOP workout</strong>Workout summaries appear after WHOOP processes them.';
    }
    const syncLabel = node('whoop-last-sync');
    if (syncLabel) syncLabel.textContent = `Last reconciled ${localTime(data.lastSyncedAt)}${data.lastError ? ` · ${data.lastError}` : ''}`;
    const sleepSource = node('whoop-sleep-source');
    if (sleepSource && sleep?.totalSleepMilliseconds != null) sleepSource.textContent = `${hours(sleep.totalSleepMilliseconds)} h asleep · Official WHOOP API`;
  }

  async function refresh() {
    try {
      const data = await api('/api/whoop/status');
      render(data);
      return data;
    } catch (error) {
      setStatus(error.status === 401 ? 'Private session expired' : 'WHOOP status unavailable', 'error');
      throw error;
    }
  }

  async function sync(days = 30) {
    if (working) return;
    setWorking(true);
    setStatus('Syncing WHOOP…', 'working');
    try {
      const result = await api('/api/whoop/sync', { method: 'POST', body: JSON.stringify({ days }) });
      await refresh();
      if (typeof AppState !== 'undefined' && AppState.loadRemote) await AppState.loadRemote();
      if (typeof showToast === 'function') showToast(`WHOOP synced · ${result.counts.workouts} workouts`, 'success');
    } catch (error) {
      const retry = error.retryAfter ? ` Retry in ${error.retryAfter}s.` : '';
      setStatus(`Sync failed.${retry}`, 'error');
    } finally { setWorking(false); }
  }

  async function disconnect() {
    if (working || !confirm('Disconnect WHOOP? Imported encrypted summaries will remain in your private history.')) return;
    setWorking(true);
    try {
      await api('/api/whoop/disconnect', { method: 'POST', body: '{}' });
      await refresh();
    } catch (error) { setStatus(error.message, 'error'); }
    finally { setWorking(false); }
  }

  function install() {
    node('whoop-connect')?.addEventListener('click', () => { location.assign('/api/whoop/connect'); });
    node('whoop-sync')?.addEventListener('click', () => sync(30));
    node('whoop-disconnect')?.addEventListener('click', disconnect);
    const parameters = new URLSearchParams(location.search);
    if (parameters.get('whoop') === 'connected') {
      history.replaceState({}, '', `${location.pathname}${location.hash || ''}`);
      sync(30);
    } else refresh().catch(() => resetMetrics());
  }

  window.KashWhoop = { refresh, sync, disconnect };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
