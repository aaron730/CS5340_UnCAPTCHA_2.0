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

global.showSolvePrompt = jest.fn((el, cb) => cb());

const content = require('../../src/content.js');
const {
  ImageCaptchaDetector,
  RecaptchaV2Detector,
  showSpinner,
  getAutoSolvePreference,
  showSolvePrompt: realShowSolvePrompt,
  isElementVisible,
  countCaptchasOnPage,
  _resetActivePrompt,
} = content;


function mockStorageGet(storeData) {
  chrome.storage.sync.get.mockImplementation((keys, callback) => {
    callback(storeData);
  });
}


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
    img.alt = 'captcha';
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
    delete window.location;
    window.location = new URL('https://example.com');

    const widget = document.createElement('div');
    widget.className = 'g-recaptcha';
    widget.setAttribute('data-sitekey', '6LeOeSkUAAAAAAs_FByOFeC0kiY94_N9HOA95_3S');
    document.body.appendChild(widget);

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
    element.getBoundingClientRect = () => ({
      top: 50, left: 100, width: 100, height: 50, bottom: 100, right: 200,
    });
    document.body.appendChild(element);
  });

  test('appends a spinner overlay to the document body', () => {
    const spinner = showSpinner(element);
    const overlays = document.querySelectorAll('.uncaptcha-spinner');

    expect(overlays.length).toBe(1);
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

    jest.spyOn(detector, 'applySolution').mockImplementation(() => {});
    jest.spyOn(detector, 'solveCaptcha').mockResolvedValue({ solution: 'TOKEN' });

    global.showSolvePrompt = jest.fn((el, cb) => cb());
  });

  test('skips showSolvePrompt when auto-solve is on', async () => {
    mockStorageGet({ autoSolve: true });

    await detector.handleRecaptcha(element, 'test-sitekey');
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
    expect(detector.solveCaptcha).toHaveBeenCalled();
  });

  test('defaults to prompt (off) when autoSolve key is missing', async () => {
    mockStorageGet({});

    await detector.handleRecaptcha(element, 'test-sitekey');
    await flushMicrotasks();

    expect(global.showSolvePrompt).toHaveBeenCalledTimes(1);
  });

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

describe('isElementVisible', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('returns false for null/missing element', () => {
    expect(isElementVisible(null)).toBe(false);
    expect(isElementVisible({})).toBe(false);
  });

  test('returns false for zero-size element', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(false);
  });

  test('returns false when display:none', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 });
    el.style.display = 'none';
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(false);
  });

  test('returns false when visibility:hidden', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 });
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(false);
  });

  test('returns true for visible non-zero element', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 });
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(true);
  });
});

describe('showSolvePrompt', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    _resetActivePrompt();
  });

  function makeAnchor() {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ top: 50, left: 100, width: 100, height: 50, bottom: 100, right: 200 });
    document.body.appendChild(el);
    return el;
  }

  test('creates a prompt with Solve and Skip buttons', () => {
    const anchor = makeAnchor();
    realShowSolvePrompt(anchor, () => {});

    const prompts = document.querySelectorAll('.uncaptcha-prompt');
    expect(prompts.length).toBe(1);
    const buttons = prompts[0].querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Solve');
    expect(buttons[1].textContent).toBe('Skip');
  });

  test('clicking Solve removes prompt and invokes callback', () => {
    const anchor = makeAnchor();
    const onSolve = jest.fn();
    realShowSolvePrompt(anchor, onSolve);
    const solveBtn = document.querySelector('.uncaptcha-prompt button');
    solveBtn.click();

    expect(onSolve).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.uncaptcha-prompt').length).toBe(0);
  });

  test('clicking Skip removes the prompt without invoking callback', () => {
    const anchor = makeAnchor();
    const onSolve = jest.fn();
    realShowSolvePrompt(anchor, onSolve);
    const skipBtn = document.querySelectorAll('.uncaptcha-prompt button')[1];
    skipBtn.click();

    expect(onSolve).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.uncaptcha-prompt').length).toBe(0);
  });

  test('only one active prompt at a time', () => {
    const anchor = makeAnchor();
    realShowSolvePrompt(anchor, () => {});
    realShowSolvePrompt(anchor, () => {});
    expect(document.querySelectorAll('.uncaptcha-prompt').length).toBe(1);
  });

  test('after Skip, a new prompt can be created', () => {
    const anchor = makeAnchor();
    realShowSolvePrompt(anchor, () => {});
    document.querySelectorAll('.uncaptcha-prompt button')[1].click();
    realShowSolvePrompt(anchor, () => {});
    expect(document.querySelectorAll('.uncaptcha-prompt').length).toBe(1);
  });
});

