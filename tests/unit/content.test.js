// Mock MutationObserver
global.MutationObserver = class {
  constructor(callback) {
    this.callback = callback;
  }
  disconnect() {}
  observe(element, options) {}
};

global.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn(),
    },
    sendMessage: jest.fn(),
    lastError: null,
  },
  storage: {
    sync: {
      get: jest.fn((keys, callback) => callback({ enabled: true })),
      set: jest.fn((data, callback) => callback && callback()),
    },
    onChanged: {
      addListener: jest.fn(),
    },
  },
};

// Define showSolvePrompt BEFORE requiring content.js
global.showSolvePrompt = jest.fn((el, cb) => cb());

const content = require('../../content.js');
const {
  ImageCaptchaDetector,
  RecaptchaV2Detector,
  showSpinner,
  getAutoSolvePreference,
} = content;

// Helper to override the storage.sync.get mock for a single test. The
// default mock at the top of the file returns { enabled: true } regardless
// of the keys requested, which is not enough for auto-solve tests — they
// need to control the autoSolve value too.
function mockStorageGet(storeData) {
  chrome.storage.sync.get.mockImplementation((keys, callback) => {
    callback(storeData);
  });
}

// Flush any pending microtasks (resolved promises) several times. Needed
// because handleRecaptcha kicks off a fire-and-forget runSolve() chain
// that we can't directly await. A few trips through the microtask queue
// is enough to let those chained then/finally handlers run. jsdom does
// not expose setImmediate, so we use Promise.resolve() instead.
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe('ImageCaptchaDetector', () => {
  let detector;

  beforeEach(() => {
    document.body.innerHTML = '';
    detector = new ImageCaptchaDetector();
  });

  test('isCaptchaInput returns true for captcha input fields', () => {
    const input = document.createElement('input');
    input.id = 'captcha_code';
    expect(detector.isCaptchaInput(input)).toBe(true);
  });

  test('isValidCaptchaImage returns false for very small images', () => {
    const img = document.createElement('img');
    img.src = 'captcha.png';
    img.width = 10;
    img.height = 10;
    // Add keywords to make it potentially valid by score
    img.alt = 'captcha';
    // Add input field nearby to increase score
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'captcha_input';
    document.body.appendChild(img);
    document.body.appendChild(input);
    
    expect(detector.isValidCaptchaImage(img)).toBe(false);
  });
});

describe('RecaptchaV2Detector', () => {
  let detector;

  beforeEach(() => {
    document.body.innerHTML = '';
    detector = new RecaptchaV2Detector();
    detector.isEnabled = true;
    jest.clearAllMocks();
  });

  test('processExistingRecaptchas finds g-recaptcha elements', () => {
    // Mock window.location to not be anchor frame
    delete window.location;
    window.location = new URL('https://example.com');

    const widget = document.createElement('div');
    widget.className = 'g-recaptcha';
    widget.setAttribute('data-sitekey', '6LeOeSkUAAAAAAs_FByOFeC0kiY94_N9HOA95_3S');
    document.body.appendChild(widget);

    const handleSpy = jest.spyOn(detector, 'handleRecaptcha');
    detector.processExistingRecaptchas();
    
    expect(handleSpy).toHaveBeenCalledWith(widget, '6LeOeSkUAAAAAAs_FByOFeC0kiY94_N9HOA95_3S');
  });

  test('processExistingRecaptchas does nothing in a sub-frame', () => {
    // Mock window.location to not be anchor frame
    delete window.location;
    window.location = new URL('https://example.com');

    const widget = document.createElement('div');
    widget.className = 'g-recaptcha';
    widget.setAttribute('data-sitekey', '6LeOeSkUAAAAAAs_FByOFeC0kiY94_N9HOA95_3S');
    document.body.appendChild(widget);

    // Simulate running inside a sub-frame: window !== window.top
    const originalTop = window.top;
    Object.defineProperty(window, 'top', { value: {}, configurable: true });

    const handleSpy = jest.spyOn(detector, 'handleRecaptcha');
    detector.processExistingRecaptchas();

    expect(handleSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, 'top', { value: originalTop, configurable: true });
  });
});

describe('showSpinner', () => {
  let element;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    element = document.createElement('div');
    // Spinner positions itself via getBoundingClientRect, so stub it.
    element.getBoundingClientRect = () => ({
      top: 50, left: 100, width: 100, height: 50, bottom: 100, right: 200,
    });
    document.body.appendChild(element);
  });

  test('appends a spinner overlay to the document body', () => {
    const spinner = showSpinner(element);
    const overlays = document.querySelectorAll('.uncaptcha-spinner');

    expect(overlays.length).toBe(1);
    // Overlay should contain the "Solving CAPTCHA…" label.
    expect(overlays[0].textContent).toContain('Solving CAPTCHA');

    spinner.remove();
  });

  test('injects the keyframes stylesheet exactly once across calls', () => {
    const a = showSpinner(element);
    const b = showSpinner(element);

    const styles = document.querySelectorAll('#uncaptcha-spinner-style');
    expect(styles.length).toBe(1);

    a.remove();
    b.remove();
  });

  test('remove() detaches the spinner from the DOM', () => {
    const spinner = showSpinner(element);
    expect(document.querySelectorAll('.uncaptcha-spinner').length).toBe(1);

    spinner.remove();
    expect(document.querySelectorAll('.uncaptcha-spinner').length).toBe(0);
  });

  test('returns an object with a remove method', () => {
    const spinner = showSpinner(element);
    expect(typeof spinner.remove).toBe('function');
    spinner.remove();
  });
});

