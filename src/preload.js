/**
 * preload.js — 微信多开插件 preload
 * 运行于 Electron preload 环境，拥有 Node.js 访问权限
 * 通过 window.services 向前端 UI 暴露受控接口
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const iconv = require('iconv-lite');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');

// ========== 常量 ==========

const basePath = path.join(os.homedir(), 'multiple_wechat');
if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

const HANDLE_EXE_PATH = path.join(basePath, 'handle.exe');
const HANDLE_ZIP_PATH = path.join(basePath, 'Handle.zip');
const HANDLE_ZIP_URL = 'https://download.sysinternals.com/files/Handle.zip';
const WECHAT_MUTEX_NAME = 'XWeChat_App_Instance_Identity_Mutex_Name';

// ========== 数据存储（基于 uTools dbStorage） ==========

const db = {
    get(key) {
        const device = utools.getNativeId();
        return utools.dbStorage.getItem(key + '_' + device);
    },
    set(key, value) {
        const device = utools.getNativeId();
        utools.dbStorage.setItem(key + '_' + device, value);
    },
};

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
    let filePath = db.get('wechatFilePath');
    const defaultPath = path.join(utools.getPath('documents'), 'xwechat_files');
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

    const order = db.get('accountOrder') || [];
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
    return new Promise((resolve, reject) => {
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
    return new Promise((resolve, reject) => {
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

function downloadHandle(onProgress) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(HANDLE_EXE_PATH)) return resolve('已存在');
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
                        resolve('下载成功');
                    } catch (err) { reject(new Error('解压失败: ' + err.message)); }
                });
            });
        }).catch(err => reject(new Error('下载失败: ' + err.message)));
    });
}

// ========== 暴露给前端的 API ==========

window.services = {
    // 配置状态
    getConfigStatus() {
        const handleExists = fs.existsSync(HANDLE_EXE_PATH);
        let handleDate = null;
        if (handleExists) {
            handleDate = new Date(fs.statSync(HANDLE_EXE_PATH).mtimeMs).toISOString().slice(0, 10);
        }
        return {
            handle: { installed: handleExists, date: handleDate, path: HANDLE_EXE_PATH },
            wechatPath: getWechatFilePath(),
        };
    },

    // 获取账号列表
    getWechatList() {
        const wechatFilePath = getWechatFilePath();
        if (!wechatFilePath) throw new Error('请先设置微信文档路径');
        return getSortedAccounts();
    },

    // 设置微信文档路径
    setWechatFilePath(dirPath) {
        if (!dirPath || !fs.existsSync(dirPath)) return { success: false, message: '目录不存在' };
        const globalConfig = path.join(dirPath, 'all_users', 'config', 'global_config');
        const pluginConfig = path.join(dirPath, 'all_users', 'plugin_save_config');
        if (!fs.existsSync(globalConfig) && !fs.existsSync(pluginConfig)) {
            return { success: false, message: '该目录不是有效的微信文档目录' };
        }
        db.set('wechatFilePath', dirPath);
        return { success: true };
    },

    // 下载 handle.exe
    async downloadHandle(onProgress) {
        return downloadHandle(onProgress);
    },

    // 启动微信
    async startWechat(itemData) {
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
                if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
                if (fs.existsSync(crcPath)) fs.rmSync(crcPath, { force: true });
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
            fs.rmSync(configPath, { force: true });
            fs.rmSync(configPath + '.crc', { force: true });
        }

        try { await releaseMutex(); } catch (e) {}

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
            throw new Error('获取微信EXE路径失败: ' + e.message);
        }

        binPath = path.join(binPath, 'Weixin.exe');
        if (!fs.existsSync(binPath)) throw new Error('微信EXE不存在: ' + binPath);
        utools.shellOpenPath(binPath);
    },

    // 保存当前登录
    async saveWechat() {
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

        db.set('wx_' + wxData.id, JSON.stringify(wxData));
        return wxData;
    },

    // 删除账号
    deleteWechat(itemData) {
        if (!fs.existsSync(itemData.path)) throw new Error('微信账号信息不存在');
        fs.rmSync(itemData.path, { recursive: true, force: true });
    },

    // 排序
    getAccountOrder() { return db.get('accountOrder') || []; },
    saveAccountOrder(order) { db.set('accountOrder', order); },

    // 打开文件夹
    openFolder(p) { utools.shellOpenPath(p); },
};
