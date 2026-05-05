// background.js
class CaptchaSolver {
  constructor() {
    this.baseUrl = 'https://2captcha.com';
    this.apiKey = ''; // No default API key
    this.enabled = true; // Enabled by default
    this.init();
  }
  
  async init() {
    // Load settings from storage
    const result = await chrome.storage.sync.get(['apiKey', 'enabled']);
    
    // Set API key from storage
    if (result.apiKey && result.apiKey !== 'YOUR_API_KEY_HERE') {
      this.apiKey = result.apiKey;
    }

    // Set enabled state from storage or default
    if (result.enabled !== undefined) {
      this.enabled = result.enabled;
    } else {
      await chrome.storage.sync.set({enabled: this.enabled});
    }
  }
  
  async submitCaptcha(captchaData) {
    if (!this.apiKey) {
      throw new Error('API key not set. Please enter your API key in the extension popup.');
    }
    
    const formData = new FormData();
    formData.append('key', this.apiKey);
    formData.append('json', '1');
    
    // Add captcha-specific data
    Object.keys(captchaData).forEach(key => {
      formData.append(key, captchaData[key]);
    });
    
    try {
      const response = await fetch(`${this.baseUrl}/in.php`, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      console.log('2captcha in.php response:', result);
      
      if (result.status === 1) {
        return result.request; // Returns captcha ID
      } else {
        throw new Error(result.error_text || 'Failed to submit captcha');
      }
    } catch (error) {
      console.error('Error submitting captcha:', error);
      throw error;
    }
  }
  
  async getCaptchaResult(captchaId) {
    const maxAttempts = 60; // Max 10 minutes (60 * 10 seconds)
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`${this.baseUrl}/res.php?key=${this.apiKey}&action=get&id=${captchaId}&json=1`);
        const text = await response.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch (e) {
          console.error('Failed to parse 2captcha response as JSON:', text);
          throw new Error(`Invalid 2captcha response format: ${text}`);
        }
        console.log('2captcha res.php response:', result);
        
        if (result.status === 1) {
          return result.request; // Returns the solution
        } else if (result.request === 'CAPCHA_NOT_READY') {
          // Wait 10 seconds before trying again
          await new Promise(resolve => setTimeout(resolve, 10000));
          attempts++;
        } else {
          let errorMsg = result.error_text || result.request || 'Failed to get captcha result';
          if (errorMsg === 'ERROR_KEY_DOES_NOT_EXIST') {
            errorMsg = 'Invalid 2captcha API key. Please check your settings.';
          } else if (errorMsg === 'ERROR_ZERO_BALANCE') {
            errorMsg = 'Your 2captcha account has zero balance.';
          } else {
            // Include raw result for debugging if it's an unknown error
            errorMsg = `2captcha error: ${errorMsg} (${JSON.stringify(result)})`;
          }
          throw new Error(errorMsg);
        }
      } catch (error) {
        console.error('Error getting captcha result:', error);
        throw error;
      }
    }
    
    throw new Error('Captcha solving timeout');
  }
  
  async solveCaptcha(captchaData) {
    try {
      console.log('Submitting captcha to 2captcha:', captchaData.method);
      const captchaId = await this.submitCaptcha(captchaData);
      
      console.log('Waiting for captcha solution (ID:', captchaId, ')...');
      const solution = await this.getCaptchaResult(captchaId);
      
      console.log('Captcha solved successfully');
      return solution;
    } catch (error) {
      console.error('Error solving captcha:', error);
      throw error;
    }
  }
}

const captchaSolver = new CaptchaSolver();

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleExtension') {
    captchaSolver.enabled = request.enabled;
    console.log('Extension', request.enabled ? 'enabled' : 'disabled');
    sendResponse({success: true});
    return false;
  }
  
  if (request.action === 'solveCaptcha') {
    if (!captchaSolver.enabled) {
      sendResponse({error: 'Extension is disabled'});
      return true;
    }
    
    captchaSolver.solveCaptcha(request.captchaData)
      .then(solution => {
        sendResponse({solution: solution});
      })
      .catch(error => {
        sendResponse({error: error.message});
      });
    
    return true; // Indicates we will send a response asynchronously
  }
  
  if (request.action === 'updateApiKey') {
    captchaSolver.apiKey = request.apiKey;
    chrome.storage.sync.set({apiKey: request.apiKey});
    sendResponse({success: true});
    return false;
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.apiKey) {
    captchaSolver.apiKey = changes.apiKey.newValue;
  }
  if (changes.enabled) {
    captchaSolver.enabled = changes.enabled.newValue;
  }
});