document.addEventListener('DOMContentLoaded', function() {
  const currentPage = document.getElementById('currentPage');
  const timeSpent = document.getElementById('timeSpent');
  const timeLeft = document.getElementById('timeLeft');
  const startPomodoro = document.getElementById('startPomodoro');
  const settingsBtn = document.getElementById('settingsBtn');
  const analyticsBtn = document.getElementById('analyticsBtn');
  const toggleExtension = document.getElementById('toggleExtension');
  const backBtn = document.getElementById('backBtn');
  const blockedPagesTab = document.getElementById('blockedPagesTab');
  const pomodoroTimerTab = document.getElementById('pomodoroTimerTab');
  const blockedPagesContent = document.getElementById('blockedPagesContent');
  const pomodoroTimerContent = document.getElementById('pomodoroTimerContent');
  const start = document.getElementById('start');
  const settingsContent = document.getElementById('settings-content');

  // Load current page stats (Written by ChatGPT)
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const url = new URL(tabs[0].url);
    currentPage.textContent = url.hostname;
    
    chrome.storage.local.get(['usageData', 'settings'], function(result) {
      const usageData = result.usageData || {};
      const settings = result.settings || {};
      const currentTime = usageData[url.hostname] || 0;
      const limit = settings[url.hostname] ? settings[url.hostname].limit : 'Not set';
      
      timeSpent.textContent = formatTime(currentTime);
      timeLeft.textContent = limit === 'Not set' ? 'Not set' : formatTime(Math.max(0, limit - currentTime));
    });
  });

  // Event listener
  settingsBtn.addEventListener('click', function() {
    start.style.display = 'none';
    settingsContent.style.display = 'block';
  });

  backBtn.addEventListener('click', function() {
    start.style.display = 'block';
    settingsContent.style.display = 'none';
  });

  blockedPagesTab.addEventListener('click', function() {
    pomodoroTimerTab.classList.remove('active');
    blockedPagesTab.classList.add('active');
    pomodoroTimerContent.style.display = 'none';
    blockedPagesContent.style.display = 'block';
  });

  pomodoroTimerTab.addEventListener('click', function() {
    blockedPagesTab.classList.remove('active');
    pomodoroTimerTab.classList.add('active');
    blockedPagesContent.style.display = 'none';
    pomodoroTimerContent.style.display = 'block';
  });
});
  