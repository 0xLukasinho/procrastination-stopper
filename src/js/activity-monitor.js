// Content script to monitor user activity and report it to the background script
// This helps accurately determine when the browser is actually being used

// Throttle function to limit the frequency of activity updates
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

// Function to notify background script of activity
function reportActivity() {
  chrome.runtime.sendMessage({ action: 'userActivity' })
    .catch(() => {
      // Ignore errors - background might not be ready or might be restarting
    });
}

// Throttled version to avoid excessive messages
const throttledReportActivity = throttle(reportActivity, 3000);

// Listen for user interaction events
document.addEventListener('mousemove', throttledReportActivity);
document.addEventListener('mousedown', reportActivity); // Immediate on clicks
document.addEventListener('keydown', reportActivity);   // Immediate on key presses
document.addEventListener('scroll', throttledReportActivity);

// Also report activity when page loads
reportActivity();

// Report activity when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    reportActivity();
  }
});

// Periodic heartbeat (lower frequency)
setInterval(reportActivity, 10000); // Every 10 seconds 