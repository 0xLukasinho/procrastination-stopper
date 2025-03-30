// Initialize storage with default values if not set
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['websites', 'pomodoroSettings', 'extensionEnabled'], (result) => {
    if (!result.websites) {
      chrome.storage.local.set({ websites: [] });
    }
    
    if (!result.pomodoroSettings) {
      chrome.storage.local.set({
        pomodoroSettings: {
          pomodoro: 25,
          shortBreak: 5,
          longBreak: 15,
          longBreakInterval: 4,
          autoStartBreaks: true,
          autoStartPomodoros: true
        }
      });
    }
    
    if (result.extensionEnabled === undefined) {
      chrome.storage.local.set({ extensionEnabled: true });
    }
    
    startTracking();
  });
});

// Start tracking when the extension is loaded
chrome.runtime.onStartup.addListener(() => {
  startTracking();
  setupDailyResetAlarm(); // Set up the midnight reset alarm
});

// Track active tab and time spent
let activeTabId = null;
let activeTabUrl = null;
let activeTabDomain = null;
let activeTabStartTime = null;
let isTimerRunning = false;
let timerType = 'pomodoro';
let timerEndTime = null;
let trackingInterval = null;
let lastUpdateTime = Date.now(); // Track last update time
let currentDateStr = new Date().toISOString().split('T')[0]; // Current date string
let isWindowActive = false; // Track if browser window is active
let timerInterval = null;
let pausedTimeRemaining = null;
let pomodoroCount = 0;

// Start the time tracking functionality
function startTracking() {
  // Clear any existing interval to avoid duplicates
  if (trackingInterval) {
    clearInterval(trackingInterval);
  }
  
  // Set up interval to update time spent periodically
  trackingInterval = setInterval(() => {
    // Check if the date has changed
    checkDateChange();
    
    // Update time spent on active tab
    if (activeTabId !== null && activeTabDomain !== null && isWindowActive) {
      updateTimeSpent();
    }
  }, 1000);
  
  // Set up listeners for tab changes
  chrome.tabs.onActivated.addListener(activeInfo => {
    if (!isWindowActive) return; // Only track if window is active
    
    // Save time spent on previous tab before switching
    if (activeTabId !== null && activeTabDomain !== null) {
      updateTimeSpent();
    }
    
    // Get info about newly activated tab
    chrome.tabs.get(activeInfo.tabId, tab => {
      if (chrome.runtime.lastError) {
        console.log('Error getting tab info:', chrome.runtime.lastError);
        return;
      }
      
      activeTabId = tab.id;
      activeTabUrl = tab.url;
      activeTabDomain = extractDomain(tab.url);
      activeTabStartTime = Date.now();
      
      // Notify popup of tab change
      chrome.runtime.sendMessage({ action: 'tabChanged', domain: activeTabDomain })
        .catch(() => {
          // Ignore errors when popup is not open
          console.log('Popup not available, ignoring tabChanged message');
        });
    });
  });
  
  // Listen for tab updates (URL changes in the same tab)
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!isWindowActive) return; // Only track if window is active
    
    // Only process if this is the active tab and URL has changed
    if (tabId === activeTabId && changeInfo.url) {
      // Save time spent on previous URL
      if (activeTabDomain !== null) {
        updateTimeSpent();
      }
      
      // Update to new URL
      activeTabUrl = changeInfo.url;
      activeTabDomain = extractDomain(changeInfo.url);
      activeTabStartTime = Date.now();
      
      // Notify popup of URL change
      chrome.runtime.sendMessage({ action: 'tabChanged', domain: activeTabDomain })
        .catch(() => {
          // Ignore errors when popup is not open
          console.log('Popup not available, ignoring tabChanged message');
        });
    }
  });
  
  // Track window focus changes
  chrome.windows.onFocusChanged.addListener(windowId => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      // Window lost focus
      isWindowActive = false;
      
      // Save time spent on current tab
      if (activeTabId !== null && activeTabDomain !== null) {
        updateTimeSpent();
      }
    } else {
      // Window gained focus
      isWindowActive = true;
      
      // Get the active tab in the focused window
      chrome.tabs.query({ active: true, windowId: windowId }, tabs => {
        if (tabs.length > 0) {
          const tab = tabs[0];
          
          // If different from current active tab, save time spent
          if (activeTabId !== tab.id) {
            if (activeTabId !== null && activeTabDomain !== null) {
              updateTimeSpent();
            }
            
            // Update to new active tab
            activeTabId = tab.id;
            activeTabUrl = tab.url;
            activeTabDomain = extractDomain(tab.url);
            activeTabStartTime = Date.now();
            
            // Notify popup of tab change
            chrome.runtime.sendMessage({ action: 'tabChanged', domain: activeTabDomain })
              .catch(() => {
                // Ignore errors when popup is not open
                console.log('Popup not available, ignoring tabChanged message');
              });
          }
        }
      });
    }
  });
}

