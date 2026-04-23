// content.js - CAPTCHA detection and solving

function showSolvePrompt(element, onSolve) {
  const prompt = document.createElement('div');
  prompt.className = 'uncaptcha-prompt';
  prompt.style.cssText = `
    position: absolute;
    z-index: 1000000;
    background: white;
    border: 1px solid #6ea4d7;
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-family: Arial, sans-serif;
    font-size: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 200px;
  `;

  const text = document.createElement('div');
  text.textContent = 'Solve this CAPTCHA?';
  text.style.fontWeight = 'bold';
  prompt.appendChild(text);

  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '8px';

  const solveBtn = document.createElement('button');
  solveBtn.textContent = 'Solve';
  solveBtn.style.cssText = `
    background: #6ea4d7;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    flex: 1;
  `;
  solveBtn.onclick = () => {
    prompt.remove();
    onSolve();
  };
  buttonContainer.appendChild(solveBtn);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Skip';
  closeBtn.style.cssText = `
    background: #f1f1f1;
    color: #333;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    flex: 1;
  `;
  closeBtn.onclick = () => prompt.remove();
  buttonContainer.appendChild(closeBtn);

  prompt.appendChild(buttonContainer);

  // Add to DOM first (required for offset calculations)
  document.body.appendChild(prompt);

  // Position near element (after appending so offsetHeight is available)
  const rect = element.getBoundingClientRect();
  prompt.style.top = (window.scrollY + rect.top - prompt.offsetHeight - 10) + 'px';
  prompt.style.left = (window.scrollX + rect.left) + 'px';

  // Re-position if it was off-screen
  const finalRect = prompt.getBoundingClientRect();
  if (finalRect.top < 0) {
    prompt.style.top = (window.scrollY + rect.bottom + 10) + 'px';
  }
}

