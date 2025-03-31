// Initialize storage with default values if not set
chrome.runtime.onInstalled.addListener(() => {
  console.log('[DEBUG] Extension installed or updated');
  chrome.storage.local.get(['websites', 'pomodoroSettings', 'extensionEnabled'], (result) => {
    if (!result.websites) {
      console.log('[DEBUG] Initializing websites array');
      chrome.storage.local.set({ websites: [] });
    }
    
    if (!result.pomodoroSettings) {
      console.log('[DEBUG] Initializing pomodoro settings');
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
      console.log('[DEBUG] Setting extension enabled state');
      chrome.storage.local.set({ extensionEnabled: true });
    }
    
    startTracking();
  });
});

// Start tracking when the extension is loaded
chrome.runtime.onStartup.addListener(() => {
  console.log('[DEBUG] Extension startup detected');
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
let isWindowActive = true; // Track if browser window is active - START ASSUMING ACTIVE
let timerInterval = null;
let pausedTimeRemaining = null;
let pomodoroCount = 0;
let forceContinueTracking = true; // Start with forced tracking ENABLED
let lastTrackedTime = Date.now(); // When we last recorded time
let lastActivityTime = Date.now(); // Last time we detected user activity in the browser
let activityCheckInterval = null; // Interval to check for user activity
let isRecovering = false;

// Start the time tracking functionality
function startTracking() {
  console.log('[DEBUG] Starting tracking functionality');
  // Clear any existing interval to avoid duplicates
  if (trackingInterval) {
    clearInterval(trackingInterval);
  }
  
  if (activityCheckInterval) {
    clearInterval(activityCheckInterval);
  }
  
  // Detect browser info for diagnostics
  const userAgent = navigator.userAgent;
  console.log('[BROWSER INFO] User Agent:', userAgent);
  
  // Set initial active tab
  initializeActiveTab();
  
  // Set up interval to check for actual browser activity - separate from tracking interval
  activityCheckInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceActivity = now - lastActivityTime;
    
    // If no activity detected for 15 seconds, consider browser inactive
    // This helps distinguish between Brave's incorrect focus events and actual inactivity
    if (timeSinceActivity > 15000) {
      if (forceContinueTracking) {
        console.log('[ACTIVITY] No browser activity detected for 15 seconds, pausing tracking');
        forceContinueTracking = false;
        
        // Save time before stopping tracking
        if (activeTabId !== null && activeTabDomain !== null) {
          console.log('[ACTIVITY] Saving time before pausing due to inactivity');
          updateTimeSpent();
          
          // IMPORTANT FIX: Update the start time to the current time
          // This prevents counting inactive time when activity resumes
          activeTabStartTime = now;
        }
      }
    }
  }, 5000); // Check every 5 seconds
  
  // Set up interval to update time spent periodically
  trackingInterval = setInterval(() => {
    // Check if the date has changed
    checkDateChange();
    
    // FIXED TRACKING LOGIC:
    // 1. If window is active and we have a tab, ALWAYS update time
    // 2. If window is not active but forcing is enabled, update time
    if (activeTabId !== null && activeTabDomain !== null) {
      if (isWindowActive) {
        // Always update when window is active, regardless of forcing
        updateTimeSpent();
      } else if (forceContinueTracking) {
        // Update when window is not active only if forcing is enabled
        updateTimeSpent();
      }
    } else if (!activeTabId && !activeTabDomain) {
      // If we somehow don't have an active tab yet, try to initialize
      console.log('[RECOVERY] Trying to initialize active tab since none is detected');
      initializeActiveTab();
    }
    
    // Run state verification every 60 seconds
    if (Date.now() % 60000 < 1000) {
      // Periodically verify our tracking state 
      verifyTrackingState();
    }
  }, 30000); // Run every 30 seconds
  
  // Set up listeners for tab changes
  chrome.tabs.onActivated.addListener(activeInfo => {
    updateLastActivityTime();
    console.log('[DEBUG] Tab activated event:', activeInfo.tabId);
    
    // Check if we've had recent activity (within last 5 seconds)
    const timeSinceActivity = Date.now() - lastActivityTime;
    if (timeSinceActivity > 5000) {
      console.log('[DEBUG] No recent activity, ignoring tab change');
      return;
    }
    
    // Save time spent on previous tab before switching
    if (activeTabId !== null && activeTabDomain !== null) {
      console.log('[DEBUG] Saving time for previous tab before switch:', activeTabId, activeTabDomain);
      updateTimeSpent();
    }
    
    // Get info about newly activated tab
    chrome.tabs.get(activeInfo.tabId, tab => {
      if (chrome.runtime.lastError) {
        console.log('[ERROR] Error getting tab info:', chrome.runtime.lastError);
        return;
      }
      
      activeTabId = tab.id;
      activeTabUrl = tab.url;
      activeTabDomain = extractDomain(tab.url);
      activeTabStartTime = Date.now();
      
      console.log('[DEBUG] New active tab:', activeTabId, activeTabDomain);
      
      // Notify popup of tab change
      chrome.runtime.sendMessage({ action: 'tabChanged', domain: activeTabDomain })
        .catch((error) => {
          // Ignore errors when popup is not open
          console.log('[DEBUG] Popup not available, ignoring tabChanged message');
        });
    });
  });
  
  // Listen for tab updates (URL changes in the same tab)
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    updateLastActivityTime();
    if (changeInfo.url) {
      console.log('[DEBUG] Tab URL updated:', tabId, changeInfo.url);
    }
    
    // Check if we've had recent activity (within last 5 seconds)
    const timeSinceActivity = Date.now() - lastActivityTime;
    if (timeSinceActivity > 5000) {
      console.log('[DEBUG] No recent activity, ignoring URL change');
      return;
    }
    
    // Only process if this is the active tab and URL has changed
    if (tabId === activeTabId && changeInfo.url) {
      console.log('[DEBUG] Active tab URL changed:', tabId, changeInfo.url);
      
      // Save time spent on previous URL
      if (activeTabDomain !== null) {
        console.log('[DEBUG] Saving time for previous URL before update');
        updateTimeSpent();
      }
      
      // Update to new URL
      activeTabUrl = changeInfo.url;
      activeTabDomain = extractDomain(changeInfo.url);
      activeTabStartTime = Date.now();
      
      console.log('[DEBUG] Updated active tab domain:', activeTabDomain);
      
      // Notify popup of URL change
      chrome.runtime.sendMessage({ action: 'tabChanged', domain: activeTabDomain })
        .catch((error) => {
          // Ignore errors when popup is not open
          console.log('[DEBUG] Popup not available, ignoring tabChanged message');
        });
    }
  });
  
  // Track window focus changes
  chrome.windows.onFocusChanged.addListener(windowId => {
    console.log('[DEBUG] Window focus changed:', windowId);
    
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      // Window lost focus
      console.log('[DEBUG] Window lost focus');
      isWindowActive = false;
      
      // Save time spent on current tab
      if (activeTabId !== null && activeTabDomain !== null) {
        console.log('[DEBUG] Saving time before window focus lost');
        updateTimeSpent();
      }
      
      // In Brave, enable forced tracking when focus is lost
      // BUT only if we've had activity recently (last 5 seconds)
      if (activeTabId !== null && activeTabDomain !== null) {
        const timeSinceActivity = Date.now() - lastActivityTime;
        if (timeSinceActivity < 5000) {
          console.log('[WORKAROUND] Enabling forced tracking after window focus lost');
          forceContinueTracking = true;
        } else {
          console.log('[DEBUG] Not enabling forced tracking - no recent activity');
          forceContinueTracking = false;
        }
      }
    } else {
      // Window gained focus - definitely active
      console.log('[DEBUG] Window gained focus');
      isWindowActive = true;
      updateLastActivityTime(); // Update activity time
      
      // Get the active tab in the focused window
      chrome.tabs.query({ active: true, windowId: windowId }, tabs => {
        if (tabs.length > 0) {
          console.log('[DEBUG] Got active tab in focused window:', tabs[0].id);
          const tab = tabs[0];
          
          // If different from current active tab, save time spent
          if (activeTabId !== tab.id) {
            console.log('[DEBUG] Active tab changed with window focus');
            
            if (activeTabId !== null && activeTabDomain !== null) {
              console.log('[DEBUG] Saving time for previous tab');
              updateTimeSpent();
            }
            
            // Update to new active tab
            activeTabId = tab.id;
            activeTabUrl = tab.url;
            activeTabDomain = extractDomain(tab.url);
            activeTabStartTime = Date.now();
            
            console.log('[DEBUG] New active tab with window focus:', activeTabId, activeTabDomain);
            
            // Notify popup of tab change
            chrome.runtime.sendMessage({ action: 'tabChanged', domain: activeTabDomain })
              .catch((error) => {
                // Ignore errors when popup is not open
                console.log('[DEBUG] Popup not available, ignoring tabChanged message');
              });
          }
        } else {
          console.log('[DEBUG] No active tab found in focused window');
        }
      });
    }
  });
}

