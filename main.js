/**
 * main.js — Electron 主进程
 * 创建窗口、处理 IPC 通信、系统对话框
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const iconv = require('iconv-lite');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');

// ========== 常量 ==========
const basePath = path.join(os.homedir(), 'multiple_wechat');
if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

const HANDLE_EXE_PATH = path.join(basePath, 'handle.exe');
const HANDLE_ZIP_PATH = path.join(basePath, 'Handle.zip');
const HANDLE_ZIP_URL = 'https://download.sysinternals.com/files/Handle.zip';
const WECHAT_MUTEX_NAME = 'XWeChat_App_Instance_Identity_Mutex_Name';

// ========== 数据存储（JSON 文件持久化）==========
const DATA_DIR = path.join(app.getPath('userData'), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const STORE_PATH = path.join(DATA_DIR, 'store.json');

function loadStore() {
    try {
        if (fs.existsSync(STORE_PATH)) {
            return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
        }
    } catch (e) { /* ignore */ }
    return {};
}

function saveStore(data) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function storeGet(key) {
    return loadStore()[key] ?? null;
}

function storeSet(key, value) {
    const data = loadStore();
    data[key] = value;
    saveStore(data);
}

// ========== 日志 ==========
const LOG_PATH = path.join(DATA_DIR, 'app.log');
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a', encoding: 'utf8' });

function log(level, ...args) {
    const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    const line = `${level} [${new Date().toISOString()}] ${msg}\n`;
    logStream.write(line);
    if (level === 'ERROR') console.error(line.trim());
}

// ========== 工具函数 ==========

function findDirName(findDir, name) {
    try {
        const dirs = fs.readdirSync(findDir);
        for (const dir of dirs) {
            const dirPath = path.join(findDir, dir);
            if (fs.statSync(dirPath).isDirectory() && dir.includes(name)) {
                return dirPath;
            }
        }
    } catch (e) { /* ignore */ }
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

function getWechatFilePath() {
    let filePath = storeGet('wechatFilePath');
    const defaultPath = path.join(app.getPath('documents'), 'xwechat_files');
    if (!filePath || !fs.existsSync(filePath)) {
        filePath = fs.existsSync(defaultPath) ? defaultPath : null;
    }
    return filePath;
}

function getSortedAccounts() {
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) return [];

    const configDirPath = path.join(wechatFilePath, 'all_users', 'plugin_save_config');
    if (!fs.existsSync(configDirPath)) return [];

    const dirs = fs.readdirSync(configDirPath);
    const wxMap = {};

    for (const dir of dirs) {
        const wxidPath = path.join(configDirPath, dir);
        if (!fs.statSync(wxidPath).isDirectory()) continue;
        const wxid = dir;
        const wxidRealPath = findDirName(wechatFilePath, wxid);
        wxMap[wxid] = {
            id: wxid,
            logo: path.join(wxidPath, 'logo.png'),
            name: wxid,
            path: wxidPath,
            accountPath: wxidRealPath,
            isLogin: wxidRealPath ? isAccountLoggedIn(wxidRealPath) : false,
        };
    }

    const order = storeGet('accountOrder') || [];
    const sorted = [];
    for (const id of order) {
        if (wxMap[id]) { sorted.push(wxMap[id]); delete wxMap[id]; }
    }
    for (const id of Object.keys(wxMap)) sorted.push(wxMap[id]);
    return sorted;
}

// ========== handle.exe 相关 ==========

function closeHandle(pid, handleId) {
    return new Promise((resolve) => {
        let powershell = 'powershell';
        if (fs.existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')) {
            powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
        }
        const timer = setTimeout(() => resolve(), 3000);
        const command = `${powershell} Start-Process "${HANDLE_EXE_PATH}" -ArgumentList @('-c','${handleId}','-p','${pid}','-y') -Verb RunAs -Wait`;
        exec(command, () => { clearTimeout(timer); resolve(); });
    });
}

function releaseMutex() {
    if (!fs.existsSync(HANDLE_EXE_PATH)) throw new Error('handle.exe 不存在');
    return new Promise((resolve) => {
        exec(`"${HANDLE_EXE_PATH}" -accepteula -p weixin -a ${WECHAT_MUTEX_NAME}`, (err, stdout) => {
            if (err) return resolve();
            const match = stdout.match(/pid: (\d+)\s+type: (.*?)\s+([a-zA-Z0-9]+):/i);
            if (!match) return resolve();
            const [, pid, , handleId] = match;
            closeHandle(pid, handleId).then(resolve).catch(resolve);
        });
    });
}

