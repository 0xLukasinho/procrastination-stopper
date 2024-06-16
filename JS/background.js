chrome.runtime.onInstalled.addListener(() => {
    // Initialize extension
  });
  
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Track time and enforce limits
  });
