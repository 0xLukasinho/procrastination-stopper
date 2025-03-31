document.addEventListener('DOMContentLoaded', () => {
  // Tab navigation
  const distractionBtn = document.getElementById('distractionBtn');
  const pomodoroBtn = document.getElementById('pomodoroBtn');
  const distractionBlocker = document.getElementById('distractionBlocker');
  const pomodoroTimer = document.getElementById('pomodoroTimer');
  
  distractionBtn.addEventListener('click', () => {
    distractionBtn.classList.add('active');
    pomodoroBtn.classList.remove('active');
    distractionBlocker.classList.add('active');
    pomodoroTimer.classList.remove('active');
  });
  
  pomodoroBtn.addEventListener('click', () => {
    distractionBtn.classList.remove('active');
    pomodoroBtn.classList.add('active');
    distractionBlocker.classList.remove('active');
    pomodoroTimer.classList.add('active');
  });
  
  // Time spent table / Limited pages tabs
  const timespentBtn = document.getElementById('timespentBtn');
  const limitedBtn = document.getElementById('limitedBtn');
  const timeSpentTable = document.getElementById('timeSpentTable');
  const limitedPagesTable = document.getElementById('limitedPagesTable');
  
  timespentBtn.addEventListener('click', () => {
    timespentBtn.classList.add('active');
    limitedBtn.classList.remove('active');
    timeSpentTable.classList.add('active');
    limitedPagesTable.classList.remove('active');
  });
  
  limitedBtn.addEventListener('click', () => {
    timespentBtn.classList.remove('active');
    limitedBtn.classList.add('active');
    timeSpentTable.classList.remove('active');
    limitedPagesTable.classList.add('active');
  });
  
  // Add debug click handler to title (hidden feature)
  document.querySelector('header h1').addEventListener('click', (e) => {
    if (e.shiftKey && e.ctrlKey) {
      debugPanel();
    }
  });
  
  // Load data
  loadCurrentPageInfo();
  loadTimeSpentData();
  loadLimitedPagesData();
  loadPomodoroSettings();
  
  // Initialize Pomodoro timer
  initTimerDisplay();
  
  // Setup event listeners for pagination
  setupPagination();
  
  // Setup reset button
  document.getElementById('resetDefaultsBtn2').addEventListener('click', resetPomodoroDefaults);
  
  // Setup add limited page button
  document.getElementById('addLimitedPageBtn').addEventListener('click', showAddLimitedPageModal);
  
  // Setup footer buttons
  document.getElementById('settingsBtn').addEventListener('click', openOptionsPage);
  
  // Remove analytics button from DOM
  const analyticsBtn = document.getElementById('analyticsBtn');
  if (analyticsBtn) {
    analyticsBtn.parentNode.removeChild(analyticsBtn);
  }
  
  document.getElementById('powerBtn').addEventListener('click', toggleExtension);
  
  // Setup back to start button
  document.getElementById('backBtn').addEventListener('click', () => {
    distractionBtn.click();
  });
  
  // Listen for time updates from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'timeUpdated' || message.action === 'timeDataUpdated') {
      // Update current page info when time changes
      loadCurrentPageInfo();
    } else if (message.action === 'tabChanged') {
      // Update when active tab changes
      loadCurrentPageInfo();
    } else if (message.action === 'timerCompleted') {
      // Handle timer completion
      handleTimerCompletion(message);
    }
  });
  
  // Force a time update from the background script
  chrome.runtime.sendMessage({ action: 'forceTimeUpdate' });
  
  // Refresh data periodically
  setInterval(loadTimeSpentData, 5000);
  setInterval(loadLimitedPagesData, 30000);
  
  // Check timer status more frequently
  setInterval(checkTimerStatus, 1000);
});

