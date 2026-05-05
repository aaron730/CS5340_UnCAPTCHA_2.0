
let messageListener;
let storageChangedListener;
let storageGetImpl;
let storageSetImpl;

global.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn((fn) => { messageListener = fn; }),
    },
  },
  storage: {
    sync: {
      get: jest.fn((keys) => storageGetImpl(keys)),
      set: jest.fn((data, cb) => {
        if (storageSetImpl) storageSetImpl(data);
        if (cb) cb();
        return Promise.resolve();
      }),
    },
    onChanged: {
      addListener: jest.fn((fn) => { storageChangedListener = fn; }),
    },
  },
};

storageGetImpl = () => Promise.resolve({});

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

require('../../src/background.js');

describe('background.js message listener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('toggleExtension updates enabled flag and responds success', () => {
    const sendResponse = jest.fn();
    const ret = messageListener(
      { action: 'toggleExtension', enabled: false },
      {},
      sendResponse,
    );
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(ret).toBe(false);
  });

  test('solveCaptcha short-circuits with error when extension is disabled', async () => {
    // Disable via toggleExtension first.
    messageListener({ action: 'toggleExtension', enabled: false }, {}, jest.fn());

    const sendResponse = jest.fn();
    const ret = messageListener(
      { action: 'solveCaptcha', captchaData: { method: 'userrecaptcha' } },
      {},
      sendResponse,
    );
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(sendResponse).toHaveBeenCalledWith({ error: 'Extension is disabled' });
    expect(ret).toBe(true);
  });

  test('solveCaptcha returns true (async) when enabled, even without API key', async () => {
    messageListener({ action: 'toggleExtension', enabled: true }, {}, jest.fn());

    const sendResponse = jest.fn();
    const ret = messageListener(
      { action: 'solveCaptcha', captchaData: { method: 'userrecaptcha' } },
      {},
      sendResponse,
    );
    expect(ret).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/API key/i) }),
    );
  });

  test('updateApiKey persists the key via chrome.storage and responds success', () => {
    const sendResponse = jest.fn();
    const ret = messageListener(
      { action: 'updateApiKey', apiKey: 'new-key-123' },
      {},
      sendResponse,
    );
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ apiKey: 'new-key-123' });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(ret).toBe(false);
  });

  test('unknown action returns undefined (no response)', () => {
    const sendResponse = jest.fn();
    const ret = messageListener({ action: 'nope' }, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
    expect(ret).toBeUndefined();
  });
});

describe('background.js storage.onChanged listener', () => {
  test('reacts to apiKey and enabled changes without throwing', () => {
    expect(() => {
      storageChangedListener(
        { apiKey: { newValue: 'abc' }, enabled: { newValue: false } },
        'sync',
      );
    }).not.toThrow();
  });

  test('ignores unrelated changes', () => {
    expect(() => {
      storageChangedListener({ somethingElse: { newValue: 1 } }, 'sync');
    }).not.toThrow();
  });
});

describe('background.js CaptchaSolver.solveCaptcha via message listener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    messageListener({ action: 'toggleExtension', enabled: true }, {}, jest.fn());
    messageListener({ action: 'updateApiKey', apiKey: 'live-key' }, {}, jest.fn());
  });

  test('end-to-end happy path: submit then poll returns the solution', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        json: async () => ({ status: 1, request: 'CAPTCHA_ID_42' }),
      })
      .mockResolvedValueOnce({
        text: async () => JSON.stringify({ status: 1, request: 'TOKEN_VALUE' }),
      });

    const sendResponse = jest.fn();
    messageListener(
      { action: 'solveCaptcha', captchaData: { method: 'userrecaptcha', googlekey: 'abc' } },
      {},
      sendResponse,
    );

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith({ solution: 'TOKEN_VALUE' });
  });

  test('submit failure path propagates the 2captcha error_text', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      json: async () => ({ status: 0, error_text: 'ERROR_WRONG_USER_KEY' }),
    });

    const sendResponse = jest.fn();
    messageListener(
      { action: 'solveCaptcha', captchaData: { method: 'userrecaptcha' } },
      {},
      sendResponse,
    );

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'ERROR_WRONG_USER_KEY' }),
    );
  });
});
