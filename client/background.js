// background.js — ApplyAI Service Worker

// Show badge when extension is active
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
});

// Relay messages between popup and content scripts if needed
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'setBadge') {
    chrome.action.setBadgeText({ text: message.text || '' });
  }
  return true;
});
