// dashboard-preload.js — 子窗口专用 preload，直接拥有 Node.js 上下文
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// 复用主窗口的模块（通过 electron remote 或重新 require）
// 由于 uTools createBrowserWindow 共享 node_modules，可以直接 require
const iconv = require('iconv-lite');
const { exec } = require('child_process');
const os = require('os');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');

// ========== 工具 ==========

class GoConfigError extends Error {}

function createLogger() {
  const tmpDir = os.tmpdir();
  const logPath = path.join(tmpDir, 'multiple_wechat_dashboard.log');
  return {
    log: (...args) => {},
    info: (...args) => {},
    warn: (...args) => {},
    error: (...args) => {},
  };
}
const logger = createLogger();

// ========== dbDevice ==========

window.dbDevice = {
  getItem(name) {
    const device = utools.getNativeId();
    return utools.dbStorage.getItem(name + '_' + device);
  },
  setItem(name, value) {
    const device = utools.getNativeId();
    utools.dbStorage.setItem(name + '_' + device, value);
  },
  deleteItem(name) {
    const device = utools.getNativeId();
    utools.dbStorage.removeItem(name + '_' + device);
  }
};

// ========== handle.exe ==========

const basePath = path.join(os.homedir(), 'multiple_wechat');
if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
const HANDLE_EXE_PATH = path.join(basePath, 'handle.exe');
const HANDLE_ZIP_PATH = path.join(basePath, 'Handle.zip');
const HANDLE_ZIP_URL = 'https://download.sysinternals.com/files/Handle.zip';

function downloadHandle() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(HANDLE_EXE_PATH)) return resolve('已存在');
    fetch(HANDLE_ZIP_URL)
      .then(res => {
        if (res.status !== 200) throw new Error('下载失败');
        const file = fs.createWriteStream(HANDLE_ZIP_PATH);
        res.body.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            try {
              const zip = new AdmZip(HANDLE_ZIP_PATH);
              zip.extractAllTo(basePath, true);
              fs.unlinkSync(HANDLE_ZIP_PATH);
              resolve('下载成功');
            } catch (err) {
              reject('解压失败: ' + err.message);
            }
          });
        });
      })
      .catch(err => reject('下载失败: ' + err.message));
  });
}

// ========== 微信路径 ==========

function getWechatFilePath() {
  let filePath = window.dbDevice.getItem('wechatFilePath');
  const defaultPath = path.join(utools.getPath('documents'), 'xwechat_files');
  if (!filePath || !fs.existsSync(filePath)) {
    filePath = fs.existsSync(defaultPath) ? defaultPath : null;
  }
  return filePath;
}

// ========== 文件工具 ==========

function findDirName(findDir, name) {
  const dirs = fs.readdirSync(findDir);
  for (const dir of dirs) {
    const dirPath = path.join(findDir, dir);
    if (fs.statSync(dirPath).isDirectory() && dir.includes(name)) {
      return dirPath;
    }
  }
  return null;
}

function isAccountLoggedIn(accountPath) {
  const msgFolder = path.join(accountPath, 'db_storage', 'message');
  if (!fs.existsSync(msgFolder)) return false;
  let shmCount = 0, walCount = 0;
  const files = fs.readdirSync(msgFolder);
  for (const file of files) {
    if (file.endsWith('.db-shm')) shmCount++;
    else if (file.endsWith('.db-wal')) walCount++;
    if (shmCount >= 4 && walCount >= 4) return true;
  }
  return false;
}

// ========== RPC 函数 ==========

window.getConfigStatus = async () => {
  const handleExists = fs.existsSync(HANDLE_EXE_PATH);
  let handleDate = null;
  if (handleExists) {
    const stat = fs.statSync(HANDLE_EXE_PATH);
    handleDate = new Date(stat.mtimeMs).toISOString().slice(0, 10);
  }
  return {
    handle: { installed: handleExists, date: handleDate, path: HANDLE_EXE_PATH },
    wechatPath: getWechatFilePath()
  };
};

window.rpcDownloadHandle = async () => {
  await downloadHandle();
  return { success: true };
};

window.getWechatList = async () => {
  const wechatFilePath = getWechatFilePath();
  if (!wechatFilePath) throw new Error('请先设置微信文档路径');

  const configDirPath = path.join(wechatFilePath, 'all_users', 'plugin_save_config');
  if (!fs.existsSync(configDirPath)) return [];

  const dirs = fs.readdirSync(configDirPath);
  const wxList = [];
  for (const dir of dirs) {
    const wxidPath = path.join(configDirPath, dir);
    if (!fs.statSync(wxidPath).isDirectory()) continue;
    const wxid = dir;
    const wxidRealPath = findDirName(wechatFilePath, wxid);
    wxList.push({
      id: wxid,
      logo: path.join(wxidPath, 'logo.png'),
      name: wxid,
      path: wxidPath,
      accountPath: wxidRealPath,
      isLogin: isAccountLoggedIn(wxidRealPath)
    });
  }
  return wxList;
};