// Initialize active tab information
function initializeActiveTab() {
  // Enable force tracking by default - crucial for Brave compatibility
  forceContinueTracking = true;
  isWindowActive = true; // Assume window is active when initializing
  
  // Query the current active tab
  chrome.tabs.query({active: true, lastFocusedWindow: true}, tabs => {
    if (tabs && tabs.length > 0) {
      const tab = tabs[0];
      const domain = extractDomain(tab.url);
      
      console.log('[INIT] Setting initial active tab:', tab.id, domain);
      
      // Initialize tracking with this tab
      activeTabId = tab.id;
      activeTabUrl = tab.url;
      activeTabDomain = domain;
      activeTabStartTime = Date.now();
      lastTrackedTime = Date.now();
      
      // Enable forced tracking since we have a tab to track
      forceContinueTracking = true;
    } else {
      console.log('[INIT] Could not find active tab for initialization');
    }
  });
}

// Verify tracking state periodically and recover if needed
function verifyTrackingState() {
  // Check what tab actually is active
  chrome.tabs.query({active: true, lastFocusedWindow: true}, tabs => {
    if (tabs && tabs.length > 0) {
      const currentTab = tabs[0];
      const currentDomain = extractDomain(currentTab.url);
      
      // Update last tracked time whenever we see activity
      if (currentTab.id === activeTabId) {
        lastTrackedTime = Date.now();
      }
      
      // If we've lost or changed which tab we're tracking, recover
      if (!activeTabId || currentTab.id !== activeTabId || currentDomain !== activeTabDomain) {
        console.log('[STATE MISMATCH] Actual active tab differs from tracked tab',
                    {tracked: {id: activeTabId, domain: activeTabDomain},
                     actual: {id: currentTab.id, domain: currentDomain}});
        
        // Fix the tracking state
        if (activeTabId !== null && activeTabDomain !== null) {
          // Save time for previous tab
          updateTimeSpent();
        }
        
        // Update to current tab
        activeTabId = currentTab.id;
        activeTabUrl = currentTab.url;
        activeTabDomain = currentDomain;
        activeTabStartTime = Date.now();
        lastTrackedTime = Date.now();
        
        // Enable forced tracking since we have a recent user action
        forceContinueTracking = true;
        
        console.log('[RECOVERY] Tracking state corrected to match actual active tab');
      }
    } else if (isWindowActive && !activeTabId) {
      // If we think the window is active but have no tab, something's wrong
      console.log('[STATE MISMATCH] Window active but no active tab detected');
      
      // Try to reinitialize
      initializeActiveTab();
    }
  });
}

