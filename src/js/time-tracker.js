/**
 * Time Tracker
 * 
 * Handles time accounting for websites based on activity signals from the ActivityManager.
 * This module is responsible for tracking and storing time spent on websites.
 */

// Configuration
const CONFIG = {
  // Time thresholds 
  MIN_TIME_TO_TRACK: 1000,      // Minimum milliseconds to track (avoid micro-intervals)
  UPDATE_INTERVAL: 30000,       // Update storage every 30 seconds
  CLEANUP_INTERVAL: 86400000,   // Run cleanup once per day (ms)
  
  // Feature flags
  TRACK_DAILY_USAGE: true,      // Track usage per day
  TRACK_WEEKLY_USAGE: true,     // Track weekly statistics
  
  // Debug settings
  DEBUG: true
};

class TimeTracker {
  constructor() {
    // Current tracking state
    this.currentDomain = null;
    this.trackingStartTime = null;
    this.lastUpdateTime = null;
    this.isTracking = false;
    
    // Day tracking
    this.currentDateStr = new Date().toISOString().split('T')[0];
    
    // Initialize
    this.initializeMessageListeners();
    this.startPeriodicUpdates();
    
    this.log('TimeTracker initialized');
  }
  
  /**
   * Initialize message listeners
   */
  initializeMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Capture time tracking update requests
      if (message.action === 'updateTimeTracking') {
        this.handleTimeTrackingUpdate(message);
        sendResponse({ success: true });
        return true;
      }
      
