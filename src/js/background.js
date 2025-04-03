/**
 * Procrastination Stopper - Background Script
 * 
 * This is the main service worker that coordinates:
 * - Activity tracking
 * - Time tracking
 * - Website blocking
 * - Pomodoro timer functionality
 */

// Constants
const DEBUG = true;

// Activity States
const ActivityState = {
  ACTIVE: 'active',           // User is actively using the browser
  PASSIVE: 'passive',         // User has the browser open but is not actively using it
  INACTIVE: 'inactive',       // User is not using the browser (window not focused)
  IDLE: 'idle'                // User has been inactive for extended period
};

// Activity Config
const ACTIVITY_CONFIG = {
  ACTIVE_TO_PASSIVE_THRESHOLD: 30000,  // 30 seconds without activity → passive
  PASSIVE_TO_IDLE_THRESHOLD: 120000,   // 2 minutes in passive state → idle
  ACTIVITY_CHECK_INTERVAL: 5000,       // Check activity state every 5 seconds
  HEARTBEAT_INTERVAL: 60000,           // Send state updates every 60 seconds
};

// Website Blocking Config
const BLOCKING_CONFIG = {
  CHECK_INTERVAL: 5000,        // Check if site should be blocked every 5 seconds
  GRACE_PERIOD: 5000,          // Grace period after limit reached before blocking
  OVERRIDE_ENABLED: true,      // Allow temporary override of blocking
  OVERRIDE_DURATION: 300000,   // Override duration in ms (5 minutes)
};

// Time Tracking Config
const TIME_CONFIG = {
  MIN_TIME_TO_TRACK: 1000,      // Minimum milliseconds to track (avoid micro-intervals)
  UPDATE_INTERVAL: 30000,       // Update storage every 30 seconds
  CLEANUP_INTERVAL: 86400000,   // Run cleanup once per day (ms)
};

// Timer states and types
const TimerType = {
  POMODORO: 'pomodoro',
  SHORT_BREAK: 'shortBreak',
  LONG_BREAK: 'longBreak'
};

// Activity State
let activityState = ActivityState.ACTIVE;
let previousActivityState = null;
let lastActivityTime = Date.now();
let lastStateChangeTime = Date.now();
let windowFocused = true;
let activityCheckInterval = null;

// Website Blocking State
let blockingEnabled = true;
let overrideExpirations = {}; // Domain -> expiration time map
let blockedTabRedirects = new Set(); // Set of tab IDs being redirected
let blockingCheckInterval = null;

// Active Tab Info
let activeTabId = null;
let activeTabDomain = null;
let activeTabUrl = null;
let activeTabStartTime = null;

// Time Tracking State
let isTracking = false;
let currentTrackedDomain = null;
let trackingStartTime = null;
let lastUpdateTime = null;
let currentDateStr = new Date().toISOString().split('T')[0];

// Timer State
let isTimerRunning = false;
let timerType = null;
let timerEndTime = null;
let timerInterval = null;
let pausedTimeRemaining = null;
let pomodoroCount = 0;

// Default settings
const DEFAULT_SETTINGS = {
  pomodoro: 25,           // minutes
  shortBreak: 5,          // minutes
  longBreak: 15,          // minutes
  autoStartBreaks: false,
  autoStartPomodoros: false,
  longBreakInterval: 4,   // pomodoros
  notificationsEnabled: true,
  blockingEnabled: true,  // Allow disabling blocking entirely
  graceNotifications: true // Show notification when approaching limit
};

// Current settings
let settings = {...DEFAULT_SETTINGS};

// ===== INITIALIZATION =====

// Initialize everything when the service worker starts
function initialize() {
  log('Initializing extension');
  
  // Load settings
  loadSettings();
  
  // Initialize active tab
  initializeActiveTab();
  
  // Setup activity monitoring
  setupActivityMonitoring();
  
  // Setup time tracking
  setupTimeTracking();
  
  // Setup website blocking
  setupWebsiteBlocking();
  
  // Setup message listeners
  setupMessageListeners();
  
  // Setup daily reset
  setupDailyReset();
  
  log('Extension initialized');
}