// Check if the date has changed, and reset daily usage if it has
function checkDateChange() {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  if (todayStr !== currentDateStr) {
    console.log(`Date changed from ${currentDateStr} to ${todayStr}`);
    currentDateStr = todayStr;
    
    // Handle the date change (midnight reset)
    handleDailyReset();
  }
}

// Handle the daily reset at midnight
function handleDailyReset() {
  console.log('Performing daily reset');
  
  // Get current websites data
  chrome.storage.local.get('websites', (result) => {
    if (!result.websites) return;
    
    const websites = result.websites;
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    
    // Reset daily usage for the new day
    websites.forEach(website => {
      if (!website.dailyUsage) {
        website.dailyUsage = {};
      }
      
      // Initialize the new day with zero time
      website.dailyUsage[dateString] = 0;
    });
    
    // Save updated websites data
    chrome.storage.local.set({ websites });
  });
}

// Set up an alarm to reset at midnight
function setupDailyResetAlarm() {
  // Calculate time until next midnight
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();
  
  // Create an alarm for midnight
  chrome.alarms.create('dailyReset', {
    when: Date.now() + msUntilMidnight
  });
}

// Update time spent on the current tab
function updateTimeSpent() {
  if (!activeTabId || !activeTabDomain) return;
  
  // Skip chrome:// URLs and other special protocols
  if (activeTabDomain.includes('chrome://') || !activeTabUrl || activeTabUrl.startsWith('chrome')) {
    return;
  }
  
  // Calculate time spent
  const now = Date.now();
  const timeSpent = Math.round((now - activeTabStartTime) / 1000); // in seconds
  
  // Reset start time for next calculation
  activeTabStartTime = now;
  
  // Skip if no meaningful time has passed
  if (timeSpent <= 0) return;
  
  // Get existing website data
  chrome.storage.local.get(['websites', 'extensionEnabled'], (result) => {
    // Skip if extension is disabled
    if (result.extensionEnabled === false) return;
    
    const websites = result.websites || [];
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    
    // Find or create website entry
    let website = websites.find(site => site.domain === activeTabDomain);
    
    if (!website) {
      // New website, create entry
      website = { 
        domain: activeTabDomain,
        timeSpent: 0,
        dailyUsage: {}
      };
      websites.push(website);
    }
    
    // Ensure dailyUsage exists
    if (!website.dailyUsage) {
      website.dailyUsage = {};
    }
    
    // Ensure today's entry exists
    if (!website.dailyUsage[dateString]) {
      website.dailyUsage[dateString] = 0;
    }
    
    // Update time spent
    website.timeSpent = (website.timeSpent || 0) + timeSpent;
    website.dailyUsage[dateString] = (website.dailyUsage[dateString] || 0) + timeSpent;
    
    // Save updated data
    chrome.storage.local.set({ websites }, () => {
      // Notify popup of time update
      chrome.runtime.sendMessage({ 
        action: 'timeUpdated', 
        domain: activeTabDomain,
        timeSpent: website.timeSpent,
        dailyTimeSpent: website.dailyUsage[dateString]
      }).catch(() => {
        // Ignore errors when popup is not open
        console.log('Popup not available, ignoring timeUpdated message');
      });
      
      // Check if time limit is reached
      if (website.timeLimit) {
        const timeLimit = website.timeLimit * 60; // convert minutes to seconds
        if (website.dailyUsage[dateString] >= timeLimit) {
          // Time limit reached - send message to content script to block page
          chrome.tabs.sendMessage(activeTabId, { action: 'blockPage' });
        }
      }
    });
  });
}

// Extract domain from URL
function extractDomain(url) {
  if (!url) return null;
  
  try {
    // Parse URL
    const urlObj = new URL(url);
    
    // Get hostname (domain with www if present)
    return urlObj.hostname;
  } catch (error) {
    console.error("Error extracting domain:", error);
    return null;
  }
}