// Check if the date has changed, and reset daily usage if it has
function checkDateChange() {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  if (todayStr !== currentDateStr) {
    console.log(`[DEBUG] Date changed from ${currentDateStr} to ${todayStr}`);
    currentDateStr = todayStr;
    
    // Handle the date change (midnight reset)
    handleDailyReset();
  }
}

// Handle the daily reset at midnight
function handleDailyReset() {
  console.log('[DEBUG] Starting daily reset');
  
  // Store current active tab info before reset
  const previousActiveTab = activeTabId;
  const previousStartTime = activeTabStartTime;
  
  // Clear all data
  chrome.storage.local.clear(() => {
    if (chrome.runtime.lastError) {
      console.error('[ERROR] Failed to clear storage:', chrome.runtime.lastError);
      return;
    }
    
    // Restore active tab state if it was valid
    if (previousActiveTab && previousStartTime) {
      chrome.tabs.get(previousActiveTab, (tab) => {
        if (!chrome.runtime.lastError && tab) {
          console.log('[DEBUG] Restoring previous active tab state');
          activeTabId = previousActiveTab;
          activeTabStartTime = previousStartTime;
        }
      });
    }
    
    // Reset other state variables
    currentDateStr = new Date().toISOString().split('T')[0];
    activeTabId = null;
    activeTabStartTime = null;
    lastActiveInfo = null;
    knownTabs = new Set();
    
    // Reinitialize tracking
    setupDailyResetAlarm();
    startBackupPolling();
    
    // Validate and recover state
    validateAndRecoverState();
    
    console.log('[DEBUG] Daily reset completed');
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
  
  console.log('[DEBUG] Daily reset alarm set for:', midnight.toString());
}

// Extract domain from URL
function extractDomain(url) {
  if (!url) {
    console.log('[ERROR] Attempted to extract domain from null/empty URL');
    return null;
  }
  
  try {
    // Parse URL
    const urlObj = new URL(url);
    
    // Get hostname (domain with www if present)
    const domain = urlObj.hostname;
    console.log('[DEBUG] Extracted domain:', domain, 'from URL:', url.substring(0, 50) + (url.length > 50 ? '...' : ''));
    return domain;
  } catch (error) {
    console.error("[ERROR] Error extracting domain:", error, "URL:", url);
    return null;
  }
}

// Update time spent on the current tab
function updateTimeSpent() {
  if (!activeTabId || !activeTabDomain) {
    // Skip silently
    return;
  }
  
  // Skip chrome:// URLs and other special protocols
  if (activeTabDomain.includes('chrome://') || !activeTabUrl || activeTabUrl.startsWith('chrome')) {
    // Skip silently
    return;
  }
  
  // Calculate time spent
  const now = Date.now();
  const timeSpent = Math.round((now - activeTabStartTime) / 1000); // in seconds
  
  // Reset start time for next calculation
  activeTabStartTime = now;
  
  // Skip if no meaningful time has passed
  if (timeSpent <= 0) {
    // Skip silently
    return;
  }
  
  // Only log the time update - this is what we want to keep visible
  console.log(`[DEBUG] Updating time for ${activeTabDomain}: +${timeSpent} seconds`);
  
  // Get existing website data
  chrome.storage.local.get(['websites', 'extensionEnabled'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('[ERROR] Failed to get website data:', chrome.runtime.lastError);
      return;
    }
    
    // Skip if extension is disabled
    if (result.extensionEnabled === false) {
      return;
    }
    
    const websites = result.websites || [];
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    
    // Find or create website entry
    let website = websites.find(site => site.domain === activeTabDomain);
    
    if (!website) {
      // New website, create entry
      console.log('[DEBUG] Creating new website entry for:', activeTabDomain);
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
    
    const oldTimeSpent = website.timeSpent || 0;
    const oldDailyTimeSpent = website.dailyUsage[dateString] || 0;
    
    // Update time spent
    website.timeSpent = oldTimeSpent + timeSpent;
    website.dailyUsage[dateString] = oldDailyTimeSpent + timeSpent;
    
    // Log the updated time - keep this visible as it shows the running totals
    console.log(`[DEBUG] Updated time for ${activeTabDomain}: Total = ${website.timeSpent}s, Today = ${website.dailyUsage[dateString]}s`);
    
    // Save updated data
    chrome.storage.local.set({ websites }, () => {
      if (chrome.runtime.lastError) {
        console.error('[ERROR] Failed to save updated website data:', chrome.runtime.lastError);
        return;
      }
      
      // No need to log successful save
      
      // Notify popup of time update
      chrome.runtime.sendMessage({ 
        action: 'timeUpdated', 
        domain: activeTabDomain,
        timeSpent: website.timeSpent,
        dailyTimeSpent: website.dailyUsage[dateString]
      }).catch((error) => {
        // Ignore errors when popup is not open - no need to log these
      });
      
      // Check if time limit is reached
      if (website.timeLimit) {
        const timeLimit = website.timeLimit * 60; // convert minutes to seconds
        if (website.dailyUsage[dateString] >= timeLimit) {
          // Time limit reached - send message to content script to block page
          console.log('[DEBUG] Time limit reached for:', activeTabDomain, 'attempting to block');
          chrome.tabs.sendMessage(activeTabId, { action: 'blockPage' })
            .catch(error => {
              console.error('[ERROR] Failed to send block message:', error);
            });
        }
      }
    });
  });
}

// Show a notification using a simple alert
function showNotification(title, message) {
  console.log('[DEBUG] SHOWING ALERT:', title, message);
  
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
        }).then(() => {
          console.log('[DEBUG] Alert shown successfully');
        }).catch(err => {
          console.error('[ERROR] Alert execution failed:', err);
        });
      } catch (error) {
        console.error('[ERROR] Error showing alert:', error);
      }
    } else {
      console.error('[ERROR] No active tab found to show alert');
    }
  });
}