// Load settings from storage
function loadSettings() {
  chrome.storage.local.get('settings', (result) => {
    if (result.settings) {
      settings = {...DEFAULT_SETTINGS, ...result.settings};
      log('Settings loaded', settings);
    } else {
      // If no settings found, save defaults
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
      log('Default settings saved');
    }
  });
}

// Initialize the active tab
function initializeActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0) {
      const tab = tabs[0];
      setActiveTab(tab.id, tab.url);
    }
  });
}

// ===== ACTIVITY MANAGEMENT =====

// Set up activity monitoring
function setupActivityMonitoring() {
  // Set up tab activation listener
  chrome.tabs.onActivated.addListener((activeInfo) => {
    handleTabActivated(activeInfo);
  });
  
  // Set up tab update listener
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    handleTabUpdated(tabId, changeInfo, tab);
  });
  
  // Set up window focus listener
  chrome.windows.onFocusChanged.addListener((windowId) => {
    handleWindowFocusChanged(windowId);
  });
  
  // Start periodic activity state checks
  activityCheckInterval = setInterval(() => {
    checkActivityState();
  }, ACTIVITY_CONFIG.ACTIVITY_CHECK_INTERVAL);
  
  // Set up activity heartbeat
  setInterval(() => {
    sendActivityHeartbeat();
  }, ACTIVITY_CONFIG.HEARTBEAT_INTERVAL);
}

// Handle tab activated events
function handleTabActivated(activeInfo) {
  log('Tab activated:', activeInfo.tabId);
  
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) {
      log('Error getting tab info:', chrome.runtime.lastError);
      return;
    }
    
    // Record activity
    recordActivity();
    
    // Update active tab
    setActiveTab(tab.id, tab.url);
  });
}

// Handle tab updated events
function handleTabUpdated(tabId, changeInfo, tab) {
  // Only care about URL changes in active tab
  if (tabId === activeTabId && changeInfo.url) {
    log('Active tab URL changed:', changeInfo.url);
    
    // Record activity
    recordActivity();
    
    // Update active tab info
    setActiveTab(tab.id, tab.url);
  }
}

// Handle window focus changes
function handleWindowFocusChanged(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Window lost focus
    log('[WINDOW] Lost focus');
    windowFocused = false;
    
    // Save time spent on current tab
    if (activeTabId !== null && activeTabDomain !== null) {
      log(`[WINDOW] Saving time for ${activeTabDomain} before losing focus`);
      saveCurrentDomainTime();
      // Explicitly pause tracking when window loses focus
      pauseTracking('window lost focus');
    }
    
    // Immediately transition to inactive state
    transitionTo(ActivityState.INACTIVE);
    
  } else {
    // Window gained focus
    log('[WINDOW] Gained focus');
    windowFocused = true;
    recordActivity();
    
    // Get the active tab in this window
    chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
      if (chrome.runtime.lastError) {
        log('Error querying tabs:', chrome.runtime.lastError);
        return;
      }
      
      if (tabs.length > 0) {
        const tab = tabs[0];
        setActiveTab(tab.id, tab.url);
      }
    });
  }
}

// Check and update activity state
function checkActivityState() {
  const now = Date.now();
  const timeSinceActivity = now - lastActivityTime;
  
  // State transitions
  switch (activityState) {
    case ActivityState.ACTIVE:
      // If window is not focused, transition to INACTIVE
      if (!windowFocused) {
        transitionTo(ActivityState.INACTIVE);
        break;
      }
      
      // If no activity for threshold period, transition to PASSIVE
      if (timeSinceActivity > ACTIVITY_CONFIG.ACTIVE_TO_PASSIVE_THRESHOLD) {
        transitionTo(ActivityState.PASSIVE);
      }
      break;
      
    case ActivityState.PASSIVE:
      // If window is not focused, transition to INACTIVE
      if (!windowFocused) {
        transitionTo(ActivityState.INACTIVE);
        break;
      }
      
      // If in passive state too long, transition to IDLE
      const timeInPassiveState = now - lastStateChangeTime;
      if (timeInPassiveState > ACTIVITY_CONFIG.PASSIVE_TO_IDLE_THRESHOLD) {
        transitionTo(ActivityState.IDLE);
      }
      break;
      
    case ActivityState.INACTIVE:
      // If window regains focus, transition back to ACTIVE
      if (windowFocused) {
        transitionTo(ActivityState.ACTIVE);
      }
      break;
      
    case ActivityState.IDLE:
      // If window is not focused, transition to INACTIVE
      if (!windowFocused) {
        transitionTo(ActivityState.INACTIVE);
        break;
      }
      break;
  }
}