// Debug panel for testing and fixing
function debugPanel() {
  // Create debug panel element
  const debugElement = document.createElement('div');
  debugElement.id = 'debugPanel';
  debugElement.style.cssText = 'position: fixed; top: 10px; right: 10px; background: #fff; border: 1px solid #ccc; padding: 10px; z-index: 1000; box-shadow: 0 0 10px rgba(0,0,0,0.2);';
  
  debugElement.innerHTML = `
    <h3>Debug Panel</h3>
    <div style="display: flex; flex-direction: column; gap: 10px;">
      <button id="debugMigrate">Force Data Migration</button>
      <button id="debugShowData">Show Storage Data</button>
      <button id="debugResetToday">Reset Today's Data</button>
      <button id="debugAddTime">Add 10s to Current Site</button>
      <hr>
      <h4>Timer Testing</h4>
      <button id="debugTestTimer">Test 5s Timer</button>
      <button id="debugTestNotification">Test Notification</button>
      <button id="debugLogTimerState">Log Timer State</button>
      <div id="debugOutput" style="max-height: 200px; overflow: auto; margin-top: 10px; font-size: 12px; background: #f5f5f5; padding: 5px;"></div>
    </div>
  `;
  
  document.body.appendChild(debugElement);
  
  // Attach event listeners
  document.getElementById('debugMigrate').addEventListener('click', () => {
    chrome.storage.local.get('websites', (result) => {
      if (!result.websites) {
        addDebugOutput('No websites found');
        return;
      }
      
      const websites = result.websites;
      const today = new Date();
      const dateString = today.toISOString().split('T')[0];
      
      websites.forEach(website => {
        if (!website.dailyUsage) {
          website.dailyUsage = {};
        }
        
        if (!website.dailyUsage[dateString]) {
          website.dailyUsage[dateString] = website.timeSpent || 0;
        }
      });
      
      chrome.storage.local.set({ websites }, () => {
        addDebugOutput('Migration complete');
        loadCurrentPageInfo();
        loadTimeSpentData();
      });
    });
  });
  
  document.getElementById('debugShowData').addEventListener('click', () => {
    chrome.storage.local.get('websites', (result) => {
      addDebugOutput('Storage data: ' + JSON.stringify(result.websites, null, 2));
    });
  });
  
  document.getElementById('debugResetToday').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'resetTimeData' }, (response) => {
      addDebugOutput('Reset response: ' + JSON.stringify(response));
      loadCurrentPageInfo();
      loadTimeSpentData();
    });
  });
  
  document.getElementById('debugAddTime').addEventListener('click', () => {
    // Get current domain
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs && tabs.length > 0) {
        const activeTab = tabs[0];
        const url = new URL(activeTab.url);
        const domain = url.hostname;
        
        // Get today's date
        const today = new Date();
        const dateString = today.toISOString().split('T')[0];
        
        // Add time to site
        chrome.storage.local.get('websites', (result) => {
          const websites = result.websites || [];
          const website = websites.find(site => site.domain === domain);
          
          if (website) {
            // Ensure dailyUsage exists
            if (!website.dailyUsage) {
              website.dailyUsage = {};
            }
            
            // Ensure today's entry exists
            if (!website.dailyUsage[dateString]) {
              website.dailyUsage[dateString] = 0;
            }
            
            // Add 10 seconds
            website.dailyUsage[dateString] += 10;
            website.timeSpent = (website.timeSpent || 0) + 10;
            
            // Save
            chrome.storage.local.set({ websites }, () => {
              addDebugOutput(`Added 10s to ${domain}, now: ${website.dailyUsage[dateString]}s`);
              loadCurrentPageInfo();
              loadTimeSpentData();
            });
          } else {
            addDebugOutput(`Site ${domain} not found in tracking data`);
          }
        });
      }
    });
  });
  
  // Test Timer
  document.getElementById('debugTestTimer').addEventListener('click', () => {
    // Set very short pomodoro for testing
    chrome.storage.local.get('pomodoroSettings', (result) => {
      const settings = result.pomodoroSettings || {};
      const origPomodoro = settings.pomodoro;
      
      // Temporarily set to 5 seconds
      settings.pomodoro = 5 / 60; // 5 seconds in minutes
      settings.shortBreak = 5 / 60; // 5 seconds in minutes
      settings.autoStartBreaks = true;
      settings.autoStartPomodoros = true;
      
      chrome.storage.local.set({ pomodoroSettings: settings }, () => {
        addDebugOutput('Starting test timer (5s)');
        
        // Start the timer
        chrome.runtime.sendMessage({ 
          action: 'startTimer',
          timerType: 'pomodoro'
        }, (response) => {
          addDebugOutput('Timer started: ' + JSON.stringify(response));
          
          // After 8 seconds, restore original settings
          setTimeout(() => {
            settings.pomodoro = origPomodoro;
            chrome.storage.local.set({ pomodoroSettings: settings }, () => {
              addDebugOutput('Restored original settings');
            });
          }, 8000);
        });
      });
    });
  });
  
  // Test notification
  document.getElementById('debugTestNotification').addEventListener('click', () => {
    chrome.runtime.sendMessage({ 
      action: 'testNotification',
      title: 'Test Notification',
      message: 'This is a test notification'
    }, (response) => {
      addDebugOutput('Notification test: ' + JSON.stringify(response));
    });
  });
  
  // Log timer state
  document.getElementById('debugLogTimerState').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'getActiveTabInfo' }, (response) => {
      addDebugOutput('Timer state: ' + JSON.stringify(response, null, 2));
    });
  });
  
  // Helper function to add debug output
  function addDebugOutput(text) {
    const outputElem = document.getElementById('debugOutput');
    outputElem.innerHTML += `<div>${text}</div>`;
    // Auto-scroll to bottom
    outputElem.scrollTop = outputElem.scrollHeight;
  }
}