// Show a notification using a simple alert
function showNotification(title, message) {
  console.log('SHOWING ALERT:', title, message);
  
  // Create a simple alert in the active tab
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs.length > 0) {
      try {
        chrome.scripting.executeScript({
          target: {tabId: tabs[0].id},
          func: function(title, message) {
            // The alert function is available in content script context
            alert(title + "\n\n" + message);
          },
          args: [title, message]
        });
      } catch (error) {
        console.error('Error showing alert:', error);
      }
    } else {
      console.error('No active tab found to show alert');
    }
  });
}

// Pomodoro Timer functionality
function startTimer(requestedType) {
  console.log('Starting timer. Type:', requestedType || timerType);
  
  chrome.storage.local.get('pomodoroSettings', (result) => {
    const settings = result.pomodoroSettings || {
      pomodoro: 25,
      shortBreak: 5,
      longBreak: 15,
      longBreakInterval: 4,
      autoStartBreaks: true,
      autoStartPomodoros: true
    };
    
    // If we're resuming from pause
    if (isTimerRunning === false && pausedTimeRemaining !== null) {
      const duration = pausedTimeRemaining;
      timerEndTime = Date.now() + duration * 1000;
      isTimerRunning = true;
      
      // Start interval to check when timer completes
      startTimerInterval();
      
      // Reset paused time
      pausedTimeRemaining = null;
      console.log('Resumed timer with', duration, 'seconds remaining');
      return;
    }
    
    // Determine which timer to start
    if (requestedType) {
      timerType = requestedType;
    }
    
    // Get duration based on timer type
    let duration;
    switch (timerType) {
      case 'pomodoro':
        duration = settings.pomodoro * 60;
        break;
      case 'shortBreak':
        duration = settings.shortBreak * 60;
        break;
      case 'longBreak':
        duration = settings.longBreak * 60;
        break;
      default:
        duration = settings.pomodoro * 60;
        break;
    }
    
    // Calculate end time
    timerEndTime = Date.now() + duration * 1000;
    isTimerRunning = true;
    
    // Start interval to check when timer completes
    startTimerInterval();
    
    console.log(`Started ${timerType} timer for ${duration} seconds. Will end at: ${new Date(timerEndTime).toLocaleTimeString()}`);
    
    // Only show notification on manual start (when not auto-transitioning)
    if (!requestedType) {
      if (timerType === 'pomodoro') {
        showNotification('Pomodoro Started', 'Focus time has begun. Stay focused!');
      } else if (timerType === 'shortBreak') {
        showNotification('Short Break Started', 'Take a quick break. Stand up, stretch, or look away from the screen.');
      } else if (timerType === 'longBreak') {
        showNotification('Long Break Started', 'Time for a longer break. Get up and move around!');
      }
    }
  });
}

// Start the timer interval to check for completion
function startTimerInterval() {
  // Clear any existing interval
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  // Set up new interval - check once per second
  timerInterval = setInterval(() => {
    // Check if timer has completed
    const now = Date.now();
    
    if (now >= timerEndTime) {
      console.log('Timer completed at', new Date().toLocaleTimeString());
      timerCompleted();
    }
  }, 1000); // Check once per second
}

// Handle timer completion
function timerCompleted() {
  // Clear interval
  clearInterval(timerInterval);
  console.log("TIMER COMPLETED");
  
  // Get settings
  chrome.storage.local.get('pomodoroSettings', (result) => {
    const settings = result.pomodoroSettings || {
      pomodoro: 25,
      shortBreak: 5,
      longBreak: 15,
      longBreakInterval: 4,
      autoStartBreaks: true,
      autoStartPomodoros: true
    };
    
    // Track what type of timer just completed
    const completedTimerType = timerType;
    console.log(`Timer of type ${completedTimerType} completed`);
    
    // Handle completion based on timer type
    if (completedTimerType === 'pomodoro') {
      // Increment pomodoro count
      pomodoroCount++;
      
      // Determine next timer type
      if (pomodoroCount % settings.longBreakInterval === 0) {
        timerType = 'longBreak';
        console.log(`Pomodoro count: ${pomodoroCount}. Starting long break.`);
        
        // Show single notification for pomodoro completion + long break
        showNotification(
          'Pomodoro Completed', 
          'Great work! Time for a long break. Get up and move around.'
        );
      } else {
        timerType = 'shortBreak';
        console.log(`Pomodoro count: ${pomodoroCount}. Starting short break.`);
        
        // Show single notification for pomodoro completion + short break
        showNotification(
          'Pomodoro Completed', 
          'Good job! Time for a short break. Stretch and relax for a moment.'
        );
      }
      
      // Make sure we're set to not running temporarily
      isTimerRunning = false;
      
      // Always auto-start breaks (with a small delay for notification)
      setTimeout(() => {
        console.log(`Auto-starting ${timerType}`);
        startTimer(timerType);
      }, 1500);
      
    } else {
      // Break completed - show notification and start new pomodoro
      showNotification(
        'Break Completed', 
        'Break time is over. Ready to focus again? Starting a new Pomodoro session.'
      );
      
      // Next timer is a pomodoro
      timerType = 'pomodoro';
      
      // Make sure we're set to not running temporarily
      isTimerRunning = false;
      
      // Always auto-start pomodoro (with a small delay for notification)
      setTimeout(() => {
        console.log("Auto-starting new pomodoro");
        startTimer('pomodoro');
      }, 1500);
    }
    
    // Try to notify popup of completion
    chrome.runtime.sendMessage({ 
      action: 'timerCompleted',
      nextTimerType: timerType,
      isAutoStarting: true, // Always auto-start
      pomodoroCount: pomodoroCount
    }).catch(() => {
      // Ignore errors when popup is not open
      console.log('Popup not available, ignoring timerCompleted message');
    });
  });
}

