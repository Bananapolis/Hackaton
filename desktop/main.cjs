const { app, BrowserWindow, Menu, shell, session, desktopCapturer } = require('electron');

const APP_URL = 'https://vialive.libreuni.com';
const TRUSTED_ORIGIN = 'https://vialive.libreuni.com';

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}

function isTrustedOrigin(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}` === TRUSTED_ORIGIN;
  } catch {
    return false;
  }
}

function configureDesktopPermissions() {
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (!isTrustedOrigin(requestingOrigin)) {
      return false;
    }

    return ['media', 'display-capture', 'fullscreen', 'notifications'].includes(permission);
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestUrl = details?.requestingUrl || webContents?.getURL() || '';
    if (!isTrustedOrigin(requestUrl)) {
      callback(false);
      return;
    }

    callback(['media', 'display-capture', 'fullscreen', 'notifications'].includes(permission));
  });

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!isTrustedOrigin(request.securityOrigin)) {
        callback({});
        return;
      }

      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      });

      if (!sources.length) {
        callback({});
        return;
      }

      callback({
        video: sources[0],
        audio: 'loopback'
      });
    } catch {
      callback({});
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: `${__dirname}/preload.cjs`
    }
  });

  Menu.setApplicationMenu(null);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(APP_URL).catch(() => {
    win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        '<h2>Unable to open VIA Live</h2><p>Please check your internet connection and try again.</p>'
      )}`
    );
  });
}

app.whenReady().then(() => {
  configureDesktopPermissions();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