// Small loading indicator anchored near the captcha element. Returns
// { remove } so callers can tear it down after the solver resolves.
// Used to show progress while 2captcha works (typically 10-30s).
function showSpinner(element) {
  // Inject the keyframes stylesheet once per page.
  if (!document.getElementById('uncaptcha-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'uncaptcha-spinner-style';
    style.textContent = `
      @keyframes uncaptcha-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const container = document.createElement('div');
  container.className = 'uncaptcha-spinner';
  container.style.cssText = `
    position: absolute;
    z-index: 1000000;
    background: white;
    border: 1px solid #6ea4d7;
    border-radius: 8px;
    padding: 10px 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-family: Arial, sans-serif;
    font-size: 13px;
    color: #333;
    display: flex;
    align-items: center;
    gap: 10px;
  `;

  const spinEl = document.createElement('div');
  spinEl.style.cssText = `
    width: 18px;
    height: 18px;
    border: 3px solid #e1ecf7;
    border-top-color: #6ea4d7;
    border-radius: 50%;
    animation: uncaptcha-spin 0.8s linear infinite;
    flex-shrink: 0;
  `;
  container.appendChild(spinEl);

  const label = document.createElement('div');
  label.style.cssText = 'display: flex; flex-direction: column;';
  const title = document.createElement('div');
  title.textContent = 'Solving CAPTCHA…';
  title.style.fontWeight = 'bold';
  label.appendChild(title);
  const elapsed = document.createElement('div');
  elapsed.style.cssText = 'font-size: 11px; color: #666;';
  elapsed.textContent = '0s';
  label.appendChild(elapsed);
  container.appendChild(label);

  document.body.appendChild(container);

  const rect = element.getBoundingClientRect();
  container.style.top = (window.scrollY + rect.top - container.offsetHeight - 10) + 'px';
  container.style.left = (window.scrollX + rect.left) + 'px';
  const finalRect = container.getBoundingClientRect();
  if (finalRect.top < 0) {
    container.style.top = (window.scrollY + rect.bottom + 10) + 'px';
  }

  const startedAt = Date.now();
  const tick = setInterval(() => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    elapsed.textContent = secs + 's';
  }, 500);

  // Replace the animated spinner with a static status icon (check or X)
  // and briefly leave the container on screen so the user sees the result.
  // Some pages re-render the captcha area or react to clicks by clearing
  // overlays in their form, which would take our container with it. To
  // survive that, we move the status node into a Shadow DOM hosted on
  // documentElement: the page's scripts can't reach across the shadow
  // boundary, and documentElement is not normally re-rendered.
  function showStatus(kind) {
    clearInterval(tick);
    const isSuccess = kind === 'success';

    // Snapshot the on-screen position before we move the node anywhere.
    const rect = container.getBoundingClientRect();

    const icon = document.createElement('div');
    icon.style.cssText = `
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: ${isSuccess ? '#28a745' : '#dc3545'};
      color: white;
      font-size: 13px;
      font-weight: bold;
      line-height: 18px;
      text-align: center;
      flex-shrink: 0;
    `;
    icon.textContent = isSuccess ? '\u2713' : '\u2715';
    if (spinEl.parentNode === container) {
      container.replaceChild(icon, spinEl);
    } else {
      container.insertBefore(icon, container.firstChild);
    }
    title.textContent = isSuccess ? 'CAPTCHA solved' : 'CAPTCHA failed';
    const totalSecs = Math.floor((Date.now() - startedAt) / 1000);
    elapsed.textContent = totalSecs + 's';

    container.style.position = 'fixed';
    container.style.top = Math.max(8, rect.top) + 'px';
    container.style.left = Math.max(8, rect.left) + 'px';

    // Host node attached to documentElement; attachShadow may not exist in
    // older test environments, so fall back to a plain re-parent.
    const host = document.createElement('div');
    host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
    (document.documentElement || document.body).appendChild(host);
    if (typeof host.attachShadow === 'function') {
      const shadow = host.attachShadow({ mode: 'closed' });
      shadow.appendChild(container);
    } else {
      host.appendChild(container);
    }

    setTimeout(() => host.remove(), 2500);
  }

  return {
    remove() {
      clearInterval(tick);
      container.remove();
    },
    success() {
      showStatus('success');
    },
    fail() {
      showStatus('fail');
    },
  };
}

// Read the auto-solve preference from storage. Defaults to false so a
// fresh install always asks before spending 2captcha credits.
function getAutoSolvePreference() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(['autoSolve'], (result) => {
        resolve(result.autoSolve === true);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

class ImageCaptchaDetector {
  constructor() {
    this.processedImages = new Set();
    this.isEnabled = true; // default, updated from storage
    this.observer = null;
    console.log("UnCAPTCHA: Image detector initialized");
  }

  checkExtensionState() {
    chrome.storage.sync.get(['enabled'], (result) => {
      this.isEnabled = result.enabled ?? true;
      if (this.isEnabled) {
        this.startDetection();
      }
    });
  }

  handleToggleChange(isEnabled) {
    this.isEnabled = isEnabled;
    if (isEnabled) {
      this.startDetection();
    } else {
      this.stopDetection();
    }
  }

  startDetection() {
    // Only run in the top frame. The content script is injected into every
    // frame (all_frames: true), so without this guard a captcha image inside
    // a same-origin iframe would spawn a second "Solve this CAPTCHA?" prompt
    // from within that iframe.
    if (window !== window.top) {
      console.log('UnCAPTCHA: Image detector skipped (sub-frame)');
      return;
    }
    console.log('UnCAPTCHA: Image detector started');
    this.watchForImageCaptcha();
    this.processExistingCaptchas();
    this.findAndProcessIframeCaptchas(document.body);

    setTimeout(() => {
      if (this.isEnabled) {
        this.findAndProcessIframeCaptchas(document.body);
      }
    }, 2000);
  }

  stopDetection() {
    console.log('UnCAPTCHA: Image detector stopped');
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.processedImages.clear();
  }

  findAndProcessCaptchaImages(container) {
    if (!this.isEnabled) return;

    const images = [];
    if (container.matches && container.matches("img")) {
      images.push(container);
    }
    if (container.querySelectorAll) {
      images.push(...container.querySelectorAll("img"));
    }

    images.forEach((img) => {
      if (!this.processedImages.has(img.src) && this.isValidCaptchaImage(img)) {
        this.processedImages.add(img.src);
        this.handleImageCaptcha(img);
      }
    });
  }

  findAndProcessIframeCaptchas(container) {
    if (!this.isEnabled) return;

    const iframes = [];
    if (container.matches && container.matches("iframe")) {
      iframes.push(container);
    }
    if (container.querySelectorAll) {
      iframes.push(...container.querySelectorAll("iframe"));
    }

    iframes.forEach((frame) => {
      const src = (frame.src || "").toLowerCase();
      const score = this.getIframeCaptchaScore(frame);

      if (score >= 3) {
        console.log("UnCAPTCHA: Iframe CAPTCHA detected", src);
      }
    });
  }

  getImageCaptchaScore(img) {
    let score = 0;
    const src = (img.src || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    const id = (img.id || '').toLowerCase();
    const className = (img.className || '').toLowerCase();

    const captchaKeywords = [
      'captcha', 'verify', 'verification', 'code', 'security',
      'challenge', 'puzzle', 'auth', 'validation', 'robot'
    ];

    const hasKeyword = captchaKeywords.some(keyword =>
      src.includes(keyword) ||
      alt.includes(keyword) ||
      id.includes(keyword) ||
      className.includes(keyword)
    );
    if (hasKeyword) score += 2;

    const hasNearbyInput = this.findCaptchaInput(img) !== null;
    if (hasNearbyInput) score += 2;

    const hasReasonableSize =
      img.width >= 50 && img.height >= 20 &&
      img.width <= 500 && img.height <= 200;

    if (hasReasonableSize) score += 1;
    return score;
  }

  isValidCaptchaImage(img) {
    const score = this.getImageCaptchaScore(img);
    const hasReasonableSize =
      img.width >= 30 && img.height >= 30 &&
      img.width <= 1000 && img.height <= 1000;
    return score >= 4 && hasReasonableSize;
  }

  getIframeCaptchaScore(frame) {
    let score = 0;
    const src = (frame.src || "").toLowerCase();
    const title = (frame.title || "").toLowerCase();
    const combined = src + title;

    if (src.includes("recaptcha") || src.includes("google.com/recaptcha") || src.includes("hcaptcha")) {
      score += 3;
    }
    if (combined.includes("challenge")) {
      score += 1;
    }
    return score;
  }

  getConfidenceLabel(score) {
    if (score >= 4) return "High";
    if (score >= 3) return "Medium";
    if (score >= 1) return "Low";
    return "None";
  }

  processExistingCaptchas() {
    if (!this.isEnabled) return;
    this.findAndProcessCaptchaImages(document.body);
    this.findAndProcessIframeCaptchas(document.body);
  }

  watchForImageCaptcha() {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      if (!this.isEnabled) return;
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.findAndProcessCaptchaImages(node);
            this.findAndProcessIframeCaptchas(node);
          }
        });
      });
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  async handleImageCaptcha(imgElement) {
    if (!this.isEnabled) return;
    try {
      await this.waitForImageLoad(imgElement);

      // Ensure image is large enough to be a CAPTCHA and accepted by 2captcha
      const width = imgElement.naturalWidth || imgElement.width;
      const height = imgElement.naturalHeight || imgElement.height;

      if (width < 30 || height < 30) {
        console.log('UnCAPTCHA: Image too small after loading (' + width + 'x' + height + '), skipping');
        return;
      }

      const runSolve = async () => {
        const spinner = (globalThis.showSpinner || showSpinner)(imgElement);
        let succeeded = false;
        try {
          const base64 = await this.imageToBase64(imgElement);
          if (!base64) return;

          console.log('UnCAPTCHA: Submitting image captcha to 2captcha');
          const response = await this.solveCaptcha({ method: 'base64', body: base64 });
          if (response.solution) {
            const inputField = this.findCaptchaInput(imgElement);
            if (inputField) {
              this.fillCaptchaInput(inputField, response.solution);
            }
            succeeded = true;
          }
        } catch (error) {
          console.error('UnCAPTCHA: Failed to solve image captcha:', error);
        } finally {
          if (succeeded && spinner.success) spinner.success();
          else if (spinner.fail) spinner.fail();
          else spinner.remove();
        }
      };

      const autoSolve = await getAutoSolvePreference();
      if (autoSolve) {
        console.log('UnCAPTCHA: Auto-solve enabled, skipping prompt');
        runSolve();
      } else {
        (globalThis.showSolvePrompt || showSolvePrompt)(imgElement, runSolve);
      }
    } catch (error) {
      console.error('UnCAPTCHA: Failed to solve image captcha:', error);
    }
  }

  waitForImageLoad(img) {
    return new Promise((resolve, reject) => {
      if (img.complete) resolve();
      else {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image failed to load'));
        setTimeout(() => reject(new Error('Image load timeout')), 10000);
      }
    });
  }

  async imageToBase64(imgElement) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = imgElement.naturalWidth || imgElement.width;
      canvas.height = imgElement.naturalHeight || imgElement.height;
      ctx.drawImage(imgElement, 0, 0);
      const dataURL = canvas.toDataURL('image/png');
      return dataURL.split(',')[1];
    } catch (error) {
      return null;
    }
  }

  findCaptchaInput(imgElement) {
    const form = imgElement.closest('form');
    if (form) {
      const inputs = form.querySelectorAll('input[type="text"], input[type="password"], input:not([type])');
      for (const input of inputs) {
        if (this.isCaptchaInput(input)) return input;
      }
      if (inputs.length > 0) return inputs[0];
    }

    let parent = imgElement.parentElement;
    while (parent && parent !== document.body) {
      const inputs = parent.querySelectorAll('input[type="text"], input[type="password"], input:not([type])');
      for (const input of inputs) {
        if (this.isCaptchaInput(input)) return input;
      }
      parent = parent.parentElement;
    }

    const allInputs = document.querySelectorAll('input[type="text"], input[type="password"], input:not([type])');
    let closestInput = null;
    let closestDistance = Infinity;
    const imgRect = imgElement.getBoundingClientRect();
    for (const input of allInputs) {
      const inputRect = input.getBoundingClientRect();
      const distance = Math.sqrt(Math.pow(imgRect.left - inputRect.left, 2) + Math.pow(imgRect.top - inputRect.top, 2));
      if (distance < closestDistance && distance < 300) {
        closestDistance = distance;
        closestInput = input;
      }
    }
    return closestInput;
  }

  isCaptchaInput(input) {
    const text = (input.id + input.name + input.placeholder + input.className).toLowerCase();
    return ['captcha', 'verify', 'code', 'challenge'].some(k => text.includes(k));
  }

  fillCaptchaInput(inputField, solution) {
    inputField.value = solution;
    ['input', 'change', 'keyup', 'blur'].forEach(type =>
      inputField.dispatchEvent(new Event(type, { bubbles: true }))
    );
    inputField.focus();
    setTimeout(() => inputField.blur(), 100);
  }

  async solveCaptcha(captchaData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'solveCaptcha', captchaData }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (response && response.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }
}

class RecaptchaV2Detector {
  constructor() {
    this.processedWidgets = new Set();
    this.isEnabled = true;
    this.observer = null;
    console.log("UnCAPTCHA: reCAPTCHA v2 detector initialized");
  }

  checkExtensionState() {
    chrome.storage.sync.get(['enabled'], (result) => {
      this.isEnabled = result.enabled ?? true;
      if (this.isEnabled) {
        this.startDetection();
      }
    });
  }

  handleToggleChange(isEnabled) {
    this.isEnabled = isEnabled;
    if (isEnabled) {
      this.startDetection();
    } else {
      this.stopDetection();
    }
  }

  startDetection() {
    console.log('UnCAPTCHA: reCAPTCHA v2 detector started');
    this.watchForRecaptcha();
    this.processExistingRecaptchas();
  }

  stopDetection() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.processedWidgets.clear();
  }

  watchForRecaptcha() {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      if (!this.isEnabled) return;
      this.processExistingRecaptchas();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  processExistingRecaptchas() {
    if (!this.isEnabled) return;

    // Only prompt from the top frame. reCAPTCHA injects same-origin sub-frames
    // (e.g. the anchor/checkbox frame) where the content script also runs; if
    // we prompt there too, the user sees a second, clipped popup inside the
    // tiny iframe. The top-frame widget path below is sufficient to solve.
    if (window !== window.top) return;

    const widgets = document.querySelectorAll('.g-recaptcha, [data-sitekey]');
    widgets.forEach(widget => {
      const sitekey = widget.getAttribute('data-sitekey');
      if (sitekey && !this.processedWidgets.has(widget)) {
        this.handleRecaptcha(widget, sitekey);
      }
    });
  }

  async handleRecaptcha(element, sitekey) {
    this.processedWidgets.add(element);
    console.log('UnCAPTCHA: reCAPTCHA v2 detected, sitekey:', sitekey);

    const runSolve = async () => {
      const spinner = (globalThis.showSpinner || showSpinner)(element);
      let succeeded = false;
      try {
        console.log('UnCAPTCHA: Requesting reCAPTCHA v2 solution from 2captcha');
        const captchaData = { method: 'userrecaptcha', googlekey: sitekey, pageurl: window.location.href };
        const response = await this.solveCaptcha(captchaData);
        if (response.solution) {
          this.applySolution(element, response.solution);
          succeeded = true;
        }
      } catch (error) {
        console.error('UnCAPTCHA: Failed to solve reCAPTCHA v2:', error);
      } finally {
        if (succeeded && spinner.success) spinner.success();
        else if (spinner.fail) spinner.fail();
        else spinner.remove();
      }
    };

    const autoSolve = await getAutoSolvePreference();
    if (autoSolve) {
      console.log('UnCAPTCHA: Auto-solve enabled, skipping prompt');
      runSolve();
    } else {
      (globalThis.showSolvePrompt || showSolvePrompt)(element, runSolve);
    }
  }

  applySolution(element, solution) {
    // The real work happens in injected.js, which runs in the page's main
    // world: it fills every g-recaptcha-response textarea, invokes the
    // widget's data-callback if present, and walks Google's internal
    // ___grecaptcha_cfg.clients registry to trigger callbacks wired via
    // grecaptcha.render({ callback: fn }) (which leave no DOM attribute).
    //
    // We can't do any of that from the content script's isolated world.
    // Page CSP typically blocks literal inline <script>, but whitelists
    // chrome-extension:// URLs, so we load injected.js as an external
    // script and pass the solution + optional callback name via data-*.
    console.log('UnCAPTCHA: Applying reCAPTCHA v2 solution');
    const callback = element.getAttribute('data-callback') || element.getAttribute('callback') || '';
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.dataset.callback = callback;
    script.dataset.solution = solution;
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  async solveCaptcha(captchaData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'solveCaptcha', captchaData }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (response && response.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }
}

const imageCaptchaDetector = new ImageCaptchaDetector();
const recaptchaV2Detector = new RecaptchaV2Detector();

// Initialize both
imageCaptchaDetector.checkExtensionState();
recaptchaV2Detector.checkExtensionState();

// Combined Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleStateChanged') {
    imageCaptchaDetector.handleToggleChange(request.isEnabled);
    recaptchaV2Detector.handleToggleChange(request.isEnabled);
  } else if (request.action === "scanCaptcha") {
    const iframes = document.querySelectorAll("iframe");
    const images = document.querySelectorAll("img");

    let iframeCount = 0;
    let imageCount = 0;
    let highestScore = 0;

    iframes.forEach((frame) => {
      const score = imageCaptchaDetector.getIframeCaptchaScore(frame);
      if (score >= 3) {
        iframeCount++;
        highestScore = Math.max(highestScore, score);
      }
    });

    images.forEach((img) => {
      const score = imageCaptchaDetector.getImageCaptchaScore(img);
      if (score >= 4) {
        imageCount++;
        highestScore = Math.max(highestScore, score);
      }
    });

    const recaptchaWidgets = document.querySelectorAll('.g-recaptcha, [data-sitekey]');
    if (recaptchaWidgets.length > 0) {
      if (iframeCount === 0) iframeCount = recaptchaWidgets.length;
      highestScore = Math.max(highestScore, 3);
    }

    const detected = iframeCount > 0 || imageCount > 0;
    sendResponse({
      detected,
      iframeCaptchas: iframeCount,
      imageCaptchas: imageCount,
      total: iframeCount + imageCount,
      detectionScore: highestScore,
      confidence: detected ? imageCaptchaDetector.getConfidenceLabel(highestScore) : "None"
    });
    return false; // Sync response
  }
  return true; // Keep open for other potential async messages
});

if (typeof module !== 'undefined') {
  module.exports = {
    ImageCaptchaDetector,
    RecaptchaV2Detector,
    showSolvePrompt,
    showSpinner,
    getAutoSolvePreference,
  };
}