// Load current page info
function loadCurrentPageInfo() {
  // Get the active tab directly
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (tabs && tabs.length > 0) {
      const activeTab = tabs[0];
      const url = new URL(activeTab.url);
      const domain = url.hostname;
      
      document.getElementById('currentUrl').textContent = domain;
      
      // Get today's date for tracking daily usage
      const today = new Date();
      const dateString = today.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      // Get time spent for this domain
      chrome.storage.local.get('websites', (result) => {
        const websites = result.websites || [];
        const website = websites.find(site => site.domain === domain);
        
        if (website) {
          // Get today's usage or default to 0
          const todayUsage = website.dailyUsage && website.dailyUsage[dateString] 
            ? website.dailyUsage[dateString] 
            : 0;
          
          // Update time spent with today's usage
          document.getElementById('timeSpent').textContent = formatTime(todayUsage);
          
          // Update time left if there's a limit
          if (website.timeLimit) {
            const timeLeftSeconds = (website.timeLimit * 60) - todayUsage;
            if (timeLeftSeconds > 0) {
              document.getElementById('timeLeft').textContent = formatTime(timeLeftSeconds);
            } else {
              document.getElementById('timeLeft').textContent = 'Time limit reached';
            }
          } else {
            document.getElementById('timeLeft').textContent = 'No limit set';
          }
        } else {
          document.getElementById('timeSpent').textContent = '0s';
          document.getElementById('timeLeft').textContent = 'No limit set';
        }
      });
    } else {
      document.getElementById('currentUrl').textContent = '-';
      document.getElementById('timeSpent').textContent = '-';
      document.getElementById('timeLeft').textContent = '-';
    }
  });
}

// Constants for pagination
const ITEMS_PER_PAGE = 15;
let currentTimeSpentPage = 1;
let currentLimitedPage = 1;

// Setup pagination for both tables
function setupPagination() {
  const timeSpentContainer = document.getElementById('timeSpentTable');
  const limitedContainer = document.getElementById('limitedPagesTable');
  
  if (timeSpentContainer) {
    const prevBtn = timeSpentContainer.querySelector('.prev-page');
    const nextBtn = timeSpentContainer.querySelector('.next-page');
    
    prevBtn.addEventListener('click', () => {
      if (currentTimeSpentPage > 1) {
        currentTimeSpentPage--;
        loadTimeSpentData();
      }
    });
    
    nextBtn.addEventListener('click', () => {
      chrome.storage.local.get('websites', (result) => {
        const websites = result.websites || [];
        const maxPage = Math.ceil(websites.length / ITEMS_PER_PAGE);
        if (currentTimeSpentPage < maxPage) {
          currentTimeSpentPage++;
          loadTimeSpentData();
        }
      });
    });
  }
  
  if (limitedContainer) {
    const prevBtn = limitedContainer.querySelector('.prev-page');
    const nextBtn = limitedContainer.querySelector('.next-page');
    
    prevBtn.addEventListener('click', () => {
      if (currentLimitedPage > 1) {
        currentLimitedPage--;
        loadLimitedPagesData();
      }
    });
    
    nextBtn.addEventListener('click', () => {
      chrome.storage.local.get('websites', (result) => {
        const websites = (result.websites || []).filter(site => site.timeLimit);
        const maxPage = Math.ceil(websites.length / ITEMS_PER_PAGE);
        if (currentLimitedPage < maxPage) {
          currentLimitedPage++;
          loadLimitedPagesData();
        }
      });
    });
  }
}