// Transition to a new activity state
function transitionTo(newState) {
  if (activityState === newState) return;
  
  log(`State transition: ${activityState} → ${newState}`);
  
  previousActivityState = activityState;
  activityState = newState;
  lastStateChangeTime = Date.now();
  
  // Handle state entry actions
  switch (newState) {
    case ActivityState.ACTIVE:
      // Resume tracking if we have an active domain
      if (currentTrackedDomain && !isTracking) {
        startTracking(currentTrackedDomain);
      }
      break;
      
    case ActivityState.PASSIVE:
      // Remain in tracking state
      break;
      
    case ActivityState.INACTIVE:
      // Save current tab time and stop tracking when going inactive
      saveCurrentDomainTime();
      pauseTracking('became inactive');
      break;
      
    case ActivityState.IDLE:
      // Save current tab time and stop tracking when going idle
      saveCurrentDomainTime();
      pauseTracking('became idle');
      break;
  }
}

// Record user activity
function recordActivity() {
  lastActivityTime = Date.now();
  
  // If we're not in ACTIVE state, but window is focused, transition to ACTIVE
  if (activityState !== ActivityState.ACTIVE && windowFocused) {
    transitionTo(ActivityState.ACTIVE);
  } else if (!windowFocused && activityState !== ActivityState.INACTIVE) {
    // If window is not focused but we're not in INACTIVE state, force the correction
    log('[ACTIVITY] Detected activity but window not focused, ensuring inactive state');
    transitionTo(ActivityState.INACTIVE);
  }
}

// Send activity heartbeat
function sendActivityHeartbeat() {
  // Include more diagnostic information
  log(`[HEARTBEAT] State: ${activityState}, Window focused: ${windowFocused}, Tracking: ${isTracking}, Domain: ${currentTrackedDomain}`);
}

// Set the active tab
function setActiveTab(tabId, url) {
  // If this is a different tab, update time tracking first
  if (activeTabId !== null && activeTabId !== tabId) {
    saveCurrentDomainTime();
  }
  
  activeTabId = tabId;
  activeTabUrl = url;
  activeTabDomain = extractDomain(url);
  activeTabStartTime = Date.now();
  
  // Start tracking time for this domain
  startTracking(activeTabDomain);
  
  log(`Active tab set to ${tabId}, domain: ${activeTabDomain}`);
}