function releaseFileLock(filePath) {
    if (!fs.existsSync(HANDLE_EXE_PATH)) throw new Error('handle.exe 不存在');
    return new Promise((resolve) => {
        exec(`"${HANDLE_EXE_PATH}" -p weixin "${filePath}"`, (err, stdout) => {
            if (err) return resolve();
            const matches = stdout.match(/pid: (\d+)\s+type: (.*?)\s+([a-zA-Z0-9]+):/gi);
            if (!matches) return resolve();
            let completed = 0;
            function next() {
                if (completed >= matches.length) return resolve();
                const content = matches[completed];
                const match = content.match(/pid: (\d+)\s+type: (.*?)\s+([a-zA-Z0-9]+):/i);
                if (!match) { completed++; return next(); }
                const [, pid, , handleId] = match;
                exec(`"${HANDLE_EXE_PATH}" -c ${handleId} -p ${pid} -y`, () => { completed++; next(); });
            }
            next();
        });
    });
}

// 安全删除文件（带重试），处理 Windows 文件锁定
async function safeUnlink(filePath, retries = 3, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
            return true;
        } catch (e) {
            if (i < retries - 1) {
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
    }
    return false;
}

function downloadHandle() {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(HANDLE_EXE_PATH)) return resolve('已存在');
        log('INFO', '开始下载 handle.exe...');
        fetch(HANDLE_ZIP_URL).then(res => {
            if (res.status !== 200) throw new Error('HTTP ' + res.status);
            const file = fs.createWriteStream(HANDLE_ZIP_PATH);
            res.body.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    try {
                        const zip = new AdmZip(HANDLE_ZIP_PATH);
                        zip.extractAllTo(basePath, true);
                        fs.unlinkSync(HANDLE_ZIP_PATH);
                        log('INFO', 'handle.exe 下载解压成功');
                        resolve('下载成功');
                    } catch (err) { reject(new Error('解压失败: ' + err.message)); }
                });
            });
        }).catch(err => reject(new Error('下载失败: ' + err.message)));
    });
}

// ========== 查询注册表 ==========

function queryRegistry(regQuery) {
    return new Promise((resolve, reject) => {
        exec('chcp', (_err, stdout) => {
            const page = stdout ? stdout.replace(/[^0-9]/g, '') : '936';
            const encoding = page === '65001' ? 'utf-8' : 'gbk';
            exec(`REG QUERY ${regQuery}`, { encoding: 'buffer' }, (error, buf) => {
                if (error) return reject(error);
                const data = iconv.decode(buf, encoding).toString();
                const matches = data.match(/[a-zA-Z]*?:.*/);
                resolve(matches ? matches[0] : null);
            });
        });
    });
}

