
(function () {
  const current = document.currentScript;
  if (!current) return;

  const explicitCallback = current.dataset.callback || '';
  const solution = current.dataset.solution || '';
  if (!solution) return;


  const textareas = new Set();
  document.querySelectorAll('textarea[id^="g-recaptcha-response"], textarea[name^="g-recaptcha-response"]').forEach(t => textareas.add(t));
  textareas.forEach((t) => {
    t.innerHTML = solution;
    t.value = solution;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Helper: resolve a dotted path like "myapp.onSuccess" off window.
  function resolvePath(path) {
    if (!path) return null;
    const parts = path.split('.');
    let ref = window;
    for (const p of parts) {
      if (ref == null) return null;
      ref = ref[p];
    }
    return typeof ref === 'function' ? ref : null;
  }

  if (explicitCallback) {
    const fn = resolvePath(explicitCallback);
    if (fn) {
      try { fn(solution); } catch (e) { console.log('UnCAPTCHA: explicit callback threw', e); }
    } else {
      console.log('UnCAPTCHA: Callback ' + explicitCallback + ' not found in window');
    }
  }


  try {
    const cfg = window.___grecaptcha_cfg;
    if (cfg && cfg.clients) {
      Object.keys(cfg.clients).forEach((clientId) => {
        const client = cfg.clients[clientId];

        const seen = new Set();
        (function walk(obj, depth) {
          if (!obj || typeof obj !== 'object' || depth > 6 || seen.has(obj)) return;
          seen.add(obj);
          for (const key of Object.keys(obj)) {
            let value;
            try { value = obj[key]; } catch (e) { continue; }
            if (key === 'callback' && typeof value === 'function') {
              try { value(solution); } catch (e) { console.log('UnCAPTCHA: client callback threw', e); }
            } else if (value && typeof value === 'object') {
              walk(value, depth + 1);
            }
          }
        })(client, 0);
      });
    }
  } catch (e) {
    console.log('UnCAPTCHA: grecaptcha client walk failed', e);
  }
})();