// Update time spent table with pagination
function updateTimeSpentTable(websites, page) {
  const startIndex = (page - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const pageItems = websites.slice(startIndex, endIndex);
  
  const tbody = document.getElementById('timeSpentBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  pageItems.forEach(website => {
    const row = document.createElement('tr');
    
    // Website domain
    const domainCell = document.createElement('td');
    domainCell.textContent = website.domain;
    row.appendChild(domainCell);
    
    // Today's usage
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    const todayUsage = website.dailyUsage && website.dailyUsage[dateString] 
      ? website.dailyUsage[dateString] 
      : 0;
    
    const todayCell = document.createElement('td');
    todayCell.textContent = formatTime(todayUsage);
    row.appendChild(todayCell);
    
    // Current week usage
    const weekCell = document.createElement('td');
    weekCell.textContent = formatTime(calculateWeekUsage(website));
    row.appendChild(weekCell);
    
    // 4 week average
    const avgCell = document.createElement('td');
    avgCell.textContent = formatTime(calculateFourWeekAverage(website)) + '/day';
    row.appendChild(avgCell);
    
    // Limit
    const limitCell = document.createElement('td');
    limitCell.textContent = website.timeLimit ? `${website.timeLimit}m/day` : 'Not set';
    row.appendChild(limitCell);
    
    // Actions
    const actionsCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.innerHTML = '&#9998;';
    editBtn.addEventListener('click', () => {
      editWebsite(website.domain, website.timeLimit);
    });
    actionsCell.appendChild(editBtn);
    row.appendChild(actionsCell);
    
    tbody.appendChild(row);
  });
  
  // Update pagination UI
  const container = document.getElementById('timeSpentTable');
  if (!container) return;
  
  const currentPageSpan = container.querySelector('#currentPage-timespent');
  const prevBtn = container.querySelector('.prev-page');
  const nextBtn = container.querySelector('.next-page');
  
  if (currentPageSpan) currentPageSpan.textContent = page;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = endIndex >= websites.length;
  
  const pagination = container.querySelector('.pagination');
  if (pagination) {
    pagination.style.display = websites.length > ITEMS_PER_PAGE ? 'flex' : 'none';
  }
}

// Update limited pages table with pagination
function updateLimitedPagesTable(websites, page) {
  const startIndex = (page - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const pageItems = websites.slice(startIndex, endIndex);
  
  const tbody = document.getElementById('limitedPagesBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  pageItems.forEach(website => {
    const row = document.createElement('tr');
    
    // Website domain
    const domainCell = document.createElement('td');
    domainCell.textContent = website.domain;
    row.appendChild(domainCell);
    
    // Time limit
    const limitCell = document.createElement('td');
    limitCell.textContent = `${website.timeLimit}m`;
    row.appendChild(limitCell);
    
    // Actions
    const actionsCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.innerHTML = '&#9998;';
    editBtn.addEventListener('click', () => {
      editWebsite(website.domain, website.timeLimit);
    });
    actionsCell.appendChild(editBtn);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '&#128465;';
    deleteBtn.addEventListener('click', () => {
      removeWebsiteLimit(website.domain);
    });
    actionsCell.appendChild(deleteBtn);
    
    row.appendChild(actionsCell);
    tbody.appendChild(row);
  });
  
  // Update pagination UI
  const container = document.getElementById('limitedPagesTable');
  if (!container) return;
  
  const currentPageSpan = container.querySelector('#currentPage-limited');
  const prevBtn = container.querySelector('.prev-page');
  const nextBtn = container.querySelector('.next-page');
  
  if (currentPageSpan) currentPageSpan.textContent = page;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = endIndex >= websites.length;
  
  const pagination = container.querySelector('.pagination');
  if (pagination) {
    pagination.style.display = websites.length > ITEMS_PER_PAGE ? 'flex' : 'none';
  }
}

// Load time spent data with pagination
function loadTimeSpentData() {
  chrome.storage.local.get('websites', (result) => {
    let websites = result.websites || [];
    
    // Sort by time spent today (most used first)
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    
    websites.sort((a, b) => {
      const timeA = a.dailyUsage && a.dailyUsage[dateString] ? a.dailyUsage[dateString] : 0;
      const timeB = b.dailyUsage && b.dailyUsage[dateString] ? b.dailyUsage[dateString] : 0;
      return timeB - timeA; // Sort in descending order (most used first)
    });
    
    updateTimeSpentTable(websites, currentTimeSpentPage);
  });
}

