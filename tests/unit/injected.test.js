
function runInjected({ solution = '', callback = '' } = {}) {
  const scriptEl = document.createElement('script');
  if (solution) scriptEl.dataset.solution = solution;
  if (callback) scriptEl.dataset.callback = callback;

  Object.defineProperty(document, 'currentScript', {
    configurable: true,
    get: () => scriptEl,
  });
  try {
    jest.isolateModules(() => {
      require('../../src/injected.js');
    });
  } finally {
    Object.defineProperty(document, 'currentScript', {
      configurable: true,
      get: () => null,
    });
  }
}

describe('injected.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.___grecaptcha_cfg;
  });

  test('early-returns when document.currentScript is null', () => {
    Object.defineProperty(document, 'currentScript', {
      configurable: true,
      get: () => null,
    });
    expect(() => {
      jest.isolateModules(() => {
        require('../../src/injected.js');
      });
    }).not.toThrow();
  });

  test('early-returns when no solution is present', () => {
    const ta = document.createElement('textarea');
    ta.id = 'g-recaptcha-response';
    ta.value = 'ORIGINAL';
    document.body.appendChild(ta);

    runInjected({});
    expect(ta.value).toBe('ORIGINAL');
  });

  test('fills all g-recaptcha-response textareas with the solution', () => {
    const ta1 = document.createElement('textarea');
    ta1.id = 'g-recaptcha-response';
    const ta2 = document.createElement('textarea');
    ta2.id = 'g-recaptcha-response-1';
    const taByName = document.createElement('textarea');
    taByName.name = 'g-recaptcha-response-2';
    document.body.append(ta1, ta2, taByName);

    runInjected({ solution: 'TOKEN_XYZ' });

    expect(ta1.value).toBe('TOKEN_XYZ');
    expect(ta2.value).toBe('TOKEN_XYZ');
    expect(taByName.value).toBe('TOKEN_XYZ');
  });

  test('input and change events fire on each textarea', () => {
    const ta = document.createElement('textarea');
    ta.id = 'g-recaptcha-response';
    document.body.appendChild(ta);

    const onInput = jest.fn();
    const onChange = jest.fn();
    ta.addEventListener('input', onInput);
    ta.addEventListener('change', onChange);

    runInjected({ solution: 'TOKEN' });

    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('invokes an explicit data-callback attribute on window', () => {
    window.myApp = { onSuccess: jest.fn() };

    runInjected({ solution: 'TOKEN', callback: 'myApp.onSuccess' });

    expect(window.myApp.onSuccess).toHaveBeenCalledWith('TOKEN');
    delete window.myApp;
  });

  test('missing explicit callback is handled gracefully', () => {
    expect(() => {
      runInjected({ solution: 'TOKEN', callback: 'does.not.exist' });
    }).not.toThrow();
  });

  test('walks ___grecaptcha_cfg.clients and invokes nested callbacks', () => {
    const siteCallback = jest.fn();
    window.___grecaptcha_cfg = {
      clients: {
        0: {
          nested: {
            deeper: {
              callback: siteCallback,
            },
          },
        },
      },
    };

    runInjected({ solution: 'TOKEN_ABC' });

    expect(siteCallback).toHaveBeenCalledWith('TOKEN_ABC');
  });

  test('swallows exceptions thrown by site callbacks', () => {
    window.___grecaptcha_cfg = {
      clients: {
        0: {
          callback: () => { throw new Error('site bug'); },
        },
      },
    };

    expect(() => runInjected({ solution: 'TOKEN' })).not.toThrow();
  });
});