// Pomodoro Timer functionality
function startTimer(requestedType) {
  console.log('[DEBUG] Starting timer. Type:', requestedType || timerType);
  
  chrome.storage.local.get('pomodoroSettings', (result) => {
    if (chrome.runtime.lastError) {
      console.error('[ERROR] Failed to get pomodoro settings:', chrome.runtime.lastError);
      return;
    }
    
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
      console.log('[DEBUG] Resumed timer with', duration, 'seconds remaining');
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
    
    console.log(`[DEBUG] Started ${timerType} timer for ${duration} seconds. Will end at: ${new Date(timerEndTime).toLocaleTimeString()}`);
    
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

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[DEBUG] Message received:', message.action);
  
  switch (message.action) {
    case 'getActiveTabInfo':
      console.log('[DEBUG] Sending active tab info:', {
        domain: activeTabDomain,
        isTimerRunning,
        timerType,
        timeRemaining: timerEndTime ? Math.max(0, Math.floor((timerEndTime - Date.now()) / 1000)) : null
      });
      
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
      console.log('[DEBUG] Starting timer via message:', message.timerType);
      startTimer(message.timerType);
      sendResponse({ success: true });
      break;
      
    case 'pauseTimer':
      console.log('[DEBUG] Pausing timer via message');
      pauseTimer();
      sendResponse({ success: true });
      break;
      
    case 'resumeTimer':
      console.log('[DEBUG] Resuming timer via message');
      resumeTimer();
      sendResponse({ success: true });
      break;
      
    case 'resetTimer':
      console.log('[DEBUG] Resetting timer via message');
      resetTimer();
      sendResponse({ success: true });
      break;
      
    case 'testNotification':
      console.log('[DEBUG] Showing test notification:', message.title, message.message);
      showNotification(message.title || 'Test', message.message || 'This is a test notification');
      sendResponse({ success: true });
      break;
      
    case 'openPopup':
      console.log('[DEBUG] Opening popup via message');
      // This is called from the blocked page
      chrome.action.openPopup();
      sendResponse({ success: true });
      break;
      
    case 'forceTimeUpdate':
      console.log('[DEBUG] Force updating time via message');
      // Force an immediate time update when popup requests it
      if (activeTabId !== null && activeTabDomain !== null) {
        updateTimeSpent();
      }
      sendResponse({ success: true });
      break;
      
    case 'resetTimeData':
      console.log('[DEBUG] Resetting time data via message');
      // Reset all time data (for debugging)
      chrome.storage.local.get('websites', (result) => {
        if (!result.websites) {
          console.log('[ERROR] No websites data found to reset');
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
          if (chrome.runtime.lastError) {
            console.error('[ERROR] Failed to reset time data:', chrome.runtime.lastError);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          
          console.log('[DEBUG] Time data reset successfully');
          dumpStorage();
          sendResponse({ success: true });
        });
      });
      return true; // For async response
      
    case 'dumpStorage':
      console.log('[DEBUG] Dumping storage via message');
      // Dump storage to console (for debugging)
      dumpStorage();
      sendResponse({ success: true });
      break;
      
    case 'extensionHealthCheck':
      console.log('[DEBUG] Running health check');
      // Add a health check command for diagnostics
      const health = {
        activeTabId,
        activeTabDomain,
        isWindowActive,
        timerRunning: isTimerRunning,
        timestamp: Date.now(),
        storageFunctional: false
      };
      
      // Test storage functionality
      chrome.storage.local.get('websites', (result) => {
        if (chrome.runtime.lastError) {
          health.storageError = chrome.runtime.lastError.message;
        } else {
          health.storageFunctional = true;
          health.websitesCount = result.websites ? result.websites.length : 0;
        }
        
        console.log('[HEALTH CHECK]', health);
        sendResponse({ health });
      });
      return true; // For async response
      
    case 'debug':
      switch (message.command) {
        case 'simulateReset':
          console.log('[DEBUG] Simulating midnight reset...');
          handleDailyReset();
          sendResponse({ success: true, message: 'Reset simulation triggered' });
          break;
        case 'validateState':
          console.log('[DEBUG] Validating current state...');
          validateAndRecoverState();
          sendResponse({ success: true, message: 'State validation triggered' });
          break;
        case 'getState':
          const state = {
            activeTabId,
            activeTabStartTime,
            currentDateStr,
            lastActiveInfo,
            knownTabs: Array.from(knownTabs)
          };
          sendResponse({ success: true, state });
          break;
        default:
          sendResponse({ success: false, message: 'Unknown debug command' });
      }
      return true;
      
    default:
      console.log('[DEBUG] Unknown message action:', message.action);
      sendResponse({ success: false, error: 'Unknown action' });
  }
  
  return true; // Keep channel open for async response
});

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
      console.log('[DEBUG] Timer completed at', new Date().toLocaleTimeString());
      timerCompleted();
    }
  }, 1000); // Check once per second
}

