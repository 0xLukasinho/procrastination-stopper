// This script runs on all pages
// It communicates with the background script to handle website blocking

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkBlocked') {
    // Send back the current URL
    sendResponse({ url: window.location.href });
  }
  return true;
});

// Function to check if current page should be blocked
function checkIfBlocked() {
  const domain = window.location.hostname.replace('www.', '');
  
  chrome.runtime.sendMessage({ 
    action: 'isBlocked', 
    domain: domain 
  }, (response) => {
    if (response && response.blocked) {
      // Redirect to blocked page
      window.location.href = chrome.runtime.getURL('html/blocked.html');
    }
  });
}

// Check if page is blocked when it loads
checkIfBlocked(); 