// Load limited pages data with pagination
function loadLimitedPagesData() {
  chrome.storage.local.get('websites', (result) => {
    const websites = (result.websites || []).filter(site => site.timeLimit);
    updateLimitedPagesTable(websites, currentLimitedPage);
  });
}

// Load pomodoro settings
function loadPomodoroSettings() {
  chrome.storage.local.get('pomodoroSettings', (result) => {
    if (result.pomodoroSettings) {
      const settings = result.pomodoroSettings;
      
      // Update inputs in pomodoro panel
      document.getElementById('pomodoroTime').value = settings.pomodoro;
      document.getElementById('shortBreakTime').value = settings.shortBreak;
      document.getElementById('longBreakTime').value = settings.longBreak;
      document.getElementById('longBreakIntervalInput').value = settings.longBreakInterval;
      document.getElementById('autoStartBreaksCheck').checked = settings.autoStartBreaks;
      document.getElementById('autoStartPomodorosCheck').checked = settings.autoStartPomodoros;
    }
  });
}

// Save pomodoro settings
function savePomodoroSettings() {
  const settings = {
    pomodoro: parseInt(document.getElementById('pomodoroTime').value, 10),
    shortBreak: parseInt(document.getElementById('shortBreakTime').value, 10),
    longBreak: parseInt(document.getElementById('longBreakTime').value, 10),
    longBreakInterval: parseInt(document.getElementById('longBreakIntervalInput').value, 10),
    autoStartBreaks: document.getElementById('autoStartBreaksCheck').checked,
    autoStartPomodoros: document.getElementById('autoStartPomodorosCheck').checked
  };
  
  chrome.storage.local.set({ pomodoroSettings: settings });
}

// Reset pomodoro settings to defaults
function resetPomodoroDefaults() {
  const defaultSettings = {
    pomodoro: 25,
    shortBreak: 5,
    longBreak: 15,
    longBreakInterval: 4,
    autoStartBreaks: true,
    autoStartPomodoros: true
  };
  
  chrome.storage.local.set({ pomodoroSettings: defaultSettings }, () => {
    loadPomodoroSettings();
  });
}