// Extract domain from URL
function extractDomain(url) {
  if (!url) return null;
  
  try {
    // Handle special browser URLs
    if (url.startsWith('chrome://') || url.startsWith('brave://') || 
        url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      return url.split('/')[0] + '//' + url.split('/')[2];
    }
    
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (e) {
    log('Error extracting domain:', e);
    return null;
  }
}

// ===== TIME TRACKING =====

// Setup time tracking
function setupTimeTracking() {
  // Start periodic updates
  setInterval(() => {
    // Only update time if we're actually tracking and window is focused
    if (isTracking && windowFocused && 
        (activityState === ActivityState.ACTIVE || activityState === ActivityState.PASSIVE)) {
      updateTimeWithoutStopping();
    }
  }, TIME_CONFIG.UPDATE_INTERVAL);
  
  // Daily cleanup
  setInterval(() => {
    cleanupOldData();
  }, TIME_CONFIG.CLEANUP_INTERVAL);
}

// Start tracking time for a domain
function startTracking(domain, timestamp = Date.now()) {
  // Check if we need to change dates
  checkDateChange();
  
  currentTrackedDomain = domain;
  trackingStartTime = timestamp;
  lastUpdateTime = timestamp;
  isTracking = true;
  
  log(`Started tracking time for ${domain}`);
}

// Pause time tracking
function pauseTracking(reason) {
  if (!isTracking) return;
  
  isTracking = false;
  log(`Paused tracking for ${currentTrackedDomain} due to ${reason}`);
}

// Save the time spent on the current domain
function saveCurrentDomainTime() {
  if (!isTracking || !currentTrackedDomain || !trackingStartTime) {
    return;
  }
  
  const now = Date.now();
  const timeSpent = now - trackingStartTime;
  
  // Only track if we spent a meaningful amount of time
  if (timeSpent >= TIME_CONFIG.MIN_TIME_TO_TRACK) {
    updateDomainTime(currentTrackedDomain, timeSpent);
  }
  
  trackingStartTime = now;
}

// Update time without stopping tracking
function updateTimeWithoutStopping() {
  // Skip updates if we're in inactive or idle state
  if (activityState === ActivityState.INACTIVE || activityState === ActivityState.IDLE) {
    log(`[TIME] Skipping time update because state is ${activityState}`);
    return;
  }
  
  if (!isTracking || !currentTrackedDomain || !trackingStartTime) {
    return;
  }
  
  const now = Date.now();
  const timeSpent = now - lastUpdateTime;
  
  // Only update if we spent a meaningful amount of time
  if (timeSpent >= TIME_CONFIG.MIN_TIME_TO_TRACK) {
    updateDomainTime(currentTrackedDomain, timeSpent);
    lastUpdateTime = now;
  }
}

// Update the time spent on a domain in storage
function updateDomainTime(domain, timeSpentMs) {
  // Convert to seconds for storage
  const timeSpentSeconds = Math.round(timeSpentMs / 1000);
  
  if (timeSpentSeconds <= 0) {
    return;
  }
  
  log(`Updating time for ${domain}: +${timeSpentSeconds} seconds`);
  
  // Get existing data
  chrome.storage.local.get(['websites'], (result) => {
    let websites = result.websites || [];
    let website = websites.find(site => site.domain === domain);
    
    if (!website) {
      // Create new website entry if it doesn't exist
      website = {
        domain: domain,
        timeSpent: 0,
        dailyUsage: {},
        createdAt: Date.now()
      };
      websites.push(website);
    }
    
    // Update total time
    website.timeSpent = (website.timeSpent || 0) + timeSpentSeconds;
    
    // Update daily usage
    website.dailyUsage = website.dailyUsage || {};
    website.dailyUsage[currentDateStr] = 
      (website.dailyUsage[currentDateStr] || 0) + timeSpentSeconds;
    
    // Save updated data
    chrome.storage.local.set({ websites }, () => {
      if (chrome.runtime.lastError) {
        log('Error saving website data:', chrome.runtime.lastError);
      } else {
        log(`Updated time for ${domain}: Total = ${website.timeSpent}s, Today = ${website.dailyUsage[currentDateStr]}s`);
      }
    });
  });
}

// Clean up old usage data
function cleanupOldData() {
  log('Running data cleanup procedure');
  
  chrome.storage.local.get(['websites'], (result) => {
    if (!result.websites) return;
    
    let websites = result.websites;
    let dataChanged = false;
    
    websites.forEach(website => {
      if (website.dailyUsage) {
        // Keep only the last 90 days of data
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 90);
        const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
        
        Object.keys(website.dailyUsage).forEach(dateStr => {
          if (dateStr < cutoffDateStr) {
            delete website.dailyUsage[dateStr];
            dataChanged = true;
          }
        });
      }
    });
    
    if (dataChanged) {
      chrome.storage.local.set({ websites }, () => {
        log('Cleaned up old usage data');
      });
    }
  });
}

// ===== DATE CHANGE HANDLING =====

// Setup daily reset at midnight
function setupDailyReset() {
  // Check if we need to reset at startup
  checkDateChange();
  
  // Set up alarm for daily reset at midnight
  chrome.alarms.create('dailyReset', {
    periodInMinutes: 60, // Check every hour
    delayInMinutes: 60 - new Date().getMinutes() // Start at the top of the next hour
  });
  
  // Listen for alarm
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'dailyReset') {
      checkDateChange();
    }
  });
}

// Check if the date has changed, and handle rollover
function checkDateChange() {
  const today = new Date().toISOString().split('T')[0];
  
  if (today !== currentDateStr) {
    log(`Date changed from ${currentDateStr} to ${today}`);
    
    // Save the current date
    chrome.storage.local.set({ lastResetDate: today });
    
    // Update current date
    currentDateStr = today;
    
    // Run daily reset
    handleDailyReset();
  }
}

