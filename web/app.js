// Console shell: navigation, hash router (#/page), connection status and theme.
(function () {
  'use strict';
  const DL = window.DL;
  const { h, icon } = DL;

  const ROUTES = [
    { id: 'overview', group: 'Explore', label: 'Overview', icon: 'overview', key: '1' },
    { id: 'routing', group: 'Explore', label: 'Routing lab', icon: 'route', key: '2' },
    { id: 'simulation', group: 'Explore', label: 'Simulation', icon: 'simulation', key: '3' },
    { id: 'policies', group: 'Evaluate', label: 'Policies', icon: 'policies', key: '4' },
  ];

  const viewEl = document.getElementById('view');
  const appEl = document.getElementById('app');
  let current = null;  // { id, cleanup }

  function buildNav() {
    const nav = document.getElementById('nav');
    const groups = {};
    for (const r of ROUTES) (groups[r.group] = groups[r.group] || []).push(r);
    for (const [name, items] of Object.entries(groups)) {
      nav.appendChild(h('div.nav-group', h('div.nav-label', name),
        items.map(r => h('a.nav-item', { href: `#/${r.id}`, 'data-route': r.id }, icon(r.icon), r.label, h('span.kbd', r.key)))));
    }
    const menu = document.getElementById('menu-btn');
    menu.appendChild(icon('menu'));
    menu.addEventListener('click', () => appEl.classList.toggle('nav-open'));
    document.getElementById('scrim').addEventListener('click', () => appEl.classList.remove('nav-open'));
  }

  function buildTheme() {
    const host = document.getElementById('theme');
    host.appendChild(DL.segmented([
      { value: 'system', icon: 'monitor', title: 'System theme' },
      { value: 'light', icon: 'sun', title: 'Light theme' },
      { value: 'dark', icon: 'moon', title: 'Dark theme' },
    ], DL.theme.pref(), v => DL.theme.apply(v), { full: true, label: 'Theme' }));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (DL.theme.pref() === 'system') DL.theme.apply('system');
    });
  }

  function setConnection(state) {
    document.getElementById('conn-dot').className = 'dot ' + state;
    const title = document.getElementById('conn-title'), sub = document.getElementById('conn-sub');
    if (state === 'busy') {
      title.textContent = 'Connecting…';
      sub.textContent = 'Looking for the engine';
    } else if (state === 'live') {
      title.textContent = 'Engine live';
      sub.textContent = `${location.host} · this computer only`;
    } else {
      title.textContent = 'Engine not running';
      sub.textContent = 'Start it with ./run.sh';
    }
  }

  function route() {
    const id = (location.hash.replace(/^#\/?/, '') || 'overview').split('?')[0];
    const r = ROUTES.find(x => x.id === id) || ROUTES[0];
    if (current && current.id === r.id) return;
    if (current && current.cleanup) current.cleanup();
    document.querySelectorAll('.nav-item').forEach(a => {
      if (a.dataset.route === r.id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.getElementById('crumb').textContent = r.label;
    document.title = `${r.label} · DispatchLab`;
    appEl.classList.remove('nav-open');
    viewEl.replaceChildren();
    viewEl.className = 'view';
    const view = DL.views[r.id];
    current = { id: r.id, cleanup: null };
    try {
      current.cleanup = view.mount(viewEl) || null;
    } catch (e) {
      viewEl.appendChild(h('div.page', DL.errorCallout(e)));
    }
  }

  document.addEventListener('keydown', ev => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const r = ROUTES.find(x => x.key === ev.key);
    if (r) location.hash = `#/${r.id}`;
  });

  async function boot() {
    buildNav();
    buildTheme();
    setConnection('busy');
    setConnection((await DL.api.connect()) ? 'live' : 'offline');
    window.addEventListener('hashchange', route);
    route();
  }

  boot();
})();