// Format time in seconds to a human-readable format
function formatTime(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

// Show add limited page modal (not implemented in this demo)
function showAddLimitedPageModal() {
  // This would show a modal to add a new limited page
  // For this demo, we'll just add a default site for testing
  const domain = prompt('Enter website domain (e.g., example.com):');
  const timeLimit = prompt('Enter time limit in minutes:');
  
  if (domain && timeLimit) {
    addLimitedPage(domain, parseInt(timeLimit, 10));
  }
}

// Add a limited page
function addLimitedPage(domain, timeLimit) {
  chrome.storage.local.get('websites', (result) => {
    let websites = result.websites || [];
    
    // Get today's date for tracking daily usage
    const today = new Date();
    const dateString = today.toISOString().split('T')[0]; // YYYY-MM-DD format
    
    // Check if website already exists
    const index = websites.findIndex(site => site.domain === domain);
    
    if (index >= 0) {
      // Update existing site
      websites[index].timeLimit = timeLimit;
    } else {
      // Add new site with initialized dailyUsage
      const newWebsite = {
        domain: domain,
        timeSpent: 0,
        timeLimit: timeLimit,
        lastVisit: Date.now(),
        added: Date.now(),
        dailyUsage: {}
      };
      
      // Initialize today's usage to 0
      newWebsite.dailyUsage[dateString] = 0;
      
      websites.push(newWebsite);
    }
    
    chrome.storage.local.set({ websites: websites }, () => {
      loadTimeSpentData();
      loadLimitedPagesData();
    });
  });
}

// Edit website
function editWebsite(domain, currentLimit) {
  const newLimit = prompt(`Enter new time limit for ${domain} (in minutes):`, currentLimit || '');
  
  if (newLimit !== null) {
    chrome.storage.local.get('websites', (result) => {
      let websites = result.websites || [];
      
      // Find website
      const index = websites.findIndex(site => site.domain === domain);
      
      if (index >= 0) {
        // Update website
        websites[index].timeLimit = parseInt(newLimit, 10) || null;
        
        chrome.storage.local.set({ websites: websites }, () => {
          loadTimeSpentData();
          loadLimitedPagesData();
        });
      }
    });
  }
}

// Remove website limit
function removeWebsiteLimit(domain) {
  if (confirm(`Remove time limit for ${domain}?`)) {
    chrome.storage.local.get('websites', (result) => {
      let websites = result.websites || [];
      
      // Find website
      const index = websites.findIndex(site => site.domain === domain);
      
      if (index >= 0) {
        // Remove limit but keep tracking
        websites[index].timeLimit = null;
        
        chrome.storage.local.set({ websites: websites }, () => {
          loadTimeSpentData();
          loadLimitedPagesData();
        });
      }
    });
  }
}

// Open options page
function openOptionsPage() {
  chrome.runtime.openOptionsPage();
}

// Toggle extension on/off
function toggleExtension() {
  chrome.storage.local.get('extensionEnabled', (result) => {
    const currentState = result.extensionEnabled !== false; // Default to true if not set
    
    chrome.storage.local.set({ extensionEnabled: !currentState }, () => {
      alert(`Extension ${!currentState ? 'enabled' : 'disabled'}`);
    });
  });
}

// Add Pomodoro timer functionality
let timerInterval = null;

// Handle a completed timer event
function handleTimerCompletion(message) {
  console.log('Handling timer completion event:', message);
  
  const timerDisplay = document.getElementById('timerDisplay');
  const timerStatus = document.getElementById('timerStatus');
  const startBtn = document.getElementById('startTimerBtn');
  const pauseBtn = document.getElementById('pauseTimerBtn');
  const resetBtn = document.getElementById('resetTimerBtn');
  
  console.log('Timer completed, next type:', message.nextTimerType, 'auto-starting:', message.isAutoStarting);
  
  // Update UI based on next timer type
  if (message.nextTimerType === 'pomodoro') {
    timerStatus.textContent = 'Pomodoro';
    document.getElementById('timerCircle').style.borderColor = 'var(--primary-color)';
    
    // Update time display with pomodoro duration
    const minutes = parseInt(document.getElementById('pomodoroTime').value, 10);
    timerDisplay.textContent = formatTimeForDisplay(minutes * 60);
  } else if (message.nextTimerType === 'shortBreak') {
    timerStatus.textContent = 'Short Break';
    document.getElementById('timerCircle').style.borderColor = '#3498db';
    
    // Update time display with short break duration
    const minutes = parseInt(document.getElementById('shortBreakTime').value, 10);
    timerDisplay.textContent = formatTimeForDisplay(minutes * 60);
  } else if (message.nextTimerType === 'longBreak') {
    timerStatus.textContent = 'Long Break';
    document.getElementById('timerCircle').style.borderColor = '#9b59b6';
    
    // Update time display with long break duration
    const minutes = parseInt(document.getElementById('longBreakTime').value, 10);
    timerDisplay.textContent = formatTimeForDisplay(minutes * 60);
  }
  
  // If timer will auto-start, update UI accordingly
  if (message.isAutoStarting) {
    // Immediately show that the timer is in a "starting" state
    startBtn.textContent = 'Starting...';
    startBtn.disabled = true;
    pauseBtn.disabled = true;
    resetBtn.disabled = false;
    
    // Show a transient message that timer is auto-starting
    const timerCircle = document.getElementById('timerCircle');
    timerCircle.classList.add('auto-starting');
    setTimeout(() => {
      timerCircle.classList.remove('auto-starting');
    }, 2000);
    
    // Timer will auto-start - check again shortly for the new timer
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'getActiveTabInfo' }, (response) => {
        if (response && response.isTimerRunning) {
          updateTimerUI(response.timerType, response.timerEndTime);
          startBtn.textContent = 'Running';
          startBtn.disabled = true;
          pauseBtn.disabled = false;
          resetBtn.disabled = false;
          
          // Start updating the timer display
          startTimerDisplay(response.timerEndTime);
        }
      });
    }, 1000); // Small delay to ensure the new timer has started
  } else {
    // Timer will not auto-start, update UI to show ready state
    startBtn.textContent = 'Start';
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    resetBtn.disabled = true;
  }
}

// Update the timer UI based on timer type
function updateTimerUI(timerType, endTime) {
  const timerStatus = document.getElementById('timerStatus');
  
  switch (timerType) {
    case 'pomodoro':
      timerStatus.textContent = 'Pomodoro';
      document.getElementById('timerCircle').style.borderColor = 'var(--primary-color)';
      break;
    case 'shortBreak':
      timerStatus.textContent = 'Short Break';
      document.getElementById('timerCircle').style.borderColor = '#3498db';
      break;
    case 'longBreak':
      timerStatus.textContent = 'Long Break';
      document.getElementById('timerCircle').style.borderColor = '#9b59b6';
      break;
  }
  
  // Update time display
  const now = Date.now();
  const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
  document.getElementById('timerDisplay').textContent = formatTimeForDisplay(remaining);
}