// Handle timer completion
function timerCompleted() {
  // Clear interval
  clearInterval(timerInterval);
  console.log("[DEBUG] TIMER COMPLETED");
  
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
    console.log(`[DEBUG] Timer of type ${completedTimerType} completed`);
    
    // Handle completion based on timer type
    if (completedTimerType === 'pomodoro') {
      // Increment pomodoro count
      pomodoroCount++;
      
      // Determine next timer type
      if (pomodoroCount % settings.longBreakInterval === 0) {
        timerType = 'longBreak';
        console.log(`[DEBUG] Pomodoro count: ${pomodoroCount}. Starting long break.`);
        
        // Show single notification for pomodoro completion + long break
        showNotification(
          'Pomodoro Completed', 
          'Great work! Time for a long break. Get up and move around.'
        );
      } else {
        timerType = 'shortBreak';
        console.log(`[DEBUG] Pomodoro count: ${pomodoroCount}. Starting short break.`);
        
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
        console.log(`[DEBUG] Auto-starting ${timerType}`);
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
        console.log("[DEBUG] Auto-starting new pomodoro");
        startTimer('pomodoro');
      }, 1500);
    }
    
    // Try to notify popup of completion
    chrome.runtime.sendMessage({ 
      action: 'timerCompleted',
      nextTimerType: timerType,
      isAutoStarting: true, // Always auto-start
      pomodoroCount: pomodoroCount
    }).catch((error) => {
      // Ignore errors when popup is not open
      console.log('[DEBUG] Popup not available, ignoring timerCompleted message');
    });
  });
}

