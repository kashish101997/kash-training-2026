(function () {
  'use strict';
  const root = () => document.getElementById('private-training-catalog');
  const escapeHTML = text => String(text || '').replace(/[&<>'"]/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function render(payload) {
    const target = root();
    if (!target) return;
    const active = new Set((payload.enrollments || []).filter(value => value.active).map(value => value.planID));
    const plans = payload.plans || [];
    if (!plans.length) {
      target.innerHTML = '<div class="private-catalog-empty"><strong>Private plan catalog not imported</strong><br>Run the local catalog builder and encrypted Neon import; purchased plan files stay off the public web bundle.</div>';
      return;
    }
    const warning = active.size > 1
      ? `<div class="private-catalog-warning">${active.size} plans are active. Their sessions stack; review combined weekly load before accepting schedule changes.</div>`
      : '';
    target.innerHTML = `${warning}<div class="private-catalog-grid">${plans.map(plan => {
      const enrolled = active.has(plan.id);
      return `<article class="private-plan-card" data-active="${enrolled}">
        <div><span class="private-plan-modality">${escapeHTML(Array.isArray(plan.modality) ? plan.modality.join(' · ') : plan.modality || 'multi-sport')}</span>
        <h3>${escapeHTML(plan.title || plan.id)}</h3>
        <p>${Number(plan.weekCount || 0)} weeks · ${Number(plan.sessionCount || 0)} sessions/modules</p></div>
        <button type="button" data-plan-id="${escapeHTML(plan.id)}" data-active="${enrolled}">${enrolled ? 'Active' : 'Enroll'}</button>
      </article>`;
    }).join('')}</div>`;
  }

  async function load() {
    const target = root();
    if (!target) return;
    try { render(await api('/api/training/catalog?summary=1')); }
    catch (error) { target.innerHTML = `<div class="private-catalog-empty">Private catalog unavailable · ${escapeHTML(error.message)}</div>`; }
  }

  async function toggle(button) {
    const planID = button.dataset.planId;
    const active = button.dataset.active !== 'true';
    button.disabled = true;
    try {
      await api('/api/training/enrollment', { method: 'POST', body: JSON.stringify({ planID, active }) });
      await load();
    } catch (error) {
      button.disabled = false;
      if (typeof showToast === 'function') showToast(error.message, 'warning');
    }
  }

  function install() {
    root()?.addEventListener('click', event => {
      const button = event.target.closest('button[data-plan-id]');
      if (button) toggle(button);
    });
    load();
  }
  window.KashTrainingCatalog = { load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