// Initialize the timer display when popup is opened
function initTimerDisplay() {
  // Get elements
  const timerDisplay = document.getElementById('timerDisplay');
  const timerStatus = document.getElementById('timerStatus');
  const startBtn = document.getElementById('startTimerBtn');
  const pauseBtn = document.getElementById('pauseTimerBtn');
  const resetBtn = document.getElementById('resetTimerBtn');
  
  // Check if there's an active timer
  chrome.runtime.sendMessage({ action: 'getActiveTabInfo' }, (response) => {
    if (response && response.isTimerRunning) {
      // Timer is already running
      updateTimerUI(response.timerType, response.timerEndTime);
      startBtn.textContent = 'Running';
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      resetBtn.disabled = false;
      
      // Start updating the timer display
      startTimerDisplay(response.timerEndTime);
    } else {
      // No timer running, show default timer based on next scheduled timer type
      let minutes;
      if (response && response.timerType) {
        // Set UI based on next timer type
        if (response.timerType === 'shortBreak') {
          minutes = parseInt(document.getElementById('shortBreakTime').value, 10);
          timerStatus.textContent = 'Short Break';
          document.getElementById('timerCircle').style.borderColor = '#3498db';
        } else if (response.timerType === 'longBreak') {
          minutes = parseInt(document.getElementById('longBreakTime').value, 10);
          timerStatus.textContent = 'Long Break';
          document.getElementById('timerCircle').style.borderColor = '#9b59b6';
        } else {
          minutes = parseInt(document.getElementById('pomodoroTime').value, 10);
          timerStatus.textContent = 'Pomodoro';
          document.getElementById('timerCircle').style.borderColor = 'var(--primary-color)';
        }
      } else {
        // Default to Pomodoro
        minutes = parseInt(document.getElementById('pomodoroTime').value, 10);
        timerStatus.textContent = 'Pomodoro';
        document.getElementById('timerCircle').style.borderColor = 'var(--primary-color)';
      }
      
      timerDisplay.textContent = formatTimeForDisplay(minutes * 60);
    }
  });
  
  // Set up button event listeners
  startBtn.addEventListener('click', startPomodoro);
  pauseBtn.addEventListener('click', pausePomodoro);
  resetBtn.addEventListener('click', resetPomodoro);
  
  // Set up input change listeners
  document.getElementById('pomodoroTime').addEventListener('change', savePomodoroSettings);
  document.getElementById('shortBreakTime').addEventListener('change', savePomodoroSettings);
  document.getElementById('longBreakTime').addEventListener('change', savePomodoroSettings);
  document.getElementById('longBreakIntervalInput').addEventListener('change', savePomodoroSettings);
  document.getElementById('autoStartBreaksCheck').addEventListener('change', savePomodoroSettings);
  document.getElementById('autoStartPomodorosCheck').addEventListener('change', savePomodoroSettings);
}