// Handle daily reset tasks
function handleDailyReset() {
  log('Performing daily reset tasks');
  
  // Any daily reset tasks go here
}

// ===== WEBSITE BLOCKING =====

// Setup website blocking
function setupWebsiteBlocking() {
  // Listen for tab updates to check for blocking
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only check completed page loads with URLs
    if (changeInfo.status === 'complete' && tab.url) {
      checkIfShouldBlockTab(tabId, tab.url);
    }
  });
  
  // Set up periodic checks for active tab
  blockingCheckInterval = setInterval(() => {
    checkActiveTabForBlocking();
  }, BLOCKING_CONFIG.CHECK_INTERVAL);
  
  log('[BLOCKING] Website blocking initialized');
}

// Check if active tab should be blocked
function checkActiveTabForBlocking() {
  if (!activeTabId || !activeTabDomain || !blockingEnabled || !settings.blockingEnabled) {
    return;
  }
  
  // Don't check browser internal pages
  if (isInternalBrowserPage(activeTabDomain)) {
    return;
  }
  
  // Get current time spent today
  getWebsiteTimeSpent(activeTabDomain, (timeData) => {
    // Check if this site has a limit
    hasTimeLimitBeenExceeded(activeTabDomain, timeData.today, (isExceeded, limit) => {
      if (isExceeded) {
        log(`[BLOCKING] Time limit exceeded for ${activeTabDomain}: ${timeData.today}s/${limit * 60}s`);
        
        // Check if there's an active override
        if (isOverrideActive(activeTabDomain)) {
          log(`[BLOCKING] Override active for ${activeTabDomain}, not blocking`);
          return;
        }
        
        // Block the tab
        blockTab(activeTabId, activeTabDomain, timeData.today, limit);
      }
    });
  });
}

// Get time spent for a website
function getWebsiteTimeSpent(domain, callback) {
  chrome.storage.local.get(['websites'], (result) => {
    const websites = result.websites || [];
    const website = websites.find(site => site.domain === domain);
    
    if (!website) {
      callback({ total: 0, today: 0 });
      return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    const todayUsage = website.dailyUsage && website.dailyUsage[today] 
      ? website.dailyUsage[today] : 0;
    
    callback({ 
      total: website.timeSpent || 0,
      today: todayUsage
    });
  });
}

// Check if a website's time limit has been exceeded
function hasTimeLimitBeenExceeded(domain, timeSpentSeconds, callback) {
  chrome.storage.local.get(['websites'], (result) => {
    const websites = result.websites || [];
    const website = websites.find(site => site.domain === domain);
    
    // If no website or no time limit, not exceeded
    if (!website || !website.timeLimit) {
      callback(false, null);
      return;
    }
    
    // Convert timeLimit from minutes to seconds
    const limitInSeconds = website.timeLimit * 60;
    
    // Check if time spent exceeds limit
    const isExceeded = timeSpentSeconds >= limitInSeconds;
    
    callback(isExceeded, website.timeLimit);
  });
}

// Block a tab by redirecting to blocked.html
function blockTab(tabId, domain, timeSpent, limit) {
  // Don't redirect if we're already redirecting this tab
  if (blockedTabRedirects.has(tabId)) {
    return;
  }
  
  log(`[BLOCKING] Blocking tab ${tabId} for domain ${domain}`);
  
  // Get the tab to get its URL
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      log(`[BLOCKING] Error getting tab info: ${chrome.runtime.lastError.message}`);
      return;
    }
    
    // Add to set of tabs being redirected
    blockedTabRedirects.add(tabId);
    
    // Create blocked page URL with parameters
    const blockedPageUrl = chrome.runtime.getURL(
      `html/blocked.html?domain=${encodeURIComponent(domain)}` +
      `&timeSpent=${timeSpent}` +
      `&limit=${limit}` +
      `&url=${encodeURIComponent(tab.url)}`
    );
    
    // Redirect to blocked page
    chrome.tabs.update(tabId, { url: blockedPageUrl }, () => {
      // After a short delay, remove from the redirecting set
      setTimeout(() => {
        blockedTabRedirects.delete(tabId);
      }, 1000);
      
      if (chrome.runtime.lastError) {
        log(`[BLOCKING] Error redirecting tab: ${chrome.runtime.lastError.message}`);
      }
    });
  });
}