describe('getAutoSolvePreference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns false by default when autoSolve is absent', async () => {
    mockStorageGet({});
    const result = await getAutoSolvePreference();
    expect(result).toBe(false);
  });

  test('returns false when autoSolve is explicitly false', async () => {
    mockStorageGet({ autoSolve: false });
    const result = await getAutoSolvePreference();
    expect(result).toBe(false);
  });

  test('returns true when autoSolve is explicitly true', async () => {
    mockStorageGet({ autoSolve: true });
    const result = await getAutoSolvePreference();
    expect(result).toBe(true);
  });

  test('coerces non-boolean truthy values to false (strict === true check)', async () => {
    // Guards against accidentally treating stray string/number values as "on".
    mockStorageGet({ autoSolve: 'yes' });
    const result = await getAutoSolvePreference();
    expect(result).toBe(false);
  });

  test('resolves to false if chrome.storage.sync.get throws', async () => {
    chrome.storage.sync.get.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const result = await getAutoSolvePreference();
    expect(result).toBe(false);
  });
});

describe('RecaptchaV2Detector auto-solve behavior', () => {
  let detector;
  let element;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    // showStatus appends a shadow-host div directly to documentElement, so
    // body/head resets alone don't catch it. Strip any non-head/body
    // children of documentElement to start each test from a clean slate.
    Array.from(document.documentElement.children).forEach((child) => {
      if (child !== document.head && child !== document.body) child.remove();
    });
    jest.clearAllMocks();

    detector = new RecaptchaV2Detector();
    detector.isEnabled = true;

    element = document.createElement('div');
    element.className = 'g-recaptcha';
    element.setAttribute('data-sitekey', 'test-sitekey');
    element.getBoundingClientRect = () => ({
      top: 0, left: 0, width: 100, height: 100, bottom: 100, right: 100,
    });
    document.body.appendChild(element);

    // Prevent applySolution from touching the real DOM / chrome.runtime.
    jest.spyOn(detector, 'applySolution').mockImplementation(() => {});
    // Short-circuit the 2captcha call so the handler completes synchronously-ish.
    jest.spyOn(detector, 'solveCaptcha').mockResolvedValue({ solution: 'TOKEN' });

    // Reset the showSolvePrompt spy between tests.
    global.showSolvePrompt = jest.fn((el, cb) => cb());
  });

  test('skips showSolvePrompt when auto-solve is on', async () => {
    mockStorageGet({ autoSolve: true });

    await detector.handleRecaptcha(element, 'test-sitekey');
    // Let the fire-and-forget runSolve() chain resolve.
    await flushMicrotasks();

    expect(global.showSolvePrompt).not.toHaveBeenCalled();
    expect(detector.solveCaptcha).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'userrecaptcha', googlekey: 'test-sitekey' }),
    );
    expect(detector.applySolution).toHaveBeenCalledWith(element, 'TOKEN');
  });

  test('shows the solve prompt when auto-solve is off', async () => {
    mockStorageGet({ autoSolve: false });

    await detector.handleRecaptcha(element, 'test-sitekey');
    await flushMicrotasks();

    expect(global.showSolvePrompt).toHaveBeenCalledTimes(1);
    // The default mock immediately runs the callback, so the solver still fires.
    expect(detector.solveCaptcha).toHaveBeenCalled();
  });

  test('defaults to prompt (off) when autoSolve key is missing', async () => {
    mockStorageGet({});

    await detector.handleRecaptcha(element, 'test-sitekey');
    await flushMicrotasks();

    expect(global.showSolvePrompt).toHaveBeenCalledTimes(1);
  });

  // Helper: status box is moved into a closed shadow root once solving
  // finishes, so document.querySelector can't see it. We check the spinner
  // is still on the page during solving (before the swap), and verify the
  // shadow host count for the post-swap state.
  function shadowHostCount() {
    return document.documentElement.querySelectorAll(
      ':scope > div[style*="2147483647"]',
    ).length;
  }

  test('runSolve shows spinner, then a green checkmark on success', async () => {
    mockStorageGet({ autoSolve: true });

    let spinnerDuringSolve = 0;
    detector.solveCaptcha.mockImplementation(async () => {
      spinnerDuringSolve = document.querySelectorAll('.uncaptcha-spinner').length;
      return { solution: 'TOKEN' };
    });

    jest.useFakeTimers();
    try {
      await detector.handleRecaptcha(element, 'test-sitekey');
      await flushMicrotasks();

      expect(spinnerDuringSolve).toBe(1);
      // After solving, the container is moved into a shadow-root host.
      expect(shadowHostCount()).toBe(1);

      jest.advanceTimersByTime(2500);
      expect(shadowHostCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('spinner shows a red X and is removed when the solver throws', async () => {
    mockStorageGet({ autoSolve: true });
    detector.solveCaptcha.mockRejectedValue(new Error('2captcha down'));

    jest.useFakeTimers();
    try {
      await detector.handleRecaptcha(element, 'test-sitekey');
      await flushMicrotasks();

      expect(shadowHostCount()).toBe(1);

      jest.advanceTimersByTime(2500);
      expect(shadowHostCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