// Pause the timer
function pauseTimer() {
  console.log('[DEBUG] Pausing timer');
  if (isTimerRunning && timerEndTime) {
    // Calculate remaining time in seconds
    pausedTimeRemaining = Math.max(0, Math.floor((timerEndTime - Date.now()) / 1000));
    
    // Stop the timer
    isTimerRunning = false;
    clearInterval(timerInterval);
    
    console.log('[DEBUG] Timer paused with', pausedTimeRemaining, 'seconds remaining');
  }
}

// Resume the timer from a paused state
function resumeTimer() {
  console.log('[DEBUG] Resuming timer');
  // If we have paused time, continue from there
  if (pausedTimeRemaining !== null) {
    timerEndTime = Date.now() + (pausedTimeRemaining * 1000);
    isTimerRunning = true;
    
    // Start interval to check when timer completes
    startTimerInterval();
    
    // Reset paused time
    pausedTimeRemaining = null;
    console.log('[DEBUG] Timer resumed, will end at', new Date(timerEndTime).toLocaleTimeString());
  } else {
    console.log('[DEBUG] Cannot resume timer - no paused time available');
  }
}

// Reset the timer
function resetTimer() {
  console.log('[DEBUG] Resetting timer');
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
    if (chrome.runtime.lastError) {
      console.error('[ERROR] Error getting storage items:', chrome.runtime.lastError);
      return;
    }
    
    console.log('[STORAGE] All storage items:', items);
    
    // Additional detailed logging for websites data
    if (items.websites && Array.isArray(items.websites)) {
      console.log('[STORAGE] Number of tracked websites:', items.websites.length);
      
      const today = new Date().toISOString().split('T')[0];
      
      items.websites.forEach((site, index) => {
        console.log(`[STORAGE] Website #${index+1}:`, {
          domain: site.domain,
          totalTime: site.timeSpent || 0,
          todayTime: site.dailyUsage && site.dailyUsage[today] ? site.dailyUsage[today] : 0,
          hasTimeLimit: !!site.timeLimit
        });
      });
    }
  });
}