// Check if we should block a specific tab
function checkIfShouldBlockTab(tabId, url) {
  if (!blockingEnabled || !settings.blockingEnabled) {
    return;
  }
  
  // Skip if this is already being redirected
  if (blockedTabRedirects.has(tabId)) {
    return;
  }
  
  // Don't block extension pages (including our blocked page)
  if (url.startsWith(chrome.runtime.getURL(''))) {
    return;
  }
  
  // Extract domain
  const domain = extractDomain(url);
  
  // Don't block browser internal pages
  if (isInternalBrowserPage(domain)) {
    return;
  }
  
  // Check if domain has a time limit and if it's exceeded
  getWebsiteTimeSpent(domain, (timeData) => {
    hasTimeLimitBeenExceeded(domain, timeData.today, (isExceeded, limit) => {
      if (isExceeded) {
        // Check if there's an active override
        if (isOverrideActive(domain)) {
          log(`[BLOCKING] Override active for ${domain}, not blocking`);
          return;
        }
        
        // Block the tab
        blockTab(tabId, domain, timeData.today, limit);
      }
    });
  });
}

// Check if a domain is a browser internal page
function isInternalBrowserPage(domain) {
  return domain && (
    domain.startsWith('chrome://') || 
    domain.startsWith('brave://') || 
    domain.startsWith('about:') ||
    domain.startsWith('chrome-extension://')
  );
}

// Set temporary override for a domain
function setBlockingOverride(domain, durationMs = BLOCKING_CONFIG.OVERRIDE_DURATION) {
  const expirationTime = Date.now() + durationMs;
  overrideExpirations[domain] = expirationTime;
  
  log(`[BLOCKING] Set override for ${domain}, expires in ${durationMs / 1000} seconds`);
  
  // Schedule cleanup of the override
  setTimeout(() => {
    if (overrideExpirations[domain] === expirationTime) {
      delete overrideExpirations[domain];
      log(`[BLOCKING] Override expired for ${domain}`);
    }
  }, durationMs);
}

// Check if there's an active override for a domain
function isOverrideActive(domain) {
  const expiration = overrideExpirations[domain];
  if (!expiration) return false;
  
  // Check if the override is still valid
  return Date.now() < expiration;
}

// Toggle global blocking state
function toggleBlocking(enabled) {
  blockingEnabled = enabled;
  log(`[BLOCKING] Website blocking ${enabled ? 'enabled' : 'disabled'}`);
}

// ===== MESSAGE HANDLING =====

// Setup message listeners
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('Message received:', message.action);
    
    // Handle activity events from content scripts
    if (message.action === 'activityEvent') {
      handleActivityEvent(message, sender);
      sendResponse({ success: true });
      return true;
    }
    
    // Handle other messages
    switch (message.action) {
      case 'getActiveTabInfo':
        handleGetActiveTabInfo(sendResponse);
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
        chrome.action.openPopup();
        sendResponse({ success: true });
        break;
        
      case 'forceTimeUpdate':
        updateTimeWithoutStopping();
        sendResponse({ success: true });
        break;
        
      case 'resetTimeData':
        handleResetTimeData(sendResponse);
        return true; // Keep channel open for async response
        
      case 'dumpStorage':
        dumpStorage();
        sendResponse({ success: true });
        break;
      
      case 'overrideBlocking':
        setBlockingOverride(message.domain, message.duration);
        sendResponse({ success: true });
        break;
        
      case 'toggleBlocking':
        toggleBlocking(message.enabled);
        sendResponse({ success: true });
        break;
        
      case 'getWebsiteTimeInfo':
        getWebsiteTimeSpent(message.domain, (timeData) => {
          hasTimeLimitBeenExceeded(message.domain, timeData.today, (isExceeded, limit) => {
            sendResponse({
              success: true,
              timeData: timeData,
              limit: limit,
              isExceeded: isExceeded,
              overrideActive: isOverrideActive(message.domain)
            });
          });
        });
        return true; // Keep channel open for async response
        
      case 'extensionHealthCheck':
        handleHealthCheck(sendResponse);
        return true; // Keep channel open for async response
        
      case 'debug':
        handleDebugCommand(message.command, sendResponse);
        return true; // Keep channel open for async response
        
      default:
        log('Unknown message action:', message.action);
        sendResponse({ success: false, error: 'Unknown action' });
    }
    
    return true; // Keep channel open for async response
  });
}