// Pause the timer
function pauseTimer() {
  if (isTimerRunning && timerEndTime) {
    // Calculate remaining time in seconds
    pausedTimeRemaining = Math.max(0, Math.floor((timerEndTime - Date.now()) / 1000));
    
    // Stop the timer
    isTimerRunning = false;
    clearInterval(timerInterval);
  }
}

// Resume the timer from a paused state
function resumeTimer() {
  // If we have paused time, continue from there
  if (pausedTimeRemaining !== null) {
    timerEndTime = Date.now() + (pausedTimeRemaining * 1000);
    isTimerRunning = true;
    
    // Start interval to check when timer completes
    startTimerInterval();
    
    // Reset paused time
    pausedTimeRemaining = null;
  }
}

// Reset the timer
function resetTimer() {
  // Stop any running timer
  isTimerRunning = false;
  clearInterval(timerInterval);
  timerEndTime = null;
  pausedTimeRemaining = null;
  
  // Reset to pomodoro type
  timerType = 'pomodoro';
}

// Debug function to dump storage contents to console
function dumpStorage() {
  chrome.storage.local.get(null, (items) => {
    console.log('All storage items:', items);
  });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received:', message.action);
  
  switch (message.action) {
    case 'getActiveTabInfo':
      sendResponse({
        domain: activeTabDomain,
        isTimerRunning: isTimerRunning,
        timerType: timerType,
        timerEndTime: timerEndTime,
        pomodoroCount: pomodoroCount,
        timeRemaining: timerEndTime ? Math.max(0, Math.floor((timerEndTime - Date.now()) / 1000)) : null
      });
      break;
    case 'startTimer':
      startTimer(message.timerType);
      sendResponse({ success: true });
      break;
    case 'pauseTimer':
      pauseTimer();
      sendResponse({ success: true });
      break;
    case 'resumeTimer':
      resumeTimer();
      sendResponse({ success: true });
      break;
    case 'resetTimer':
      resetTimer();
      sendResponse({ success: true });
      break;
    case 'testNotification':
      showNotification(message.title || 'Test', message.message || 'This is a test notification');
      sendResponse({ success: true });
      break;
    case 'openPopup':
      // This is called from the blocked page
      chrome.action.openPopup();
      sendResponse({ success: true });
      break;
    case 'forceTimeUpdate':
      // Force an immediate time update when popup requests it
      if (activeTabId !== null && activeTabDomain !== null) {
        updateTimeSpent();
      }
      sendResponse({ success: true });
      break;
    case 'resetTimeData':
      // Reset all time data (for debugging)
      chrome.storage.local.get('websites', (result) => {
        if (!result.websites) {
          sendResponse({ success: false });
          return;
        }
        
        const websites = result.websites;
        const today = new Date();
        const dateString = today.toISOString().split('T')[0];
        
        websites.forEach(website => {
          if (!website.dailyUsage) {
            website.dailyUsage = {};
          }
          website.dailyUsage[dateString] = 0;
        });
        
        chrome.storage.local.set({ websites: websites }, () => {
          dumpStorage();
          sendResponse({ success: true });
        });
      });
      return true; // For async response
    case 'dumpStorage':
      // Dump storage to console (for debugging)
      dumpStorage();
      sendResponse({ success: true });
      break;
  }
  return true;
});

// Handle alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyReset') {
    // Handle midnight reset
    handleDailyReset();
  }
}); 