// Handle alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('[DEBUG] Alarm triggered:', alarm.name);
  
  if (alarm.name === 'dailyReset') {
    // Handle midnight reset
    handleDailyReset();
  }
});

// Track tab activity to detect when browser is actually in use
function updateLastActivityTime() {
  const now = Date.now();
  lastActivityTime = now;
  
  // If tracking was paused due to inactivity, resume it
  if (!forceContinueTracking) {
    console.log('[ACTIVITY] Browser activity detected, resuming tracking');
    forceContinueTracking = true;
    
    // IMPORTANT FIX: Update the start time when resuming from inactivity
    // This ensures we don't count the inactive time
    activeTabStartTime = now;
  }
}

// Listen for mouse/keyboard activity in content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'userActivity') {
    updateLastActivityTime();
    sendResponse({success: true});
  }
  // ...existing message handler code...
  return true;
});

function validateAndRecoverState() {
  if (isRecovering) return;
  
  isRecovering = true;
  console.log('[DEBUG] Starting state validation and recovery');
  
  // Check if we have an active tab but no start time
  if (activeTabId && !activeTabStartTime) {
    console.log('[DEBUG] Found active tab without start time, recovering...');
    activeTabStartTime = Date.now();
  }
  
  // Check if we have a start time but no active tab
  if (activeTabStartTime && !activeTabId) {
    console.log('[DEBUG] Found start time without active tab, clearing...');
    activeTabStartTime = null;
  }
  
  // Check if we have an active tab that doesn't exist
  if (activeTabId) {
    chrome.tabs.get(activeTabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.log('[DEBUG] Active tab no longer exists, clearing state...');
        activeTabId = null;
        activeTabStartTime = null;
      }
    });
  }
  
  isRecovering = false;
}

// Add periodic state validation
setInterval(() => {
  validateAndRecoverState();
}, 60000); // Check every minute 