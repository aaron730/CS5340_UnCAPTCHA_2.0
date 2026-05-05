
function makePopupDom() {
  document.body.innerHTML = `
    <input type="checkbox" id="toggleButton" />
    <input type="checkbox" id="autoSolveToggle" />
    <input type="password" id="apiKeyInput" />
    <button id="saveApiKey"></button>
    <div id="apiKeySection"></div>
    <div id="changeKeyContainer" style="display:none"></div>
    <button id="changeKeyBtn"></button>
    <button id="hideApiKey" style="display:none"></button>
    <div id="status"></div>
    <div id="details"></div>
    <button id="scanButton"></button>
  `;
}

let storageGetCallback = (keys, cb) => cb({});
const chromeMock = {
  runtime: {
    sendMessage: jest.fn(),
    lastError: null,
  },
  storage: {
    sync: {
      get: jest.fn((keys, cb) => storageGetCallback(keys, cb)),
      set: jest.fn((data, cb) => cb && cb()),
    },
  },
  tabs: {
    query: jest.fn((_q, cb) => cb([{ id: 1 }])),
    sendMessage: jest.fn(),
  },
};

global.chrome = chromeMock;
jest.spyOn(console, 'log').mockImplementation(() => {});

// Load the popup script once. It registers a DOMContentLoaded listener
// which we dispatch per-test after rebuilding the DOM.
require('../../src/popup.js');

function loadPopup() {
  makePopupDom();
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('popup.js DOMContentLoaded wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storageGetCallback = (keys, cb) => cb({});
  });

  test('no stored API key → shows API key section', () => {
    loadPopup();
    const section = document.getElementById('apiKeySection');
    expect(section.style.display).toBe('block');
  });

  test('stored API key → hides section and populates the input', () => {
    storageGetCallback = (keys, cb) => cb({ apiKey: 'stored-key' });
    loadPopup();

    expect(document.getElementById('apiKeyInput').value).toBe('stored-key');
    expect(document.getElementById('apiKeySection').style.display).toBe('none');
  });

  test('autoSolve stored value is reflected in the toggle', () => {
    storageGetCallback = (keys, cb) => cb({ autoSolve: true });
    loadPopup();
    expect(document.getElementById('autoSolveToggle').checked).toBe(true);
  });

  test('toggling autoSolve persists via chrome.storage', () => {
    loadPopup();
    const toggle = document.getElementById('autoSolveToggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(
      { autoSolve: true },
      expect.any(Function),
    );
  });

  test('toggling the main switch sends toggleExtension and persists enabled', () => {
    loadPopup();
    const toggle = document.getElementById('toggleButton');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(
      { enabled: false },
      expect.any(Function),
    );
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'toggleExtension', enabled: false }),
    );
  });

  test('save API key click with empty value shows alert', () => {
    loadPopup();
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    document.getElementById('apiKeyInput').value = '';
    document.getElementById('saveApiKey').click();
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('save API key click with a value stores and broadcasts it', () => {
    loadPopup();
    document.getElementById('apiKeyInput').value = 'my-key';
    document.getElementById('saveApiKey').click();
    expect(chromeMock.storage.sync.set).toHaveBeenCalledWith(
      { apiKey: 'my-key' },
      expect.any(Function),
    );
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'updateApiKey',
      apiKey: 'my-key',
    });
  });

  test('changeKeyBtn click reveals the API key section', () => {
    storageGetCallback = (keys, cb) => cb({ apiKey: 'stored-key' });
    loadPopup();
    document.getElementById('changeKeyBtn').click();

    expect(document.getElementById('apiKeySection').style.display).toBe('block');
    expect(document.getElementById('hideApiKey').style.display).toBe('block');
  });

  test('hideApiKeyBtn click hides the API key section', () => {
    loadPopup();
    document.getElementById('hideApiKey').click();
    expect(document.getElementById('apiKeySection').style.display).toBe('none');
  });

  test('scan button click requests a scan from the active tab', () => {

    chromeMock.tabs.sendMessage.mockImplementation((_id, _msg, cb) =>
      cb({ detected: false }),
    );

    loadPopup();
    document.getElementById('scanButton').click();

    expect(chromeMock.tabs.query).toHaveBeenCalled();
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      { action: 'scanCaptcha' },
      expect.any(Function),
    );
    expect(document.getElementById('status').textContent).toContain('No CAPTCHA');
  });

  test('scan shows detection details when captchas are found', () => {
    chromeMock.tabs.sendMessage.mockImplementation((_id, _msg, cb) =>
      cb({
        detected: true,
        total: 2,
        iframeCaptchas: 1,
        imageCaptchas: 1,
        detectionScore: 5,
        confidence: 'High',
      }),
    );

    loadPopup();
    document.getElementById('scanButton').click();

    expect(document.getElementById('status').innerHTML).toContain('CAPTCHA detected');
    expect(document.getElementById('details').innerHTML).toContain('Total: 2');
    expect(document.getElementById('details').innerHTML).toContain('High');
  });

  test('scan handles chrome.runtime.lastError gracefully', () => {
    chromeMock.tabs.sendMessage.mockImplementation((_id, _msg, cb) => {
      chromeMock.runtime.lastError = { message: 'boom' };
      cb(undefined);
      chromeMock.runtime.lastError = null;
    });

    loadPopup();
    document.getElementById('scanButton').click();

    expect(document.getElementById('status').textContent).toBe('No response');
  });

  test('konami code unlocks the Change API Key button', () => {
    storageGetCallback = (keys, cb) => cb({ apiKey: 'stored-key' });
    loadPopup();

    const sequence = [
      'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
      'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
      'b', 'a',
    ];
    for (const key of sequence) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key }));
    }

    expect(document.getElementById('changeKeyContainer').style.display).toBe('block');
  });
});
