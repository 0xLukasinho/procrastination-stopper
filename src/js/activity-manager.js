/**
 * Activity Manager
 * 
 * Central state machine that manages user activity state.
 * All activity events flow through this manager which makes definitive
 * decisions about whether the user is active or inactive.
 */

// Activity states
const ActivityState = {
  ACTIVE: 'active',           // User is actively using the browser
  PASSIVE: 'passive',         // User has the browser open but is not actively using it
  INACTIVE: 'inactive',       // User is not using the browser (window not focused)
  IDLE: 'idle'                // User has been inactive for extended period
};

// Configuration
const CONFIG = {
  // Time thresholds in milliseconds
  ACTIVE_TO_PASSIVE_THRESHOLD: 30000,     // 30 seconds without activity → passive
  PASSIVE_TO_IDLE_THRESHOLD: 120000,      // 2 minutes in passive state → idle
  ACTIVITY_CHECK_INTERVAL: 5000,          // Check activity state every 5 seconds
  HEARTBEAT_INTERVAL: 60000,              // Send state updates every 60 seconds
  
  // Debug settings
  DEBUG: true
};

class ActivityManager {
  constructor() {
    // Current state
    this.state = ActivityState.ACTIVE;
    this.previousState = null;
    
    // Timestamps
    this.lastActivityTime = Date.now();
    this.lastStateChangeTime = Date.now();
    this.windowFocused = true;
    
    // Active tab info
    this.activeTabId = null;
    this.activeTabDomain = null;
    this.activeTabStartTime = null;
    
    // Subscribers to state changes
    this.subscribers = [];
    
    // Initialize
    this.initializeEventListeners();
    this.startActivityChecks();
    this.log('ActivityManager initialized');
  }
  
  /**
   * Initialize event listeners for browser events
   */
  initializeEventListeners() {
    // Tab activation events
    chrome.tabs.onActivated.addListener(this.handleTabActivated.bind(this));
    
    // Tab update events (URL changes)
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated.bind(this));
    
    // Window focus events
    chrome.windows.onFocusChanged.addListener(this.handleWindowFocusChanged.bind(this));
    
