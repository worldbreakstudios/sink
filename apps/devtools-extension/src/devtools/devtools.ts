// Create the DevTools panel
chrome.devtools.panels.create(
  'Sink SQLite',
  '',
  'src/panel/index.html',
  () => {
    console.log('Sink SQLite DevTools panel created')
  }
)