// Handle activity events from content scripts
function handleActivityEvent(event, sender) {
  // Record the timestamp of activity
  lastActivityTime = Date.now();
  
  // Log the event with more detail
  log(`[ACTIVITY] Event: ${event.eventType} from tab ${sender.tab?.id}, window focused: ${windowFocused}`);
  
  // Only update state if window is focused
  if (windowFocused) {
    if (activityState !== ActivityState.ACTIVE) {
      transitionTo(ActivityState.ACTIVE);
    }
  } else {
    // If we get activity from a tab but the window is not focused,
    // this might be a background tab sending events - don't change state
    log(`[ACTIVITY] Ignoring activity from tab ${sender.tab?.id} because window is not focused`);
  }
  
  // Additional processing for specific event types
  switch (event.eventType) {
    case 'init':
      log(`[ACTIVITY] Tab ${sender.tab?.id} initialized`);
      break;
      
    case 'visibilitychange':
      log(`[ACTIVITY] Tab ${sender.tab?.id} visibility changed to ${event.detail.visible ? 'visible' : 'hidden'}`);
      break;
      
    case 'heartbeat':
      // No need to log every heartbeat
      break;
      
    default:
      // Log other event types
      log(`[ACTIVITY] Event type: ${event.eventType} from tab ${sender.tab?.id}`);
  }
}

// Handle getActiveTabInfo message
function handleGetActiveTabInfo(sendResponse) {
  const activeInfo = {
    domain: activeTabDomain,
    activityState: activityState,
    isTimerRunning: isTimerRunning,
    timerType: timerType,
    timerEndTime: timerEndTime,
    pomodoroCount: pomodoroCount,
    timeRemaining: timerEndTime ? Math.max(0, Math.floor((timerEndTime - Date.now()) / 1000)) : null
  };
  
  log('Sending active tab info:', activeInfo);
  sendResponse(activeInfo);
}

// Handle resetTimeData message
function handleResetTimeData(sendResponse) {
  chrome.storage.local.get('websites', (result) => {
    if (!result.websites) {
      log('No websites data found to reset');
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
        console.error('Failed to reset time data:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      
      log('Time data reset successfully');
      dumpStorage();
      sendResponse({ success: true });
    });
  });
}

// Handle health check message
function handleHealthCheck(sendResponse) {
  const health = {
    activeTabId: activeTabId,
    activeTabDomain: activeTabDomain,
    activityState: activityState,
    isTracking: isTracking,
    timerRunning: isTimerRunning,
    blockingEnabled: blockingEnabled,
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
    
    log('HEALTH CHECK', health);
    sendResponse({ health });
  });
}

// Handle debug commands
function handleDebugCommand(command, sendResponse) {
  switch (command) {
    case 'simulateReset':
      log('Simulating midnight reset...');
      handleDailyReset();
      sendResponse({ success: true, message: 'Reset simulation triggered' });
      break;
      
    case 'validateState':
      log('Validating current state...');
      checkActivityState();
      sendResponse({ success: true, message: 'State validation triggered' });
      break;
      
    case 'getState':
      const state = {
        activityState: activityState,
        activeTabId: activeTabId,
        activeTabDomain: activeTabDomain,
        lastActivityTime: lastActivityTime,
        isTracking: isTracking,
        currentDomain: currentTrackedDomain
      };
      sendResponse({ success: true, state });
      break;
      
    default:
      sendResponse({ success: false, message: 'Unknown debug command' });
  }
}

// ===== POMODORO TIMER FUNCTIONS =====