      // Handle other messages as needed
      return false;
    });
  }
  
  /**
   * Handle time tracking updates from ActivityManager
   */
  handleTimeTrackingUpdate(message) {
    const { domain, reason, timestamp } = message;
    
    this.log(`Time tracking update: ${reason} for ${domain}`);
    
    switch (reason) {
      case 'tabChanged':
        // Save time for previous domain before switching
        this.saveCurrentDomainTime();
        
        // Start tracking the new domain
        this.startTracking(domain, timestamp);
        break;
        
      case 'inactive':
        // Save time when browser becomes inactive
        this.saveCurrentDomainTime();
        this.pauseTracking('browser inactive');
        break;
        
      case 'idle':
        // Save time when user becomes idle
        this.saveCurrentDomainTime();
        this.pauseTracking('user idle');
        break;
        
      case 'active':
        // Resume tracking if we were paused
        if (!this.isTracking && this.currentDomain) {
          this.startTracking(this.currentDomain, timestamp);
        }
        break;
        
      case 'periodic':
        // Periodic update - just save current time without stopping tracking
        this.updateTimeWithoutStopping();
        break;
        
      default:
        this.log(`Unknown time tracking reason: ${reason}`);
    }
  }
  
  /**
   * Start tracking time for a domain
   */
  startTracking(domain, timestamp = Date.now()) {
    // Check if we need to change dates
    this.checkDateChange();
    
    this.currentDomain = domain;
    this.trackingStartTime = timestamp;
    this.lastUpdateTime = timestamp;
    this.isTracking = true;
    
    this.log(`Started tracking time for ${domain}`);
  }
  
  /**
   * Pause time tracking
   */
  pauseTracking(reason) {
    if (!this.isTracking) return;
    
    this.isTracking = false;
    this.log(`Paused tracking for ${this.currentDomain} due to ${reason}`);
  }
  
  /**
   * Save the time spent on the current domain
   */
  saveCurrentDomainTime() {
    if (!this.isTracking || !this.currentDomain || !this.trackingStartTime) {
      return;
    }
    
    const now = Date.now();
    const timeSpent = now - this.trackingStartTime;
    
    // Only track if we spent a meaningful amount of time
    if (timeSpent >= CONFIG.MIN_TIME_TO_TRACK) {
      this.updateDomainTime(this.currentDomain, timeSpent);
    }
    
    this.trackingStartTime = now;
  }
  
  /**
   * Update time without stopping tracking
   */
  updateTimeWithoutStopping() {
    if (!this.isTracking || !this.currentDomain || !this.trackingStartTime) {
      return;
    }
    
    const now = Date.now();
    const timeSpent = now - this.lastUpdateTime;
    
    // Only update if we spent a meaningful amount of time
    if (timeSpent >= CONFIG.MIN_TIME_TO_TRACK) {
      this.updateDomainTime(this.currentDomain, timeSpent);
      this.lastUpdateTime = now;
    }
  }
  
  /**
   * Update the time spent on a domain in storage
   */
  updateDomainTime(domain, timeSpentMs) {
    // Convert to seconds for storage
    const timeSpentSeconds = Math.round(timeSpentMs / 1000);
    
    if (timeSpentSeconds <= 0) {
      return;
    }
    
    this.log(`Updating time for ${domain}: +${timeSpentSeconds} seconds`);
    
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
      if (CONFIG.TRACK_DAILY_USAGE) {
        website.dailyUsage = website.dailyUsage || {};
        website.dailyUsage[this.currentDateStr] = 
          (website.dailyUsage[this.currentDateStr] || 0) + timeSpentSeconds;
      }
      
      // Save updated data
      chrome.storage.local.set({ websites }, () => {
        if (chrome.runtime.lastError) {
          this.log('Error saving website data:', chrome.runtime.lastError);
        } else {
          this.log(`Updated time for ${domain}: Total = ${website.timeSpent}s, Today = ${website.dailyUsage[this.currentDateStr]}s`);
        }
      });
    });
  }
  
  /**
   * Check if the date has changed, and handle rollover
   */
  checkDateChange() {
    const today = new Date().toISOString().split('T')[0];
    
    if (today !== this.currentDateStr) {
      this.log(`Date changed from ${this.currentDateStr} to ${today}`);
      this.currentDateStr = today;
      
      // Run day change procedures
      this.handleDailyReset();
    }
  }
  
  /**
   * Handle reset actions when the day changes
   */
  handleDailyReset() {
    this.log('Performing daily reset procedures');
    
    // Here we could clear temporary data or perform other cleanup
    // We don't clear the dailyUsage as that's stored per-date already
  }
  
  /**
   * Start periodic updates
   */
  startPeriodicUpdates() {
    // Update current domain time periodically
    setInterval(() => {
      if (this.isTracking) {
        this.handleTimeTrackingUpdate({
          domain: this.currentDomain,
          reason: 'periodic',
          timestamp: Date.now()
        });
      }
    }, CONFIG.UPDATE_INTERVAL);
    
    // Cleanup old data periodically
    setInterval(() => {
      this.cleanupOldData();
    }, CONFIG.CLEANUP_INTERVAL);
  }
  
  /**
   * Clean up old usage data to prevent unlimited growth
   */
  cleanupOldData() {
    this.log('Running data cleanup procedure');
    
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
          this.log('Cleaned up old usage data');
        });
      }
    });
  }
  
  /**
   * Get time spent statistics for a domain
   */
  getTimeSpentStats(domain, callback) {
    chrome.storage.local.get(['websites'], (result) => {
      if (!result.websites) {
        callback({
          total: 0,
          today: 0,
          week: 0,
          average: 0
        });
        return;
      }
      
      const website = result.websites.find(site => site.domain === domain);
      
      if (!website) {
        callback({
          total: 0,
          today: 0,
          week: 0,
          average: 0
        });
        return;
      }
      
      // Calculate statistics
      const today = new Date().toISOString().split('T')[0];
      const todayUsage = website.dailyUsage && website.dailyUsage[today] 
        ? website.dailyUsage[today] : 0;
      
      // Calculate week usage
      let weekUsage = 0;
      if (CONFIG.TRACK_DAILY_USAGE && website.dailyUsage) {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - dayOfWeek);
        
        for (let i = 0; i <= 6; i++) {
          const date = new Date(weekStart);
          date.setDate(weekStart.getDate() + i);
          const dateStr = date.toISOString().split('T')[0];
          
          if (website.dailyUsage[dateStr]) {
            weekUsage += website.dailyUsage[dateStr];
          }
        }
      }
      
      // Calculate average daily usage over the last 28 days
      let totalDaysWithUsage = 0;
      let totalUsage = 0;
      
      if (CONFIG.TRACK_DAILY_USAGE && website.dailyUsage) {
        const now = new Date();
        
        for (let i = 0; i < 28; i++) {
          const date = new Date(now);
          date.setDate(now.getDate() - i);
          const dateStr = date.toISOString().split('T')[0];
          
          if (website.dailyUsage[dateStr]) {
            totalDaysWithUsage++;
            totalUsage += website.dailyUsage[dateStr];
          }
        }
      }
      
      const averageDailyUsage = totalDaysWithUsage > 0 
        ? Math.round(totalUsage / totalDaysWithUsage) 
        : 0;
      
      callback({
        total: website.timeSpent || 0,
        today: todayUsage,
        week: weekUsage,
        average: averageDailyUsage
      });
    });
  }
  
  /**
   * Get all website data
   */
  getAllWebsiteData(callback) {
    chrome.storage.local.get(['websites'], (result) => {
      callback(result.websites || []);
    });
  }
  
  /**
   * Utility logging function
   */
  log(...args) {
    if (CONFIG.DEBUG) {
      console.log('[TimeTracker]', ...args);
    }
  }
}

// Create and export the singleton instance
const timeTracker = new TimeTracker();
export default timeTracker; 