describe('countCaptchasOnPage', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('counts visible recaptcha widgets', () => {
    const w = document.createElement('div');
    w.className = 'g-recaptcha';
    w.setAttribute('data-sitekey', 'abc');
    w.getBoundingClientRect = () => ({ width: 200, height: 80, top: 0, left: 0, right: 200, bottom: 80 });
    document.body.appendChild(w);
    expect(countCaptchasOnPage(null)).toBe(1);
  });

  test('does not count widgets without data-sitekey', () => {
    const w = document.createElement('div');
    w.className = 'g-recaptcha';
    w.getBoundingClientRect = () => ({ width: 200, height: 80, top: 0, left: 0, right: 200, bottom: 80 });
    document.body.appendChild(w);
    expect(countCaptchasOnPage(null)).toBe(0);
  });

  test('counts image captchas via detector', () => {
    const detector = new ImageCaptchaDetector();
    const img = document.createElement('img');
    img.src = 'https://example.com/captcha.png';
    Object.defineProperty(img, 'naturalWidth', { value: 200 });
    Object.defineProperty(img, 'naturalHeight', { value: 60 });
    img.getBoundingClientRect = () => ({ width: 200, height: 60, top: 0, left: 0, right: 200, bottom: 60 });
    const input = document.createElement('input');
    input.name = 'captcha_code';
    const form = document.createElement('form');
    form.appendChild(img);
    form.appendChild(input);
    document.body.appendChild(form);

    expect(countCaptchasOnPage(detector)).toBe(1);
  });
});

describe('ImageCaptchaDetector scoring and validation', () => {
  let detector;
  beforeEach(() => {
    document.body.innerHTML = '';
    detector = new ImageCaptchaDetector();
  });

  test('getImageCaptchaScore: src with captcha gives strong signal', () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/captcha-image.png';
    Object.defineProperty(img, 'naturalWidth', { value: 200 });
    Object.defineProperty(img, 'naturalHeight', { value: 60 });
    document.body.appendChild(img);
    const score = detector.getImageCaptchaScore(img);
    expect(score).toBeGreaterThanOrEqual(3);
  });

  test('getImageCaptchaScore: ancestor with captcha class adds points', () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'captcha-wrapper';
    const img = document.createElement('img');
    img.src = 'https://example.com/foo.png';
    Object.defineProperty(img, 'naturalWidth', { value: 200 });
    Object.defineProperty(img, 'naturalHeight', { value: 60 });
    wrapper.appendChild(img);
    document.body.appendChild(wrapper);
    expect(detector.getImageCaptchaScore(img)).toBeGreaterThanOrEqual(2);
  });

  test('getImageCaptchaScore: form with captcha-named input adds points', () => {
    const form = document.createElement('form');
    const img = document.createElement('img');
    img.src = 'https://example.com/foo.png';
    Object.defineProperty(img, 'naturalWidth', { value: 200 });
    Object.defineProperty(img, 'naturalHeight', { value: 60 });
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'captcha';
    form.appendChild(img);
    form.appendChild(input);
    document.body.appendChild(form);
    expect(detector.getImageCaptchaScore(img)).toBeGreaterThanOrEqual(2);
  });

  test('isValidCaptchaImage: rejects SVG sources', () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/captcha.svg';
    Object.defineProperty(img, 'naturalWidth', { value: 200 });
    Object.defineProperty(img, 'naturalHeight', { value: 60 });
    expect(detector.isValidCaptchaImage(img)).toBe(false);
  });

  test('isValidCaptchaImage: rejects icon/logo/sample disqualifiers', () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/captcha.png';
    img.className = 'reload-icon';
    Object.defineProperty(img, 'naturalWidth', { value: 200 });
    Object.defineProperty(img, 'naturalHeight', { value: 60 });
    expect(detector.isValidCaptchaImage(img)).toBe(false);
  });

  test('isValidCaptchaImage: rejects images outside size bounds', () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/captcha.png';
    Object.defineProperty(img, 'naturalWidth', { value: 10 });
    Object.defineProperty(img, 'naturalHeight', { value: 10 });
    expect(detector.isValidCaptchaImage(img)).toBe(false);
  });

  test('isValidCaptchaImage: rejects square-ish images without strong src', () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'captcha-box';
    const img = document.createElement('img');
    img.src = 'https://example.com/foo.png';
    Object.defineProperty(img, 'naturalWidth', { value: 100 });
    Object.defineProperty(img, 'naturalHeight', { value: 100 });
    wrapper.appendChild(img);
    document.body.appendChild(wrapper);
    expect(detector.isValidCaptchaImage(img)).toBe(false);
  });

  test('isValidCaptchaImage: accepts a real-looking captcha image', () => {
    const form = document.createElement('form');
    const img = document.createElement('img');
    img.src = 'https://example.com/captcha-endpoint.php?get=image';
    Object.defineProperty(img, 'naturalWidth', { value: 250 });
    Object.defineProperty(img, 'naturalHeight', { value: 50 });
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'captchaCode';
    form.appendChild(img);
    form.appendChild(input);
    document.body.appendChild(form);
    expect(detector.isValidCaptchaImage(img)).toBe(true);
  });
});