// Format time in seconds to minutes:seconds display
function formatTimeForDisplay(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Start the timer display updating
function startTimerDisplay(endTime) {
  // Clear any existing interval
  clearInterval(timerInterval);
  
  // Update timer every second
  timerInterval = setInterval(() => {
    const now = Date.now();
    const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
    
    // Update display
    document.getElementById('timerDisplay').textContent = formatTimeForDisplay(remaining);
    
    // If timer has completed
    if (remaining <= 0) {
      clearInterval(timerInterval);
      
      // Reset UI
      document.getElementById('startTimerBtn').disabled = false;
      document.getElementById('startTimerBtn').textContent = 'Start';
      document.getElementById('pauseTimerBtn').disabled = true;
      document.getElementById('resetTimerBtn').disabled = true;
      
      // Check if timer status has changed (due to auto-start next timer)
      checkTimerStatus();
    }
  }, 500);
}

// Check if timer status has changed (e.g., after completion)
function checkTimerStatus() {
  chrome.runtime.sendMessage({ action: 'getActiveTabInfo' }, (response) => {
    if (response && response.isTimerRunning) {
      // A new timer has started (auto-start)
      updateTimerUI(response.timerType, response.timerEndTime);
      document.getElementById('startTimerBtn').textContent = 'Running';
      document.getElementById('startTimerBtn').disabled = true;
      document.getElementById('pauseTimerBtn').disabled = false;
      document.getElementById('resetTimerBtn').disabled = false;
      
      // Start updating the timer display
      startTimerDisplay(response.timerEndTime);
    }
  });
}

// Start pomodoro timer
function startPomodoro() {
  // Get current timer type from the status text
  const timerStatus = document.getElementById('timerStatus').textContent;
  let timerType;
  
  if (timerStatus === 'Short Break') {
    timerType = 'shortBreak';
  } else if (timerStatus === 'Long Break') {
    timerType = 'longBreak';
  } else {
    timerType = 'pomodoro';
  }
  
  // Update button states
  document.getElementById('startTimerBtn').textContent = 'Starting...';
  document.getElementById('startTimerBtn').disabled = true;
  
  // Start timer in background script
  chrome.runtime.sendMessage({ 
    action: 'startTimer',
    timerType: timerType
  }, (response) => {
    if (response && response.success) {
      // Get updated timer info
      chrome.runtime.sendMessage({ action: 'getActiveTabInfo' }, (timerInfo) => {
        if (timerInfo && timerInfo.isTimerRunning) {
          // Update UI
          updateTimerUI(timerInfo.timerType, timerInfo.timerEndTime);
          document.getElementById('startTimerBtn').textContent = 'Running';
          document.getElementById('pauseTimerBtn').disabled = false;
          document.getElementById('resetTimerBtn').disabled = false;
          
          // Start updating the timer display
          startTimerDisplay(timerInfo.timerEndTime);
        }
      });
    } else {
      // Error starting timer
      document.getElementById('startTimerBtn').textContent = 'Start';
      document.getElementById('startTimerBtn').disabled = false;
    }
  });
}

// Pause pomodoro timer
function pausePomodoro() {
  // Update button states
  document.getElementById('pauseTimerBtn').textContent = 'Pausing...';
  document.getElementById('pauseTimerBtn').disabled = true;
  
  // Pause timer in background script
  chrome.runtime.sendMessage({ 
    action: 'pauseTimer'
  }, (response) => {
    // Clear display interval
    clearInterval(timerInterval);
    
    // Update UI
    document.getElementById('startTimerBtn').textContent = 'Resume';
    document.getElementById('startTimerBtn').disabled = false;
    document.getElementById('pauseTimerBtn').textContent = 'Pause';
    document.getElementById('pauseTimerBtn').disabled = true;
    document.getElementById('resetTimerBtn').disabled = false;
  });
}

// Reset pomodoro timer
function resetPomodoro() {
  // Reset timer in background script
  chrome.runtime.sendMessage({ 
    action: 'resetTimer'
  }, (response) => {
    // Clear display interval
    clearInterval(timerInterval);
    
    // Reset UI
    const minutes = parseInt(document.getElementById('pomodoroTime').value, 10);
    document.getElementById('timerDisplay').textContent = formatTimeForDisplay(minutes * 60);
    document.getElementById('timerStatus').textContent = 'Pomodoro';
    document.getElementById('timerCircle').style.borderColor = 'var(--primary-color)';
    
    // Update buttons
    document.getElementById('startTimerBtn').textContent = 'Start';
    document.getElementById('startTimerBtn').disabled = false;
    document.getElementById('pauseTimerBtn').disabled = true;
    document.getElementById('resetTimerBtn').disabled = true;
  });
}

// Helper function to calculate week usage
function calculateWeekUsage(website) {
  let weekUsage = 0;
  if (website.dailyUsage) {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      if (website.dailyUsage[dateKey]) {
        weekUsage += website.dailyUsage[dateKey];
      }
    }
  }
  return weekUsage;
}

// Helper function to calculate 4-week average
function calculateFourWeekAverage(website) {
  let total = 0;
  let daysWithData = 0;
  if (website.dailyUsage) {
    const today = new Date();
    const fourWeeksAgo = new Date(today);
    fourWeeksAgo.setDate(today.getDate() - 28);
    
    for (let i = 0; i < 28; i++) {
      const date = new Date(fourWeeksAgo);
      date.setDate(fourWeeksAgo.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      if (website.dailyUsage[dateKey]) {
        total += website.dailyUsage[dateKey];
        daysWithData++;
      }
    }
  }
  return daysWithData > 0 ? Math.floor(total / daysWithData) : 0;
} 