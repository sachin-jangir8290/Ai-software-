const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#0f0f14',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), webviewTag: true, contextIsolation: true }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

// Calls Claude from the main process so the API key never touches page content.
ipcMain.handle('ai:ask', async (_e, { apiKey, model, system, messages }) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 2048, system, messages })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
});

// Open popups / target=_blank links as new Nova tabs.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => {
    contents.hostWebContents?.send('open-tab', url);
    return { action: 'deny' };
  });
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