describe('ImageCaptchaDetector helpers', () => {
  let detector;
  beforeEach(() => {
    document.body.innerHTML = '';
    detector = new ImageCaptchaDetector();
  });

  test('findCaptchaInput: returns captcha-named input within a form', () => {
    const form = document.createElement('form');
    const img = document.createElement('img');
    const captchaInput = document.createElement('input');
    captchaInput.type = 'text';
    captchaInput.name = 'captcha_code';
    const otherInput = document.createElement('input');
    otherInput.type = 'text';
    otherInput.name = 'username';
    form.appendChild(img);
    form.appendChild(otherInput);
    form.appendChild(captchaInput);
    document.body.appendChild(form);
    expect(detector.findCaptchaInput(img)).toBe(captchaInput);
  });

  test('findCaptchaInput: falls back to single input in form', () => {
    const form = document.createElement('form');
    const img = document.createElement('img');
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'username';
    form.appendChild(img);
    form.appendChild(input);
    document.body.appendChild(form);
    expect(detector.findCaptchaInput(img)).toBe(input);
  });

  test('findCaptchaInput: returns null when no plausible input exists', () => {
    const form = document.createElement('form');
    const img = document.createElement('img');
    const a = document.createElement('input');
    a.type = 'text';
    a.name = 'a';
    const b = document.createElement('input');
    b.type = 'text';
    b.name = 'b';
    form.appendChild(img);
    form.appendChild(a);
    form.appendChild(b);
    document.body.appendChild(form);
    expect(detector.findCaptchaInput(img)).toBe(null);
  });

  test('fillCaptchaInput: sets value and dispatches events', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const events = [];
    ['input', 'change', 'keyup', 'blur'].forEach(t => {
      input.addEventListener(t, () => events.push(t));
    });
    detector.fillCaptchaInput(input, 'ANSWER');
    expect(input.value).toBe('ANSWER');
    expect(events).toEqual(expect.arrayContaining(['input', 'change', 'keyup', 'blur']));
  });

  test('isCaptchaInput: detects captcha-named fields by various attributes', () => {
    const byId = document.createElement('input');
    byId.id = 'captcha';
    expect(detector.isCaptchaInput(byId)).toBe(true);

    const byName = document.createElement('input');
    byName.name = 'verify_code';
    expect(detector.isCaptchaInput(byName)).toBe(true);

    const byPlaceholder = document.createElement('input');
    byPlaceholder.placeholder = 'Enter the challenge';
    expect(detector.isCaptchaInput(byPlaceholder)).toBe(true);

    const unrelated = document.createElement('input');
    unrelated.name = 'username';
    expect(detector.isCaptchaInput(unrelated)).toBe(false);
  });

  test('getIframeCaptchaScore: scores google recaptcha iframes', () => {
    const frame = document.createElement('iframe');
    frame.src = 'https://www.google.com/recaptcha/api2/anchor?...';
    expect(detector.getIframeCaptchaScore(frame)).toBeGreaterThanOrEqual(3);
  });

  test('getIframeCaptchaScore: returns 0 for unrelated iframes', () => {
    const frame = document.createElement('iframe');
    frame.src = 'https://example.com/embed';
    expect(detector.getIframeCaptchaScore(frame)).toBe(0);
  });

  test('getConfidenceLabel: maps scores to labels', () => {
    expect(detector.getConfidenceLabel(5)).toBe('High');
    expect(detector.getConfidenceLabel(3)).toBe('Medium');
    expect(detector.getConfidenceLabel(1)).toBe('Low');
    expect(detector.getConfidenceLabel(0)).toBe('None');
  });

  test('imageToBase64: returns null when canvas throws', async () => {
    const img = document.createElement('img');
    Object.defineProperty(img, 'naturalWidth', { value: 50 });
    Object.defineProperty(img, 'naturalHeight', { value: 50 });
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => { throw new Error('nope'); };
    try {
      const result = await detector.imageToBase64(img);
      expect(result).toBe(null);
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });

  test('waitForImageLoad: resolves immediately when img.complete is true', async () => {
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { value: true });
    await expect(detector.waitForImageLoad(img)).resolves.toBeUndefined();
  });

  test('waitForImageLoad: resolves on load event', async () => {
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { value: false, configurable: true });
    const p = detector.waitForImageLoad(img);
    img.onload();
    await expect(p).resolves.toBeUndefined();
  });
});