window.startWechat = async (itemData) => {
  // 互斥体名称
  const WECHAT_MUTEX = 'XWeChat_App_Instance_Identity_Mutex_Name';

  if (!fs.existsSync(HANDLE_EXE_PATH)) {
    throw new Error('handle.exe 不存在，请先下载');
  }

  const wechatFilePath = getWechatFilePath();
  if (!wechatFilePath) throw new Error('请先设置微信文档路径');

  if (itemData) {
    if (!fs.existsSync(itemData.path)) throw new Error('微信账号信息不存在');
    const configPath = wechatFilePath + '\\all_users\\config\\global_config';
    const crcPath = configPath + '.crc';

    // 释放文件锁并复制
    try {
      exec(`"${HANDLE_EXE_PATH}" -p weixin "${configPath}"`, (err, stdout) => {
        if (!err) {
          const matches = stdout.match(/pid: (\d+)\s+type: (.*?)\s+([a-zA-Z0-9]+):/ig);
          if (matches) {
            for (const m of matches) {
              const match = m.match(/pid: (\d+)\s+type: (.*?)\s+([a-zA-Z0-9]+):/i);
              if (match) {
                exec(`"${HANDLE_EXE_PATH}" -c ${match[3]} -p ${match[1]} -y`);
              }
            }
          }
        }
      });
    } catch (e) { /* ignore */ }

    try {
      if (fs.existsSync(configPath)) fs.renameSync(configPath, configPath + '.bak');
      if (fs.existsSync(crcPath)) fs.renameSync(crcPath, crcPath + '.bak');
      fs.copyFileSync(path.join(itemData.path, 'global_config'), configPath);
      fs.copyFileSync(path.join(itemData.path, 'global_config.crc'), crcPath);
    } catch (e) {
      throw new Error('无法替换配置文件: ' + e.message);
    }
  } else {
    const configPath = wechatFilePath + '\\all_users\\config\\global_config';
    const crcPath = configPath + '.crc';
    fs.rmSync(configPath, { force: true });
    fs.rmSync(crcPath, { force: true });
  }

  // 杀互斥
  try {
    await new Promise((resolve, reject) => {
      exec(`"${HANDLE_EXE_PATH}" -accepteula -p weixin -a ${WECHAT_MUTEX}`, (err, stdout) => {
        if (err) return resolve(); // 没找到也继续
        const match = stdout.match(/pid: (\d+)\s+type: (.*?)\s+([a-zA-Z0-9]+):/i);
        if (!match) return resolve();
        const [, pid, , handleId] = match;
        let ps = 'powershell';
        if (fs.existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')) {
          ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
        }
        exec(`${ps} Start-Process "${HANDLE_EXE_PATH}" -ArgumentList @('-c','${handleId}','-p','${pid}','-y') -Verb RunAs -Wait`, () => resolve());
      });
    });
  } catch (e) { /* ignore */ }

  // 从注册表获取微信路径
  let binPath = null;
  try {
    binPath = await new Promise((resolve, reject) => {
      exec('REG QUERY HKEY_CURRENT_USER\\Software\\Tencent\\Weixin /v InstallPath', { encoding: 'buffer' }, (err, stdout) => {
        if (err) return reject(err);
        const data = iconv.decode(stdout, 'gbk').toString();
        const matches = data.match(/[a-zA-Z]*?:.*/);
        if (matches) return resolve(matches[0]);
        reject(new Error('注册表无微信路径'));
      });
    });
  } catch (e) {
    throw new Error('获取微信EXE路径失败');
  }

  binPath = binPath + '\\Weixin.exe';
  if (!fs.existsSync(binPath)) throw new Error('微信EXE不存在: ' + binPath);

  utools.shellOpenPath(binPath);
  utools.showNotification('登录完成后请在搜索框输入 wxok 保存');
};

window.saveWechat = async () => {
  // 需要主窗口的完整 wechatHelp 逻辑，这里简化：通过 IPC 请求主窗口
  return new Promise((resolve, reject) => {
    reject(new Error('请在主窗口搜索 wxok 保存登录信息'));
  });
};

window.deleteWechat = (itemData) => {
  if (!fs.existsSync(itemData.path)) throw new Error('微信账号信息不存在');
  fs.rmSync(itemData.path, { recursive: true, force: true });
};

window.openFolder = (folderPath) => {
  utools.shellOpenPath(folderPath);
};

window.getAccountOrder = () => {
  return window.dbDevice.getItem('accountOrder') || [];
};

window.saveAccountOrder = (order) => {
  window.dbDevice.setItem('accountOrder', order);
};