// Start a new timer of the specified type
function startTimer(requestedType) {
  log(`Starting ${requestedType} timer`);
  
  // Reset any existing timer
  resetTimer();
  
  // Set timer type
  timerType = requestedType || TimerType.POMODORO;
  
  // Calculate duration
  let duration;
  switch (timerType) {
    case TimerType.SHORT_BREAK:
      duration = settings.shortBreak * 60;
      break;
    case TimerType.LONG_BREAK:
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
  
  log(`Started ${timerType} timer for ${duration} seconds. Will end at: ${new Date(timerEndTime).toLocaleTimeString()}`);
  
  // Only show notification on manual start (when not auto-transitioning)
  if (!requestedType) {
    if (timerType === TimerType.POMODORO) {
      showNotification('Pomodoro Started', 'Focus time has begun. Stay focused!');
    } else if (timerType === TimerType.SHORT_BREAK) {
      showNotification('Short Break Started', 'Take a quick break. Stand up, stretch, or look away from the screen.');
    } else if (timerType === TimerType.LONG_BREAK) {
      showNotification('Long Break Started', 'Time for a longer break. Get up and move around!');
    }
  }
}

// Start the timer interval
function startTimerInterval() {
  timerInterval = setInterval(() => {
    const now = Date.now();
    
    // Check if timer has ended
    if (now >= timerEndTime) {
      handleTimerCompletion();
    }
  }, 1000);
}

// Handle timer completion
function handleTimerCompletion() {
  clearInterval(timerInterval);
  timerInterval = null;
  
  log(`${timerType} timer completed`);
  
  // Show notification
  if (settings.notificationsEnabled) {
    if (timerType === TimerType.POMODORO) {
      pomodoroCount++;
      
      if (pomodoroCount % settings.longBreakInterval === 0) {
        showNotification('Pomodoro Completed', 'Well done! Time for a long break.');
        
        // Auto-start long break if enabled
        if (settings.autoStartBreaks) {
          startTimer(TimerType.LONG_BREAK);
          return;
        }
      } else {
        showNotification('Pomodoro Completed', 'Well done! Time for a short break.');
        
        // Auto-start short break if enabled
        if (settings.autoStartBreaks) {
          startTimer(TimerType.SHORT_BREAK);
          return;
        }
      }
    } else if (timerType === TimerType.SHORT_BREAK || timerType === TimerType.LONG_BREAK) {
      showNotification('Break Completed', 'Break time is over. Ready to focus again?');
      
      // Auto-start pomodoro if enabled
      if (settings.autoStartPomodoros) {
        startTimer(TimerType.POMODORO);
        return;
      }
    }
  }
  
  // Reset timer state
  isTimerRunning = false;
  timerEndTime = null;
}

// Pause the timer
function pauseTimer() {
  if (!isTimerRunning || !timerEndTime) return;
  
  log('Pausing timer');
  
  // Calculate remaining time
  pausedTimeRemaining = Math.max(0, timerEndTime - Date.now());
  
  // Clear the interval
  clearInterval(timerInterval);
  timerInterval = null;
  
  // Update state
  isTimerRunning = false;
  timerEndTime = null;
}

// Resume the timer
function resumeTimer() {
  if (isTimerRunning || !pausedTimeRemaining) return;
  
  log('Resuming timer');
  
  // Calculate new end time
  timerEndTime = Date.now() + pausedTimeRemaining;
  pausedTimeRemaining = null;
  
  // Update state
  isTimerRunning = true;
  
  // Start the interval
  startTimerInterval();
}

// Reset the timer
function resetTimer() {
  log('Resetting timer');
  
  // Clear the interval
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  // Reset state
  isTimerRunning = false;
  timerEndTime = null;
  pausedTimeRemaining = null;
  // Note: We don't reset pomodoroCount here
}

// Show a browser notification
function showNotification(title, message) {
  if (!settings.notificationsEnabled) return;
  
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/IconPS.png',
    title: title,
    message: message,
    priority: 2
  });
}

// ===== UTILITY FUNCTIONS =====

// Dump storage to console (for debugging)
function dumpStorage() {
  chrome.storage.local.get(null, (data) => {
    log('Storage Dump:', data);
  });
}

// Utility logging function
function log(...args) {
  if (DEBUG) {
    console.log('[Background]', ...args);
  }
}

// ===== START THE EXTENSION =====

// Initialize everything when loaded
initialize(); 