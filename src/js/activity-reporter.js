/**
 * Activity Reporter (Content Script)
 * 
 * Simplified detection and reporting of user activity events to the Activity Manager.
 * This script only detects and reports - it makes no decisions about activity state.
 */

// Helper function to throttle events to avoid excessive messages
function throttle(callback, delay) {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      callback(...args);
    }
  };
}

// Send activity event to the background script
function reportActivity(type, detail = {}) {
  chrome.runtime.sendMessage({
    action: 'activityEvent',
    eventType: type,
    timestamp: Date.now(),
    detail: detail
  }).catch(() => {
    // Ignore errors - background might not be ready
  });
}

// Throttled versions for high-frequency events
const reportMouseMove = throttle(() => reportActivity('mousemove'), 3000);
const reportScroll = throttle(() => reportActivity('scroll'), 3000);

// Direct reporting for discrete events
function reportMouseClick() {
  reportActivity('mouseclick');
}

function reportKeyPress() {
  reportActivity('keypress');
}

function reportVisibilityChange() {
  reportActivity('visibilitychange', {
    visible: !document.hidden
  });
}

// Initialization function
function initActivityReporter() {
  // Report initial state
  reportActivity('init', {
    url: window.location.href,
    visible: !document.hidden
  });

  // Setup event listeners
  document.addEventListener('mousemove', reportMouseMove, { passive: true });
  document.addEventListener('click', reportMouseClick, { passive: true });
  document.addEventListener('keydown', reportKeyPress, { passive: true });
  document.addEventListener('scroll', reportScroll, { passive: true });
  document.addEventListener('visibilitychange', reportVisibilityChange);

  // Send a heartbeat every 15 seconds while page is visible
  setInterval(() => {
    if (!document.hidden) {
      reportActivity('heartbeat');
    }
  }, 15000);

  // Report when page becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      reportActivity('pagevisible');
    }
  });
}

// Start activity reporting
initActivityReporter(); 