    // Message handlers from content scripts
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    
    // Initialize active tab
    this.initializeActiveTab();
  }
  
  /**
   * Initialize the active tab on startup
   */
  async initializeActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) {
        const tab = tabs[0];
        this.setActiveTab(tab.id, tab.url);
      }
    } catch (error) {
      this.log('Error initializing active tab:', error);
    }
  }
  
  /**
   * Set the active tab and domain
   */
  setActiveTab(tabId, url) {
    // If this is a different tab, update time tracking first
    if (this.activeTabId !== null && this.activeTabId !== tabId) {
      this.notifyTimeTracker('tabChanged');
    }
    
    this.activeTabId = tabId;
    this.activeTabDomain = this.extractDomain(url);
    this.activeTabStartTime = Date.now();
    
    this.log(`Active tab set to ${tabId}, domain: ${this.activeTabDomain}`);
  }
  
  /**
   * Extract domain from URL
   */
  extractDomain(url) {
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
      this.log('Error extracting domain:', e);
      return null;
    }
  }
  
  /**
   * Start periodic checks of activity state
   */
  startActivityChecks() {
    // Check activity state periodically
    setInterval(() => this.checkActivityState(), CONFIG.ACTIVITY_CHECK_INTERVAL);
    
    // Send heartbeats periodically
    setInterval(() => this.sendHeartbeat(), CONFIG.HEARTBEAT_INTERVAL);
  }
  
  /**
   * Send a heartbeat with current state to subscribers
   */
  sendHeartbeat() {
    // Only send heartbeat if we have an active tab
    if (this.activeTabId) {
      this.notifySubscribers({
        type: 'heartbeat',
        state: this.state,
        activeTabId: this.activeTabId,
        activeTabDomain: this.activeTabDomain,
        lastActivityTime: this.lastActivityTime
      });
    }
  }
  
  /**
   * Check current activity state and update if necessary
   */
  checkActivityState() {
    const now = Date.now();
    const timeSinceActivity = now - this.lastActivityTime;
    
    // State transitions
    switch (this.state) {
      case ActivityState.ACTIVE:
        // If window is not focused, transition to INACTIVE
        if (!this.windowFocused) {
          this.transitionTo(ActivityState.INACTIVE);
          break;
        }
        
        // If no activity for threshold period, transition to PASSIVE
        if (timeSinceActivity > CONFIG.ACTIVE_TO_PASSIVE_THRESHOLD) {
          this.transitionTo(ActivityState.PASSIVE);
        }
        break;
        
      case ActivityState.PASSIVE:
        // If window is not focused, transition to INACTIVE
        if (!this.windowFocused) {
          this.transitionTo(ActivityState.INACTIVE);
          break;
        }
        
        // If in passive state too long, transition to IDLE
        const timeInPassiveState = now - this.lastStateChangeTime;
        if (timeInPassiveState > CONFIG.PASSIVE_TO_IDLE_THRESHOLD) {
          this.transitionTo(ActivityState.IDLE);
        }
        break;
        
      case ActivityState.INACTIVE:
        // If window regains focus, transition back to ACTIVE
        if (this.windowFocused) {
          this.transitionTo(ActivityState.ACTIVE);
        }
        break;
        
      case ActivityState.IDLE:
        // If window is not focused, transition to INACTIVE
        if (!this.windowFocused) {
          this.transitionTo(ActivityState.INACTIVE);
          break;
        }
        break;
    }
  }
  
  /**
   * Transition to a new state
   */
  transitionTo(newState) {
    if (this.state === newState) return;
    
    this.log(`State transition: ${this.state} → ${newState}`);
    
    this.previousState = this.state;
    this.state = newState;
    this.lastStateChangeTime = Date.now();
    
    // Handle state entry actions
    switch (newState) {
      case ActivityState.ACTIVE:
        // Nothing special needed
        break;
        
      case ActivityState.PASSIVE:
        // Nothing special needed
        break;
        
      case ActivityState.INACTIVE:
        // Save current tab time when going inactive
        this.notifyTimeTracker('inactive');
        break;
        
      case ActivityState.IDLE:
        // Save current tab time when going idle
        this.notifyTimeTracker('idle');
        break;
    }
    
    // Notify subscribers of state change
    this.notifySubscribers({
      type: 'stateChanged',
      previousState: this.previousState,
      newState: this.state
    });
  }
  
  /**
   * Record user activity and update state
   */
  recordActivity() {
    this.lastActivityTime = Date.now();
    
    // If we're not in ACTIVE state, transition to it
    if (this.state !== ActivityState.ACTIVE) {
      this.transitionTo(ActivityState.ACTIVE);
    }
  }
  
  /**
   * Handle tab activated events
   */
  handleTabActivated(activeInfo) {
    this.log('Tab activated:', activeInfo.tabId);
    
    // Get the tab details
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (chrome.runtime.lastError) {
        this.log('Error getting tab info:', chrome.runtime.lastError);
        return;
      }
      
      // Record this as user activity
      this.recordActivity();
      
      // Update active tab
      this.setActiveTab(tab.id, tab.url);
    });
  }
  
  /**
   * Handle tab updated events (URL changes)
   */
  handleTabUpdated(tabId, changeInfo, tab) {
    // Only care about URL changes in the active tab
    if (tabId === this.activeTabId && changeInfo.url) {
      this.log('Active tab URL changed:', changeInfo.url);
      
      // Record this as user activity
      this.recordActivity();
      
      // Update active tab info
      this.setActiveTab(tab.id, tab.url);
    }
  }
  
  /**
   * Handle window focus changed events
   */
  handleWindowFocusChanged(windowId) {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      // Window lost focus
      this.log('Window lost focus');
      this.windowFocused = false;
      
      // This will trigger state transition in next check
    } else {
      // Window gained focus
      this.log('Window gained focus');
      this.windowFocused = true;
      this.recordActivity();
      
      // Get the active tab in this window
      chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
        if (chrome.runtime.lastError) {
          this.log('Error querying tabs:', chrome.runtime.lastError);
          return;
        }
        
        if (tabs.length > 0) {
          const tab = tabs[0];
          this.setActiveTab(tab.id, tab.url);
        }
      });
    }
  }
  
  /**
   * Handle messages from content scripts
   */
  handleMessage(message, sender, sendResponse) {
    // Only process activity events
    if (message.action === 'activityEvent') {
      this.handleActivityEvent(message, sender);
      sendResponse({ success: true });
      return true;
    }
    
    // Let other message handlers process this message
    return false;
  }
  
  /**
   * Handle activity events from content scripts
   */
  handleActivityEvent(event, sender) {
    // Record the timestamp of this activity
    this.recordActivity();
    
    this.log(`Activity event: ${event.eventType} from tab ${sender.tab?.id}`);
    
    // Additional processing for specific event types
    switch (event.eventType) {
      case 'init':
        // Content script just initialized in a tab
        break;
        
      case 'visibilitychange':
        // Tab visibility changed
        break;
        
      // Other event types as needed
    }
  }
  
  /**
   * Subscribe to activity state changes
   */
  subscribe(callback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }
  
  /**
   * Notify all subscribers of events
   */
  notifySubscribers(eventData) {
    this.subscribers.forEach(callback => {
      try {
        callback(eventData);
      } catch (error) {
        this.log('Error in subscriber callback:', error);
      }
    });
  }
  
  /**
   * Notify the time tracker of state changes
   */
  notifyTimeTracker(reason) {
    if (this.activeTabId && this.activeTabDomain) {
      chrome.runtime.sendMessage({
        action: 'updateTimeTracking',
        tabId: this.activeTabId,
        domain: this.activeTabDomain,
        timestamp: Date.now(),
        reason: reason
      }).catch(() => {
        // Ignore errors, timeTracker might not be ready
      });
    }
  }
  
  /**
   * Utility logging function
   */
  log(...args) {
    if (CONFIG.DEBUG) {
      console.log('[ActivityManager]', ...args);
    }
  }
}

// Create and export the singleton instance
const activityManager = new ActivityManager();
export default activityManager; 