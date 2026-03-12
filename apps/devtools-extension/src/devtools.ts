const panelUrl = `panel.html?tabId=${chrome.devtools.inspectedWindow.tabId}`

chrome.devtools.panels.create('Sink', '', panelUrl)
