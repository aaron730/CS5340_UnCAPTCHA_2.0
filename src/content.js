// content.js - CAPTCHA detection and solving

function countCaptchasOnPage(detector) {
  let count = 0;
  // reCAPTCHA widgets
  const widgets = document.querySelectorAll('.g-recaptcha, [data-sitekey]');
  widgets.forEach(w => {
    if (w.getAttribute('data-sitekey') && isElementVisible(w)) count++;
  });
  // Image captchas (only count if detector available)
  if (detector && typeof detector.isValidCaptchaImage === 'function') {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      if (isElementVisible(img) && detector.isValidCaptchaImage(img)) count++;
    });
  }
  return count;
}

function isElementVisible(element) {
  if (!element || !element.getBoundingClientRect) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const style = (element.ownerDocument && element.ownerDocument.defaultView)
    ? element.ownerDocument.defaultView.getComputedStyle(element)
    : null;
  if (style && (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0)) return false;
  return true;
}

let activeSolvePrompt = null;

function showSolvePrompt(element, onSolve) {
  if (activeSolvePrompt && document.body.contains(activeSolvePrompt)) {
    return null;
  }
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
    if (activeSolvePrompt === prompt) activeSolvePrompt = null;
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
  closeBtn.onclick = () => {
    prompt.remove();
    if (activeSolvePrompt === prompt) activeSolvePrompt = null;
  };
  buttonContainer.appendChild(closeBtn);

  prompt.appendChild(buttonContainer);

  // Add to DOM first (required for offset calculations)
  document.body.appendChild(prompt);
  activeSolvePrompt = prompt;

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

  function showStatus(kind) {
    clearInterval(tick);
    const isSuccess = kind === 'success';

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

    
    const scored = [];
    images.forEach((img) => {
      if (!isElementVisible(img)) return;
      if (this.processedImages.has(img.src)) return;
      if (!this.isValidCaptchaImage(img)) return;
      scored.push({ img, score: this.getImageCaptchaScore(img) });
    });
    scored.sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      const best = scored[0].img;
      this.processedImages.add(best.src);
      this.handleImageCaptcha(best);
    }
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
    const imgText = `${alt} ${id} ${className}`;

    // Strong: explicit captcha words on the image itself
    const strongKeywords = ['captcha', 'challenge', 'puzzle'];
    const srcHasStrong = strongKeywords.some(k => src.includes(k));
    const attrHasStrong = strongKeywords.some(k => imgText.includes(k));
    if (srcHasStrong) score += 3;
    else if (attrHasStrong) score += 2;

    // Medium: captcha word on a wrapping container (form, ancestor div with captcha id/class)
    let ancestorHasCaptcha = false;
    let ancestor = img.parentElement;
    let depth = 0;
    while (ancestor && depth < 5) {
      const a = `${ancestor.id || ''} ${ancestor.className || ''}`.toLowerCase();
      if (strongKeywords.some(k => a.includes(k))) { ancestorHasCaptcha = true; break; }
      ancestor = ancestor.parentElement;
      depth++;
    }
    if (ancestorHasCaptcha) score += 2;

    // Medium: a captcha-named input lives in the same form (strict match only)
    const form = img.closest('form');
    if (form) {
      const inputs = form.querySelectorAll('input[type="text"], input[type="password"], input:not([type])');
      for (const input of inputs) {
        if (this.isCaptchaInput(input)) { score += 2; break; }
      }
    }

    // Small: reasonable captcha-image dimensions
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w >= 50 && w <= 500 && h >= 20 && h <= 200) score += 1;

    return score;
  }

  isValidCaptchaImage(img) {
    // Skip non-raster sources (SVG/data:url logos)
    const src = (img.src || '').toLowerCase();
    if (src.endsWith('.svg') || src.includes('.svg?')) return false;

    // Skip explicitly-non-captcha roles in the image's own attributes
    const attrs = `${img.id || ''} ${img.className || ''} ${img.alt || ''}`.toLowerCase();
    const disqualifiers = ['icon', 'logo', 'thumbnail', 'preview', 'sample', 'screenshot', 'reload', 'sound', 'audio'];
    if (disqualifiers.some(d => attrs.includes(d))) return false;

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w < 30 || h < 30 || w > 1000 || h > 1000) return false;

    // Square-ish images are usually logos/avatars, not captchas
    if (h > 0 && (w / h < 1.2)) {
      // allow only if there's overwhelming evidence (e.g. src contains "captcha")
      if (!src.includes('captcha') && !src.includes('challenge')) return false;
    }

    // Require at least one strong signal, not just "near an input"
    const score = this.getImageCaptchaScore(img);
    return score >= 4;
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
      let attrChanged = false;
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.findAndProcessCaptchaImages(node);
              this.findAndProcessIframeCaptchas(node);
            }
          });
        } else if (mutation.type === 'attributes' && mutation.target.tagName === 'IMG') {
          attrChanged = true;
        }
      });
     
      if (attrChanged) {
        this.findAndProcessCaptchaImages(document.body);
      }
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'src'],
    });
  }

  async handleImageCaptcha(imgElement) {
    if (!this.isEnabled) return;
    if (!isElementVisible(imgElement)) {
      console.log('UnCAPTCHA: Image captcha not visible, skipping');
      return;
    }
    try {
      await this.waitForImageLoad(imgElement);

      const width = imgElement.naturalWidth || imgElement.width;
      const height = imgElement.naturalHeight || imgElement.height;

      if (width < 30 || height < 30) {
        console.log('UnCAPTCHA: Image too small after loading (' + width + 'x' + height + '), skipping');
        return;
      }

      const fetchSolution = async () => {
        const base64 = await this.imageToBase64(imgElement);
        if (!base64) return null;
        console.log('UnCAPTCHA: Submitting image captcha to 2captcha');
        return this.solveCaptcha({ method: 'base64', body: base64 });
      };

      const applySolution = (response) => {
        if (!response || !response.solution) return false;
        const inputField = this.findCaptchaInput(imgElement);
        if (inputField) this.fillCaptchaInput(inputField, response.solution);
        return true;
      };

      const autoSolve = await getAutoSolvePreference();
      const captchaCount = countCaptchasOnPage(this);
      if (autoSolve && captchaCount === 1) {
        console.log('UnCAPTCHA: Auto-solve enabled, skipping prompt');
        const spinner = (globalThis.showSpinner || showSpinner)(imgElement);
        let succeeded = false;
        try {
          succeeded = applySolution(await fetchSolution());
        } catch (error) {
          console.error('UnCAPTCHA: Failed to solve image captcha:', error);
        } finally {
          if (succeeded && spinner.success) spinner.success();
          else if (spinner.fail) spinner.fail();
          else spinner.remove();
        }
      } else {
        if (autoSolve) {
          console.log('UnCAPTCHA: Multiple captchas on page (' + captchaCount + '), falling back to prompt');
        }
        if (activeSolvePrompt && document.body.contains(activeSolvePrompt)) {
          console.log('UnCAPTCHA: Prompt already active, skipping image captcha');
          return;
        }
        const pending = fetchSolution().catch((error) => {
          console.error('UnCAPTCHA: Pre-fetch image captcha failed:', error);
          return null;
        });
        (globalThis.showSolvePrompt || showSolvePrompt)(imgElement, async () => {
          const spinner = (globalThis.showSpinner || showSpinner)(imgElement);
          let succeeded = false;
          try {
            succeeded = applySolution(await pending);
          } finally {
            if (succeeded && spinner.success) spinner.success();
            else if (spinner.fail) spinner.fail();
            else spinner.remove();
          }
        });
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
    // Prefer captcha-named inputs in the same form
    const form = imgElement.closest('form');
    if (form) {
      const inputs = form.querySelectorAll('input[type="text"], input[type="password"], input:not([type])');
      for (const input of inputs) {
        if (this.isCaptchaInput(input)) return input;
      }
    }

    // Then captcha-named inputs in any ancestor
    let parent = imgElement.parentElement;
    while (parent && parent !== document.body) {
      const inputs = parent.querySelectorAll('input[type="text"], input[type="password"], input:not([type])');
      for (const input of inputs) {
        if (this.isCaptchaInput(input)) return input;
      }
      parent = parent.parentElement;
    }

    // Last resort: a single non-captcha input in the same form (only if exactly one)
    if (form) {
      const inputs = form.querySelectorAll('input[type="text"], input[type="password"], input:not([type])');
      if (inputs.length === 1) return inputs[0];
    }

    return null;
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

    const isInvisible = element.getAttribute('data-size') === 'invisible' || !isElementVisible(element);

    console.log('UnCAPTCHA: Requesting reCAPTCHA v2 solution from 2captcha');
    const captchaData = { method: 'userrecaptcha', googlekey: sitekey, pageurl: window.location.href };
    const fetchSolution = () => this.solveCaptcha(captchaData);

    const applySolution = (response) => {
      if (!response || !response.solution) return false;
      this.applySolution(element, response.solution);
      return true;
    };

    const autoSolve = await getAutoSolvePreference();
    const captchaCount = countCaptchasOnPage(null);
    if (isInvisible || (autoSolve && captchaCount === 1)) {
      console.log('UnCAPTCHA: Auto-solve enabled, skipping prompt');
      const spinner = (globalThis.showSpinner || showSpinner)(element);
      let succeeded = false;
      try {
        succeeded = applySolution(await fetchSolution());
      } catch (error) {
        console.error('UnCAPTCHA: Failed to solve reCAPTCHA v2:', error);
      } finally {
        if (succeeded && spinner.success) spinner.success();
        else if (spinner.fail) spinner.fail();
        else spinner.remove();
      }
    } else {
      if (autoSolve) {
        console.log('UnCAPTCHA: Multiple captchas on page (' + captchaCount + '), falling back to prompt');
      }
      if (activeSolvePrompt && document.body.contains(activeSolvePrompt)) {
        console.log('UnCAPTCHA: Prompt already active, skipping reCAPTCHA');
        return;
      }
      const pending = fetchSolution().catch((error) => {
        console.error('UnCAPTCHA: Pre-fetch reCAPTCHA v2 failed:', error);
        return null;
      });
      (globalThis.showSolvePrompt || showSolvePrompt)(element, async () => {
        const spinner = (globalThis.showSpinner || showSpinner)(element);
        let succeeded = false;
        try {
          succeeded = applySolution(await pending);
        } finally {
          if (succeeded && spinner.success) spinner.success();
          else if (spinner.fail) spinner.fail();
          else spinner.remove();
        }
      });
    }
  }

  applySolution(element, solution) {
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
    return false; 
  }
  return true; 
});

if (typeof module !== 'undefined') {
  module.exports = {
    ImageCaptchaDetector,
    RecaptchaV2Detector,
    showSolvePrompt,
    showSpinner,
    getAutoSolvePreference,
    isElementVisible,
    countCaptchasOnPage,
    _resetActivePrompt: () => { activeSolvePrompt = null; },
  };
}