// ========== Electron 窗口 ==========

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 720,
        height: 700,
        minWidth: 600,
        minHeight: 500,
        title: '微信多开助手',
        icon: path.join(__dirname, 'src', 'logo.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        autoHideMenuBar: true,
        show: false,
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
    mainWindow.once('ready-to-show', () => mainWindow.show());

    // 开发模式自动打开 DevTools
    mainWindow.webContents.openDevTools({ mode: 'detach' });

    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ========== IPC 处理 ==========

// 配置状态
ipcMain.handle('getConfigStatus', () => {
    const handleExists = fs.existsSync(HANDLE_EXE_PATH);
    let handleDate = null;
    if (handleExists) {
        handleDate = new Date(fs.statSync(HANDLE_EXE_PATH).mtimeMs).toISOString().slice(0, 10);
    }
    return {
        handle: { installed: handleExists, date: handleDate, path: HANDLE_EXE_PATH },
        wechatPath: getWechatFilePath(),
    };
});

// 获取账号列表
ipcMain.handle('getWechatList', () => {
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');
    return getSortedAccounts();
});

// 设置微信文档路径
ipcMain.handle('setWechatFilePath', (_event, dirPath) => {
    if (!dirPath || !fs.existsSync(dirPath)) return { success: false, message: '目录不存在' };
    const globalConfig = path.join(dirPath, 'all_users', 'config', 'global_config');
    const pluginConfig = path.join(dirPath, 'all_users', 'plugin_save_config');
    if (!fs.existsSync(globalConfig) && !fs.existsSync(pluginConfig)) {
        return { success: false, message: '该目录不是有效的微信文档目录' };
    }
    storeSet('wechatFilePath', dirPath);
    return { success: true };
});

// 下载 handle.exe
ipcMain.handle('downloadHandle', async () => {
    return downloadHandle();
});

// 选择文件夹对话框
ipcMain.handle('selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择微信文档文件夹 (xwechat_files)',
        properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

// 启动微信
ipcMain.handle('startWechat', async (_event, itemData) => {
    if (!fs.existsSync(HANDLE_EXE_PATH)) throw new Error('handle.exe 不存在，请先下载');
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');

    if (itemData) {
        if (!fs.existsSync(itemData.path)) throw new Error('微信账号信息不存在');
        const configPath = path.join(wechatFilePath, 'all_users', 'config', 'global_config');
        const crcPath = configPath + '.crc';

        try { await releaseFileLock(configPath); } catch (e) {}
        try { await releaseFileLock(crcPath); } catch (e) {}

        let copied = false;
        try {
            await safeUnlink(configPath);
            await safeUnlink(crcPath);
            fs.copyFileSync(path.join(itemData.path, 'global_config'), configPath);
            fs.copyFileSync(path.join(itemData.path, 'global_config.crc'), crcPath);
            copied = true;
        } catch (e) {}

        if (!copied) {
            try {
                if (fs.existsSync(configPath)) fs.renameSync(configPath, configPath + '.bak');
                if (fs.existsSync(crcPath)) fs.renameSync(crcPath, crcPath + '.bak');
                fs.copyFileSync(path.join(itemData.path, 'global_config'), configPath);
                fs.copyFileSync(path.join(itemData.path, 'global_config.crc'), crcPath);
            } catch (e) {
                throw new Error('无法替换配置文件: ' + e.message);
            }
        }
    } else {
        const configPath = path.join(wechatFilePath, 'all_users', 'config', 'global_config');
        try { await releaseFileLock(configPath); } catch (e) {}
        try { await releaseFileLock(configPath + '.crc'); } catch (e) {}
        await safeUnlink(configPath);
        await safeUnlink(configPath + '.crc');
    }

    try { await releaseMutex(); } catch (e) {}

    let binPath = null;
    try {
        binPath = await queryRegistry('HKEY_CURRENT_USER\\Software\\Tencent\\Weixin /v InstallPath');
    } catch (e) {
        throw new Error('获取微信EXE路径失败: ' + e.message);
    }

    binPath = path.join(binPath, 'Weixin.exe');
    if (!fs.existsSync(binPath)) throw new Error('微信EXE不存在: ' + binPath);
    shell.openPath(binPath);

    new Notification({ title: '微信多开助手', body: '登录完成后点击「保存当前登录」' }).show();
});

// 保存当前登录
ipcMain.handle('saveWechat', async () => {
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');
    const loginPath = path.join(wechatFilePath, 'all_users', 'login');
    if (!fs.existsSync(loginPath)) throw new Error('微信登录目录不存在');

    let latestTime = 0, latestPath = null;
    for (const dir of fs.readdirSync(loginPath)) {
        const dirPath = path.join(loginPath, dir);
        if (!fs.statSync(dirPath).isDirectory()) continue;
        const shm = path.join(dirPath, 'key_info.db-shm');
        if (fs.existsSync(shm)) {
            const mtime = fs.statSync(shm).mtimeMs;
            if (mtime > latestTime) { latestTime = mtime; latestPath = dirPath; }
        }
    }
    if (!latestPath) throw new Error('未找到 key_info.db');

    const wxid = path.basename(latestPath);
    const wxidPath = path.join(wechatFilePath, 'all_users', 'plugin_save_config', wxid);
    if (!fs.existsSync(wxidPath)) fs.mkdirSync(wxidPath, { recursive: true });

    const configSrc = path.join(wechatFilePath, 'all_users', 'config', 'global_config');
    const crcSrc = configSrc + '.crc';
    if (!fs.existsSync(configSrc)) throw new Error('global_config 不存在');

    fs.copyFileSync(configSrc, path.join(wxidPath, 'global_config'));
    fs.copyFileSync(crcSrc, path.join(wxidPath, 'global_config.crc'));

    const headImgDir = path.join(wechatFilePath, 'all_users', 'head_imgs', '0');
    if (fs.existsSync(headImgDir)) {
        let imgTime = 0, imgPath = null;
        (function loopImg(dir) {
            for (const item of fs.readdirSync(dir)) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) loopImg(fullPath);
                else if (stat.isFile() && stat.mtimeMs > imgTime) { imgTime = stat.mtimeMs; imgPath = fullPath; }
            }
        })(headImgDir);
        if (imgPath) fs.copyFileSync(imgPath, path.join(wxidPath, 'logo.png'));
    }

    const wxData = {
        id: wxid,
        logo: path.join(wxidPath, 'logo.png'),
        name: wxid,
        path: wxidPath,
        isLogin: isAccountLoggedIn(path.join(wechatFilePath, wxid)),
    };

    storeSet('wx_' + wxData.id, JSON.stringify(wxData));
    return wxData;
});

// 删除账号
ipcMain.handle('deleteWechat', (_event, itemData) => {
    if (!fs.existsSync(itemData.path)) throw new Error('微信账号信息不存在');
    fs.rmSync(itemData.path, { recursive: true, force: true });
});

// 排序
ipcMain.handle('getAccountOrder', () => storeGet('accountOrder') || []);
ipcMain.handle('saveAccountOrder', (_event, order) => storeSet('accountOrder', order));

// 打开文件夹
ipcMain.handle('openFolder', (_event, p) => shell.openPath(p));