describe('RecaptchaV2Detector.applySolution', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    global.chrome.runtime.getURL = jest.fn((path) => `chrome-extension://abc/${path}`);
  });

  test('injects a script with callback and solution datasets', () => {
    const detector = new RecaptchaV2Detector();
    const widget = document.createElement('div');
    widget.setAttribute('data-callback', 'myCallback');
    document.body.appendChild(widget);

    detector.applySolution(widget, 'TOKEN_VALUE');

    const scripts = document.querySelectorAll('script');
    expect(scripts.length).toBe(1);
    expect(scripts[0].dataset.callback).toBe('myCallback');
    expect(scripts[0].dataset.solution).toBe('TOKEN_VALUE');
  });

  test('uses empty callback when widget has no data-callback', () => {
    const detector = new RecaptchaV2Detector();
    const widget = document.createElement('div');
    document.body.appendChild(widget);

    detector.applySolution(widget, 'TOKEN');
    const script = document.querySelector('script');
    expect(script.dataset.callback).toBe('');
  });
});

describe('Detector lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  test('ImageCaptchaDetector.checkExtensionState starts detection when enabled', () => {
    chrome.storage.sync.get.mockImplementation((keys, cb) => cb({ enabled: true }));
    const detector = new ImageCaptchaDetector();
    const spy = jest.spyOn(detector, 'startDetection').mockImplementation(() => {});
    detector.checkExtensionState();
    expect(spy).toHaveBeenCalled();
  });

  test('ImageCaptchaDetector.checkExtensionState defaults to enabled when key missing', () => {
    chrome.storage.sync.get.mockImplementation((keys, cb) => cb({}));
    const detector = new ImageCaptchaDetector();
    const spy = jest.spyOn(detector, 'startDetection').mockImplementation(() => {});
    detector.checkExtensionState();
    expect(spy).toHaveBeenCalled();
  });

  test('ImageCaptchaDetector.checkExtensionState skips startDetection when disabled', () => {
    chrome.storage.sync.get.mockImplementation((keys, cb) => cb({ enabled: false }));
    const detector = new ImageCaptchaDetector();
    const spy = jest.spyOn(detector, 'startDetection').mockImplementation(() => {});
    detector.checkExtensionState();
    expect(spy).not.toHaveBeenCalled();
  });

  test('ImageCaptchaDetector.handleToggleChange routes to start/stop', () => {
    const detector = new ImageCaptchaDetector();
    const startSpy = jest.spyOn(detector, 'startDetection').mockImplementation(() => {});
    const stopSpy = jest.spyOn(detector, 'stopDetection').mockImplementation(() => {});
    detector.handleToggleChange(true);
    expect(startSpy).toHaveBeenCalled();
    detector.handleToggleChange(false);
    expect(stopSpy).toHaveBeenCalled();
  });

  test('ImageCaptchaDetector.stopDetection disconnects observer and clears cache', () => {
    const detector = new ImageCaptchaDetector();
    detector.observer = { disconnect: jest.fn() };
    detector.processedImages.add('foo');
    detector.stopDetection();
    expect(detector.observer).toBe(null);
    expect(detector.processedImages.size).toBe(0);
  });

  test('RecaptchaV2Detector.handleToggleChange routes to start/stop', () => {
    const detector = new RecaptchaV2Detector();
    const startSpy = jest.spyOn(detector, 'startDetection').mockImplementation(() => {});
    const stopSpy = jest.spyOn(detector, 'stopDetection').mockImplementation(() => {});
    detector.handleToggleChange(true);
    expect(startSpy).toHaveBeenCalled();
    detector.handleToggleChange(false);
    expect(stopSpy).toHaveBeenCalled();
  });
});

