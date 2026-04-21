/**
 * dashboard-preload.js — 子窗口 preload
 * 复用 lib/ 模块，不再重复代码
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const iconv = require('iconv-lite');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');

const {
    initShared,
    getWechatFilePath,
    setWechatFilePath,
    getAccountOrder,
    saveAccountOrder,
    getHandleExePath,
} = require('./lib/shared');

const { downloadHandle, releaseFileLock, releaseMutex, HANDLE_EXE_PATH, WECHAT_MUTEX_NAME } = require('./lib/kill');

// ========== 初始化 ==========
initShared();

// ========== 工具函数 ==========

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
    let shmCount = 0;
    let walCount = 0;
    const files = fs.readdirSync(msgFolder);
    for (const file of files) {
        if (file.endsWith('.db-shm')) shmCount++;
        else if (file.endsWith('.db-wal')) walCount++;
        if (shmCount >= 4 && walCount >= 4) return true;
    }
    return false;
}

// ========== 按排序获取账号列表 ==========

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

    // 按保存顺序排序
    const order = getAccountOrder();
    const sorted = [];
    for (const id of order) {
        if (wxMap[id]) {
            sorted.push(wxMap[id]);
            delete wxMap[id];
        }
    }
    // 未排序的追加到末尾
    for (const id of Object.keys(wxMap)) {
        sorted.push(wxMap[id]);
    }

    return sorted;
}

// ========== RPC 函数 ==========

window.getConfigStatus = async () => {
    const handleExists = fs.existsSync(HANDLE_EXE_PATH);
    let handleDate = null;
    if (handleExists) {
        handleDate = new Date(fs.statSync(HANDLE_EXE_PATH).mtimeMs).toISOString().slice(0, 10);
    }
    return {
        handle: { installed: handleExists, date: handleDate, path: HANDLE_EXE_PATH },
        wechatPath: getWechatFilePath(),
    };
};

window.rpcDownloadHandle = async () => {
    return new Promise((resolve, reject) => {
        downloadHandle((pct) => {
            if (window.onDownloadProgress) window.onDownloadProgress(pct);
        }).then(resolve).catch(reject);
    });
};

window.getWechatList = async () => {
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');
    return getSortedAccounts();
};

window.setWechatFilePath = setWechatFilePath;

window.startWechat = async (itemData) => {
    if (!fs.existsSync(HANDLE_EXE_PATH)) {
        throw new Error('handle.exe 不存在，请先下载');
    }

    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');

    if (itemData) {
        if (!fs.existsSync(itemData.path)) throw new Error('微信账号信息不存在');

        const configPath = path.join(wechatFilePath, 'all_users', 'config', 'global_config');
        const crcPath = configPath + '.crc';

        // 释放文件锁
        try {
            await releaseFileLock(configPath);
        } catch (e) {
            window.logger?.warn('释放 config 锁失败', e?.message);
        }
        try {
            await releaseFileLock(crcPath);
        } catch (e) {
            window.logger?.warn('释放 crc 锁失败', e?.message);
        }

        // 尝试直接复制
        let copied = false;
        try {
            if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
            if (fs.existsSync(crcPath)) fs.rmSync(crcPath, { force: true });
            fs.copyFileSync(path.join(itemData.path, 'global_config'), configPath);
            fs.copyFileSync(path.join(itemData.path, 'global_config.crc'), crcPath);
            copied = true;
        } catch (e) {
            window.logger?.error('直接复制失败', e?.message);
        }

        // fallback: rename 策略
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
        const crcPath = configPath + '.crc';
        fs.rmSync(configPath, { force: true });
        fs.rmSync(crcPath, { force: true });
    }

    // 释放互斥锁
    try {
        await releaseMutex();
    } catch (e) {
        /* 没找到锁也继续 */
    }

    // 获取微信 EXE 路径
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
    utools.showNotification('登录完成后点击「保存当前登录」');
};

window.saveWechat = async () => {
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');

    const loginPath = path.join(wechatFilePath, 'all_users', 'login');
    if (!fs.existsSync(loginPath)) throw new Error('微信登录目录不存在');

    // 查找最新登录
    let latestTime = 0;
    let latestPath = null;
    for (const dir of fs.readdirSync(loginPath)) {
        const dirPath = path.join(loginPath, dir);
        if (!fs.statSync(dirPath).isDirectory()) continue;
        const shm = path.join(dirPath, 'key_info.db-shm');
        if (fs.existsSync(shm)) {
            const mtime = fs.statSync(shm).mtimeMs;
            if (mtime > latestTime) {
                latestTime = mtime;
                latestPath = dirPath;
            }
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

    // 复制头像
    const headImgDir = path.join(wechatFilePath, 'all_users', 'head_imgs', '0');
    if (fs.existsSync(headImgDir)) {
        let imgTime = 0, imgPath = null;
        function loopImg(dir) {
            for (const item of fs.readdirSync(dir)) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) loopImg(fullPath);
                else if (stat.isFile() && stat.mtimeMs > imgTime) {
                    imgTime = stat.mtimeMs;
                    imgPath = fullPath;
                }
            }
        }
        loopImg(headImgDir);
        if (imgPath) fs.copyFileSync(imgPath, path.join(wxidPath, 'logo.png'));
    }

    const wxData = {
        id: wxid,
        logo: path.join(wxidPath, 'logo.png'),
        name: wxid,
        path: wxidPath,
        isLogin: isAccountLoggedIn(path.join(wechatFilePath, wxid)),
    };

    window.dbDevice.setItem('wx_' + wxData.id, JSON.stringify(wxData));
    return wxData;
};

window.deleteWechat = (itemData) => {
    if (!fs.existsSync(itemData.path)) throw new Error('微信账号信息不存在');
    fs.rmSync(itemData.path, { recursive: true, force: true });
};

window.openFolder = (folderPath) => {
    utools.shellOpenPath(folderPath);
};

window.getAccountOrder = getAccountOrder;
window.saveAccountOrder = saveAccountOrder;
