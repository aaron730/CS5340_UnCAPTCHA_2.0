document.addEventListener('DOMContentLoaded', () => {
  const toggleButton = document.getElementById('toggleButton');
  const autoSolveToggle = document.getElementById('autoSolveToggle');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveApiKeyBtn = document.getElementById('saveApiKey');
  const apiKeySection = document.getElementById('apiKeySection');
  const changeKeyContainer = document.getElementById('changeKeyContainer');
  const changeKeyBtn = document.getElementById('changeKeyBtn');
  const hideApiKeyBtn = document.getElementById('hideApiKey');
  const statusEl = document.getElementById('status');
  const detailsEl = document.getElementById('details');
  const scanButton = document.getElementById('scanButton');

  console.log("Popup loaded");

  let konamiUnlocked = false;

  function showApiKeySection() {
    apiKeySection.style.display = 'block';
    changeKeyContainer.style.display = 'none';
  }

  function hideApiKeySection() {
    apiKeySection.style.display = 'none';
    changeKeyContainer.style.display = konamiUnlocked ? 'block' : 'none';
  }

  const konamiSequence = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
    'b', 'a'
  ];
  let konamiProgress = 0;
  document.addEventListener('keydown', (e) => {
    if (konamiUnlocked) return;
    const expected = konamiSequence[konamiProgress];
    const key = expected.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === expected) {
      konamiProgress++;
      if (konamiProgress === konamiSequence.length) {
        konamiUnlocked = true;
        if (apiKeySection.style.display === 'none') {
          changeKeyContainer.style.display = 'block';
        }
      }
    } else {
      konamiProgress = key === konamiSequence[0] ? 1 : 0;
    }
  });

  chrome.storage.sync.get(['enabled', 'apiKey', 'autoSolve'], (result) => {
    const enabled = result.enabled ?? true;
    toggleButton.checked = enabled;

    autoSolveToggle.checked = result.autoSolve ?? false;

    if (result.apiKey && result.apiKey !== 'YOUR_API_KEY_HERE') {
      apiKeyInput.value = result.apiKey;
      hideApiKeySection();
    } else {
      console.log("No API key set");
      showApiKeySection();
    }

    statusEl.innerHTML = "Click <strong>Scan Page</strong>";
    statusEl.style.color = "#333";
    detailsEl.textContent = "";
  });


  autoSolveToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ autoSolve: autoSolveToggle.checked }, () => {
      console.log('UnCAPTCHA auto-solve', autoSolveToggle.checked ? 'on' : 'off');
    });
  });

  changeKeyBtn.addEventListener('click', () => {
    showApiKeySection();
    hideApiKeyBtn.style.display = 'block';
  });

  hideApiKeyBtn.addEventListener('click', () => {
    hideApiKeySection();
  });

  toggleButton.addEventListener('change', () => {
    const enabled = toggleButton.checked;

    chrome.storage.sync.set({ enabled }, () => {
      console.log('UnCAPTCHA', enabled ? 'enabled' : 'disabled');

      chrome.runtime.sendMessage({
        action: 'toggleExtension',
        enabled
      });

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs.length) return;

        chrome.tabs.sendMessage(
          tabs[0].id,
          {
            action: 'toggleStateChanged',
            isEnabled: enabled
          },
          () => {
            if (chrome.runtime.lastError) {
              console.log('Content script not available');
            }
          }
        );
      });

      updateCaptchaStatus();
    });
  });

  saveApiKeyBtn.addEventListener('click', function() {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      chrome.storage.sync.set({apiKey: apiKey}, function() {
        console.log('API key saved');
        saveApiKeyBtn.textContent = 'Saved!';
        saveApiKeyBtn.style.backgroundColor = '#4CAF50';
        
        setTimeout(() => {
          saveApiKeyBtn.textContent = 'Save API Key';
          saveApiKeyBtn.style.backgroundColor = '#6ea4d7';
          hideApiKeySection();
          hideApiKeyBtn.style.display = 'none';
        }, 2000);
        
        chrome.runtime.sendMessage({
          action: 'updateApiKey',
          apiKey: apiKey
        });
      });
    } else {
      alert('Please enter a valid API key.');
    }
  });

  // SCAN BUTTON
  if (scanButton) {
    scanButton.addEventListener('click', () => {
      console.log("Scan button clicked");

      // Update UI
      statusEl.textContent = "Scanning...";
      detailsEl.textContent = "";

      scanButton.textContent = "Scanning...";
      scanButton.disabled = true;

      updateCaptchaStatus();

      setTimeout(() => {
        scanButton.textContent = "Scan Page";
        scanButton.disabled = false;
      }, 1000);
    });
  } else {
    console.log("scanButton NOT found");
  }

  // MAIN FUNCTION
  function updateCaptchaStatus() {
    if (!statusEl || !detailsEl) return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) {
        statusEl.textContent = 'No active tab';
        detailsEl.textContent = '';
        return;
      }

      console.log("Sending scan request...");

      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: 'scanCaptcha' },
        (response) => {
          if (chrome.runtime.lastError) {
            console.log("Error:", chrome.runtime.lastError.message);

            statusEl.textContent = 'No response';
            detailsEl.textContent = 'Reload the page and try again.';
            return;
          }

          if (!response) {
            console.log("No response from content script");

            statusEl.textContent = 'No response';
            detailsEl.textContent = 'Content script not running.';
            return;
          }

          console.log("Response:", response);

          if (response.detected) {
            statusEl.innerHTML = 'CAPTCHA detected — <strong>may affect accessibility</strong>';
            statusEl.style.color = 'red';

            detailsEl.innerHTML = `
              Total: ${response.total}<br>
              Iframe: ${response.iframeCaptchas}<br>
              Image: ${response.imageCaptchas}<br><br>
              Score: ${response.detectionScore}<br>
              Confidence: ${response.confidence}<br><br> 
              <span style="color:#666; font-size:11px;">
                CAPTCHAs can create barriers for users with disabilities.
              </span>
            `;
          } else {
            statusEl.textContent = 'No CAPTCHA found';
            statusEl.style.color = 'green';
            detailsEl.textContent = 'No CAPTCHA elements detected.';
          }
        }
      );
    });
  }
});