describe('content.js scanCaptcha message handler', () => {
  // The module-level addListener was registered when content.js was first
  // required at the top of this file. Pull the listener off the mock.
  const listener = chrome.runtime.onMessage.addListener.mock.calls
    .map(call => call[0])
    .find(fn => fn.length >= 3);

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('returns detected=false when no captchas are present', () => {
    const sendResponse = jest.fn();
    listener({ action: 'scanCaptcha' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      detected: false,
      total: 0,
      confidence: 'None',
    }));
  });

  test('reports recaptcha widgets', () => {
    const w = document.createElement('div');
    w.className = 'g-recaptcha';
    w.setAttribute('data-sitekey', 'abc');
    document.body.appendChild(w);

    const sendResponse = jest.fn();
    listener({ action: 'scanCaptcha' }, {}, sendResponse);
    const arg = sendResponse.mock.calls[0][0];
    expect(arg.detected).toBe(true);
    expect(arg.iframeCaptchas).toBeGreaterThanOrEqual(1);
  });

  test('toggleStateChanged forwards to both detectors', () => {
    // Just ensure the listener doesn't throw with a toggle event.
    expect(() => listener({ action: 'toggleStateChanged', isEnabled: false }, {}, jest.fn())).not.toThrow();
    expect(() => listener({ action: 'toggleStateChanged', isEnabled: true }, {}, jest.fn())).not.toThrow();
  });
});

describe('solveCaptcha message bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chrome.runtime.lastError = null;
  });

  test('resolves with the response when the background returns a solution', async () => {
    const detector = new ImageCaptchaDetector();
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => cb({ solution: 'ABC' }));
    const res = await detector.solveCaptcha({ method: 'base64', body: 'x' });
    expect(res).toEqual({ solution: 'ABC' });
  });

  test('rejects when the background returns an error', async () => {
    const detector = new ImageCaptchaDetector();
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => cb({ error: 'boom' }));
    await expect(detector.solveCaptcha({ method: 'base64', body: 'x' })).rejects.toThrow('boom');
  });

  test('rejects on chrome.runtime.lastError', async () => {
    const detector = new ImageCaptchaDetector();
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      chrome.runtime.lastError = { message: 'disconnected' };
      cb(undefined);
    });
    await expect(detector.solveCaptcha({ method: 'base64', body: 'x' })).rejects.toThrow('disconnected');
  });
});
