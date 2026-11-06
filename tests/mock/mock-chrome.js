// Mock delle API chrome.* per i test (persistenza su localStorage, stesso origin)
(function () {
  const KEY = '__mockStore';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const persist = s => localStorage.setItem(KEY, JSON.stringify(s));
  const listeners = [];
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const fire = changes => { for (const fn of listeners) fn(changes, 'local'); };
  const ev = name => ({ addListener(fn) { (window.__listeners[name] = window.__listeners[name] || []).push(fn); } });
  window.__calls = [];
  window.__listeners = {};
  const rec = (name, ret) => (...a) => { window.__calls.push([name, ...clone(a)]); return Promise.resolve(typeof ret === 'function' ? ret(...a) : ret); };
  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const s = load();
          if (keys == null) return clone(s);
          if (typeof keys === 'string') keys = [keys];
          const out = {};
          if (Array.isArray(keys)) { for (const k of keys) if (k in s) out[k] = clone(s[k]); }
          else { for (const [k, d] of Object.entries(keys)) out[k] = k in s ? clone(s[k]) : d; }
          return out;
        },
        async set(obj) {
          const s = load(); const changes = {};
          for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: s[k], newValue: clone(v) }; s[k] = clone(v); }
          persist(s); fire(changes);
        },
        async remove(keys) {
          const s = load(); const changes = {};
          for (const k of [].concat(keys)) if (k in s) { changes[k] = { oldValue: s[k] }; delete s[k]; }
          persist(s); fire(changes);
        }
      },
      sync: { async get() { return clone(JSON.parse(localStorage.getItem('__mockSync') || '{}')); } },
      onChanged: { addListener(fn) { listeners.push(fn); } }
    },
    runtime: {
      id: 'test-ext',
      getManifest: () => {
        // versione "caricata": quella del manifest sul disco, salvo override del test
        let m = {};
        try { const x = new XMLHttpRequest(); x.open('GET', '/ext/manifest.json', false); x.send(); m = JSON.parse(x.responseText); } catch (e) { m = { version: '0' }; }
        const v = localStorage.getItem('__mockLoadedVersion');
        return v ? { ...m, version: v } : m;
      },
      getURL: p => '/ext/' + p,
      reload: rec('runtime.reload'),
      openOptionsPage: rec('openOptionsPage'),
      sendMessage: rec('sendMessage', () => window.__sendMessageReply),
      onMessage: ev('runtime.onMessage'),
      onInstalled: ev('runtime.onInstalled'),
      onConnect: ev('runtime.onConnect'),
      onStartup: ev('runtime.onStartup')
    },
    tabs: {
      async query(q) {
        window.__calls.push(['tabs.query', clone(q)]);
        if (q && q.url) return clone(JSON.parse(localStorage.getItem('__mockArgoTabs') || '[]'));
        return [JSON.parse(localStorage.getItem('__mockTab') || '{"id":1,"url":"https://example.com/"}')];
      },
      create: rec('tabs.create'),
      update: rec('tabs.update'),
      reload: rec('tabs.reload'),
      get: rec('tabs.get', id => ({ id })),
      sendMessage: rec('tabs.sendMessage', () => window.__tabsSendMessageReply),
      connect(tabId, info) {
        window.__calls.push(['tabs.connect', tabId, clone(info)]);
        if (window.__makePort) return window.__makePort(tabId, info);
        const dead = { onMessage: { addListener() {}, removeListener() {} }, onDisconnect: { addListener(fn) { setTimeout(fn, 10); } }, postMessage() {} };
        return dead;
      },
      onUpdated: ev('tabs.onUpdated'),
      onReplaced: ev('tabs.onReplaced')
    },
    windows: { update: rec('windows.update') },
    alarms: { get: rec('alarms.get', () => undefined), create: rec('alarms.create'), onAlarm: ev('alarms.onAlarm') },
    action: {
      setPopup: rec('action.setPopup'), setBadgeText: rec('action.setBadgeText'),
      setBadgeBackgroundColor: rec('action.setBadgeBackgroundColor'), setTitle: rec('action.setTitle'),
      openPopup: rec('action.openPopup'), onClicked: ev('action.onClicked')
    },
    scripting: { executeScript: rec('executeScript', () => window.__executeScriptReply || JSON.parse(localStorage.getItem('__mockExecReply') || '[]')) }
  };
  window.close = () => window.__calls.push(['window.close']);
  if (localStorage.getItem('__fastTimers')) {
    const orig = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...a) => orig(fn, (ms || 0) / 100, ...a);
    const realNow = Date.now.bind(Date), t0 = realNow();
    Date.now = () => t0 + (realNow() - t0) * 100;
  }
})();
