chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "closeTab" && sender.tab) {
    chrome.tabs.remove(sender.tab.id);
  }
});
