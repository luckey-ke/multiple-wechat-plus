require('./lib/utoolsHelp');

const { wechatHelp } = require('./lib/wechatHelp');
const { downloadHandle, HANDLE_EXE_PATH } = require('./lib/kill');
const { GoConfigError } = require('./lib/error');
const fs = require('fs');
const path = require('path');

// ========== 后端逻辑函数（非 window，仅内部使用） ==========

async function _getConfigStatus() {
  const handleExists = fs.existsSync(HANDLE_EXE_PATH);
  let handleDate = null;
  if (handleExists) {
    const stat = fs.statSync(HANDLE_EXE_PATH);
    handleDate = new Date(stat.mtimeMs).toISOString().slice(0, 10);
  }

  let filePath = window.dbDevice.getItem('wechatFilePath');
  const defaultPath = path.join(utools.getPath('documents'), 'xwechat_files');
  if (!filePath || !fs.existsSync(filePath)) {
    filePath = fs.existsSync(defaultPath) ? defaultPath : null;
  }

  return {
    handle: { installed: handleExists, date: handleDate, path: HANDLE_EXE_PATH },
    wechatPath: filePath
  };
}

async function _rpcDownloadHandle() {
  await downloadHandle();
  return { success: true };
}

async function _getWechatList() {
  try {
    return await wechatHelp.getLocalWechatAccountList();
  } catch (e) {
    if (e instanceof GoConfigError) throw new Error('请先完成配置: ' + e.message);
    throw e;
  }
}

async function _startWechat(itemData) {
  try {
    await wechatHelp.startWx(itemData);
  } catch (e) {
    if (e instanceof GoConfigError) throw new Error('请先完成配置: ' + e.message);
    throw e;
  }
}

async function _saveWechat() {
  try {
    return await wechatHelp.saveWxData();
  } catch (e) {
    if (e instanceof GoConfigError) throw new Error('请先完成配置: ' + e.message);
    throw e;
  }
}

function _deleteWechat(itemData) {
  wechatHelp.deleteWechat(itemData);
}

function _openFolder(folderPath) {
  utools.shellOpenPath(folderPath);
}

function _getAccountOrder() {
  return window.dbDevice.getItem('accountOrder') || [];
}

function _saveAccountOrder(order) {
  window.dbDevice.setItem('accountOrder', order);
}

// ========== 仪表盘窗口 ==========

let dashboardWin = null;

function openDashboard() {
  // 如果窗口已存在，聚焦并刷新
  if (dashboardWin) {
    try {
      dashboardWin.show();
      dashboardWin.webContents.executeJavaScript('loadDashboard && loadDashboard()');
      return;
    } catch (e) {
      dashboardWin = null;
    }
  }

  dashboardWin = utools.createBrowserWindow('index.html', {
    width: 720,
    height: 640,
    minHeight: 400,
    minWidth: 500,
    title: '微信多开仪表盘',
    resizable: true,
    alwaysOnTop: false,
    frame: true,
  }, () => {
    // 窗口加载完成，注入 RPC 桥接
    const bridge = `
      window._rpc = {
        getConfigStatus: async () => {
          return new Promise((resolve, reject) => {
            try {
              const result = require('electron').ipcRenderer;
              // 回退: 直接通过 postMessage 与主窗口通信
            } catch(e) {}
          });
        }
      };
    `;
  });

  // 监听窗口关闭
  dashboardWin.on('closed', () => {
    dashboardWin = null;
  });

  // 向子窗口注入 RPC 函数（通过 webContents.executeJavaScript）
  // 但由于同源策略，preload 中的 require 在子窗口不可用
  // 解决方案：通过 IPC 让子窗口调用主窗口的函数
  const { ipcMain } = require('electron');

  // 注册 IPC 处理（幂等）
  if (!ipcMain._dashboardRegistered) {
    ipcMain._dashboardRegistered = true;

    ipcMain.handle('dashboard:getConfigStatus', async () => _getConfigStatus());
    ipcMain.handle('dashboard:downloadHandle', async () => _rpcDownloadHandle());
    ipcMain.handle('dashboard:getWechatList', async () => _getWechatList());
    ipcMain.handle('dashboard:startWechat', async (_e, itemData) => _startWechat(itemData));
    ipcMain.handle('dashboard:saveWechat', async () => _saveWechat());
    ipcMain.handle('dashboard:deleteWechat', (_e, itemData) => _deleteWechat(itemData));
    ipcMain.handle('dashboard:openFolder', (_e, p) => _openFolder(p));
    ipcMain.handle('dashboard:saveAccountOrder', (_e, order) => _saveAccountOrder(order));
  }

  // 注入 renderer 端 bridge（在页面加载后执行）
  dashboardWin.webContents.once('did-finish-load', () => {
    dashboardWin.webContents.executeJavaScript(`
      const { ipcRenderer } = require('electron');
      window.getConfigStatus = () => ipcRenderer.invoke('dashboard:getConfigStatus');
      window.rpcDownloadHandle = () => ipcRenderer.invoke('dashboard:downloadHandle');
      window.getWechatList = () => ipcRenderer.invoke('dashboard:getWechatList');
      window.startWechat = (d) => ipcRenderer.invoke('dashboard:startWechat', d);
      window.saveWechat = () => ipcRenderer.invoke('dashboard:saveWechat');
      window.deleteWechat = (d) => ipcRenderer.invoke('dashboard:deleteWechat', d);
      window.openFolder = (p) => ipcRenderer.invoke('dashboard:openFolder', p);
      window.saveAccountOrder = (o) => ipcRenderer.invoke('dashboard:saveAccountOrder', o);
      // 通知页面 bridge 就绪
      window.dispatchEvent(new Event('dashboard-ready'));
    `);
  });
}

// ========== uTools 入口 ==========

window.exports = {
  dashboard: {
    mode: 'none',
    args: {
      enter: () => {
        utools.hideMainWindow();
        openDashboard();
      }
    }
  },

  wechat_file_path: {
    mode: 'none',
    args: {
      enter: ({ payload }) => {
        utools.hideMainWindow();
        if (payload && payload.length > 0) {
          try {
            wechatHelp.saveWechatFilePath(payload[0].path);
            utools.showNotification('路径保存成功');
          } catch (e) {
            utools.showNotification('保存失败: ' + e.message);
          }
        } else {
          utools.showNotification('未检测到路径');
        }
        utools.outPlugin();
      }
    }
  }
};
