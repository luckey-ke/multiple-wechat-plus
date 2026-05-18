/**
 * wechatService.js — 微信账号管理服务
 *
 * 提供微信多开的核心业务逻辑：
 * - 账号列表查询与排序
 * - 配置文件切换与备份
 * - 微信进程启动
 * - 在线状态检测
 *
 * 本模块是 preload.js 和 dashboard-preload.js 的共享业务层，
 * 避免在多个 preload 脚本中重复实现相同逻辑。
 *
 * @module wechatService
 * @requires fs
 * @requires path
 * @requires iconv-lite
 * @requires child_process
 * @requires ./shared
 * @requires ./kill
 * @requires ./file
 */

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const { exec } = require('child_process');
const { getWechatFilePath, setWechatFilePath } = require('./shared');
var nicknameModule = require('./nickname');
const { releaseMutex, releaseFileLock, HANDLE_EXE_PATH } = require('./kill');
const { findDirName, findLatestFile, findLatestFileAll } = require('./file');

// ============================================================
// 常量定义
// ============================================================

/**
 * 微信数据目录结构常量
 * @readonly
 */
const WECHAT_PATHS = {
    /** 全局配置目录 */
    CONFIG_DIR: 'all_users/config',
    /** 全局配置文件名 */
    GLOBAL_CONFIG: 'global_config',
    /** 配置校验文件后缀 */
    CONFIG_CRC: '.crc',
    /** 插件保存的账号配置目录 */
    PLUGIN_SAVE_CONFIG: 'all_users/plugin_save_config',
    /** 登录信息目录 */
    LOGIN_DIR: 'all_users/login',
    /** 头像目录 */
    HEAD_IMGS_DIR: 'all_users/head_imgs/0',
    /** 消息数据库目录 */
    MESSAGE_DB_DIR: 'db_storage/message',
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 检查账号是否在线
 *
 * 通过检测消息数据库的 .db-shm 和 .db-wal 文件数量判断。
 * 微信在登录状态下会保持数据库连接，产生这些临时文件。
 * 当 shm 和 wal 文件各超过 4 个时，认为账号处于在线状态。
 *
 * @param {string} accountPath - 账号数据目录路径（如 xwechat_files/wxid_xxx）
 * @returns {boolean} 是否在线
 *
 * @example
 * const online = isAccountLoggedIn('C:/Users/xxx/Documents/xwechat_files/wxid_abc123');
 */
function isAccountLoggedIn(accountPath) {
    const msgFolder = path.join(accountPath, WECHAT_PATHS.MESSAGE_DB_DIR);
    if (!fs.existsSync(msgFolder)) {
        return false;
    }

    let shmCount = 0;
    let walCount = 0;
    const files = fs.readdirSync(msgFolder);

    for (const file of files) {
        if (file.endsWith('.db-shm')) shmCount++;
        else if (file.endsWith('.db-wal')) walCount++;

        // 两个条件都满足即可提前返回
        if (shmCount >= 4 && walCount >= 4) {
            return true;
        }
    }

    return false;
}

/**
 * 获取已排序的账号列表
 *
 * 排序逻辑：
 * 1. 先按用户自定义顺序（存储在 dbDevice.accountOrder）排列
 * 2. 未在排序列表中的新账号追加到末尾
 *
 * @returns {Array<Object>} 账号信息数组，每个元素包含：
 *   - id {string} 账号 wxid
 *   - logo {string} 头像文件路径
 *   - name {string} 显示名称（默认为 wxid）
 *   - path {string} 账号配置目录路径
 *   - accountPath {string} 账号数据目录路径
 *   - isLogin {boolean} 是否在线
 *
 * @example
 * const accounts = getSortedAccounts();
 * accounts.forEach(a => console.log(a.id, a.isLogin ? '在线' : '离线'));
 */
function getSortedAccounts() {
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) return [];

    const configDirPath = path.join(wechatFilePath, WECHAT_PATHS.PLUGIN_SAVE_CONFIG);
    if (!fs.existsSync(configDirPath)) return [];

    const dirs = fs.readdirSync(configDirPath);
    const wxMap = {};

    // 扫描所有已保存的账号
    for (const dir of dirs) {
        const wxidPath = path.join(configDirPath, dir);
        if (!fs.statSync(wxidPath).isDirectory()) continue;

        const wxid = dir;
        const wxidRealPath = findDirName(wechatFilePath, wxid);

        wxMap[wxid] = {
            id: wxid,
            logo: path.join(wxidPath, 'logo.png'),
            name: nicknameModule.resolveNickname(wxid, wxidPath),
            path: wxidPath,
            accountPath: wxidRealPath,
            isLogin: wxidRealPath ? isAccountLoggedIn(wxidRealPath) : false,
        };
    }

    // 按用户自定义顺序排序
    const { getAccountOrder } = require('./shared');
    const order = getAccountOrder();
    const sorted = [];

    for (const id of order) {
        if (wxMap[id]) {
            sorted.push(wxMap[id]);
            delete wxMap[id];
        }
    }

    // 未在排序列表中的新账号追加到末尾
    for (const id of Object.keys(wxMap)) {
        sorted.push(wxMap[id]);
    }

    return sorted;
}

// ============================================================
// 配置状态
// ============================================================

/**
 * 获取插件配置状态
 *
 * 返回 handle.exe 的安装状态和微信文档路径的设置状态，
 * 用于前端显示配置面板。
 *
 * @returns {Object} 配置状态对象
 *   - handle.installed {boolean} handle.exe 是否已下载
 *   - handle.date {string|null} handle.exe 文件修改日期 (YYYY-MM-DD)
 *   - handle.path {string} handle.exe 完整路径
 *   - wechatPath {string|null} 微信文档路径
 */
function getConfigStatus() {
    const handleExists = fs.existsSync(HANDLE_EXE_PATH);
    let handleDate = null;

    if (handleExists) {
        handleDate = new Date(fs.statSync(HANDLE_EXE_PATH).mtimeMs)
            .toISOString()
            .slice(0, 10);
    }

    return {
        handle: {
            installed: handleExists,
            date: handleDate,
            path: HANDLE_EXE_PATH,
        },
        wechatPath: getWechatFilePath(),
    };
}

// ============================================================
// 核心业务操作
// ============================================================

/**
 * 从 Windows 注册表获取微信 EXE 安装路径
 *
 * 读取 HKEY_CURRENT_USER\Software\Tencent\Weixin\InstallPath
 * 注册表输出为 GBK 编码，需要 iconv-lite 解码
 *
 * @private
 * @returns {Promise<string>} 微信安装目录路径
 * @throws {Error} 注册表查询失败或路径不存在
 */
function getRegWechatExePath() {
    return new Promise((resolve, reject) => {
        exec(
            'REG QUERY HKEY_CURRENT_USER\\Software\\Tencent\\Weixin /v InstallPath',
            { encoding: 'buffer' },
            (err, stdout) => {
                if (err) return reject(err);
                const data = iconv.decode(stdout, 'gbk').toString();
                const matches = data.match(/[a-zA-Z]*?:.*/);
                if (matches) return resolve(matches[0]);
                reject(new Error('注册表无微信路径'));
            }
        );
    });
}

/**
 * 启动微信（支持指定账号或新建多开）
 *
 * 启动流程：
 * 1. 如果指定了账号，替换全局配置文件为目标账号的配置
 * 2. 如果未指定账号，清除全局配置文件（触发微信新建登录流程）
 * 3. 释放微信互斥锁（允许启动多个实例）
 * 4. 从注册表获取微信 EXE 路径并启动
 *
 * @param {Object|null} itemData - 账号信息对象，null 表示新建多开
 * @param {string} itemData.path - 账号配置目录路径
 * @param {string} itemData.id - 账号 wxid
 * @returns {Promise<void>}
 * @throws {Error} handle.exe 不存在、微信文档路径未设置、配置文件替换失败等
 *
 * @example
 * // 新建多开
 * await startWechat(null);
 *
 * // 启动指定账号
 * const account = { id: 'wxid_abc', path: 'C:/.../plugin_save_config/wxid_abc' };
 * await startWechat(account);
 */
async function startWechat(itemData) {
    // 前置检查
    if (!fs.existsSync(HANDLE_EXE_PATH)) {
        throw new Error('handle.exe 不存在，请先下载');
    }

    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');

    const configPath = path.join(wechatFilePath, WECHAT_PATHS.CONFIG_DIR, WECHAT_PATHS.GLOBAL_CONFIG);
    const crcPath = configPath + WECHAT_PATHS.CONFIG_CRC;

    if (itemData) {
        // 指定账号：替换配置文件
        if (!fs.existsSync(itemData.path)) {
            throw new Error('微信账号信息不存在');
        }

        // 释放文件锁（不杀进程，只释放 handle）
        let lockReleased = false;
        try {
            await releaseFileLock(configPath);
            lockReleased = true;
        } catch (e) { /* 继续尝试其他策略 */ }

        try {
            await releaseFileLock(crcPath);
        } catch (e) { /* crc 锁释放失败不影响主流程 */ }

        // 策略1：直接替换（文件锁已释放时）
        if (lockReleased) {
            try {
                if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
                if (fs.existsSync(crcPath)) fs.rmSync(crcPath, { force: true });
                fs.copyFileSync(path.join(itemData.path, 'global_config'), configPath);
                fs.copyFileSync(path.join(itemData.path, 'global_config.crc'), crcPath);
            } catch (e) {
                lockReleased = false; // 回退到策略2
            }
        }

        // 策略2：rename 旧文件再复制（Windows 允许 rename 被锁文件）
        if (!lockReleased) {
            try {
                if (fs.existsSync(configPath)) fs.renameSync(configPath, configPath + '.bak');
                if (fs.existsSync(crcPath)) fs.renameSync(crcPath, crcPath + '.bak');
                fs.copyFileSync(path.join(itemData.path, 'global_config'), configPath);
                fs.copyFileSync(path.join(itemData.path, 'global_config.crc'), crcPath);
            } catch (e) {
                throw new Error('无法替换配置文件，请手动关闭微信后重试: ' + e.message);
            }
        }
    } else {
        // 新建多开：清除配置
        try { fs.rmSync(configPath, { force: true }); } catch (e) { /* ignore */ }
        try { fs.rmSync(crcPath, { force: true }); } catch (e) { /* ignore */ }
    }

    // 释放互斥锁
    try {
        await releaseMutex();
    } catch (e) {
        // 互斥锁释放失败不阻止启动（可能微信未运行）
    }

    // 获取微信 EXE 路径并启动
    let binPath = await getRegWechatExePath();
    binPath = path.join(binPath, 'Weixin.exe');

    if (!fs.existsSync(binPath)) {
        throw new Error('微信EXE不存在: ' + binPath);
    }

    utools.shellOpenPath(binPath);
    utools.showNotification('登录完成后点击「保存当前登录」');
}

/**
 * 保存当前登录的微信账号配置
 *
 * 保存流程：
 * 1. 查找最近登录的账号（通过 key_info.db-shm 文件时间判断）
 * 2. 备份全局配置文件到 plugin_save_config/wxid/
 * 3. 复制最新头像作为账号头像
 *
 * @returns {Promise<Object>} 保存的账号信息
 * @throws {Error} 微信文档路径未设置、未登录微信、配置文件不存在等
 *
 * @example
 * const account = await saveWechat();
 * console.log('已保存:', account.id);
 */
async function saveWechat() {
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');

    const loginPath = path.join(wechatFilePath, WECHAT_PATHS.LOGIN_DIR);
    if (!fs.existsSync(loginPath)) throw new Error('微信登录目录不存在');

    // 查找最近登录的账号
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
    const wxidPath = path.join(wechatFilePath, WECHAT_PATHS.PLUGIN_SAVE_CONFIG, wxid);

    // 创建账号目录
    if (!fs.existsSync(wxidPath)) {
        fs.mkdirSync(wxidPath, { recursive: true });
    }

    // 备份配置文件
    const configSrc = path.join(wechatFilePath, WECHAT_PATHS.CONFIG_DIR, WECHAT_PATHS.GLOBAL_CONFIG);
    const crcSrc = configSrc + WECHAT_PATHS.CONFIG_CRC;

    if (!fs.existsSync(configSrc)) {
        throw new Error('global_config 不存在');
    }

    fs.copyFileSync(configSrc, path.join(wxidPath, 'global_config'));
    fs.copyFileSync(crcSrc, path.join(wxidPath, 'global_config.crc'));

    // 复制最新头像
    const headImgDir = path.join(wechatFilePath, WECHAT_PATHS.HEAD_IMGS_DIR);
    if (fs.existsSync(headImgDir)) {
        const imgPath = findLatestFileAll(headImgDir);
        if (imgPath) {
            fs.copyFileSync(imgPath, path.join(wxidPath, 'logo.png'));
        }
    }

    // 构建账号信息
    const wxData = {
        id: wxid,
        logo: path.join(wxidPath, 'logo.png'),
        name: nicknameModule.resolveNickname(wxid, wxidPath),
        path: wxidPath,
        isLogin: isAccountLoggedIn(path.join(wechatFilePath, wxid)),
    };

    // 保存到本地存储（直接使用 window.dbDevice，避免 getter 在 require 时求值问题）
    window.dbDevice.setItem('wx_' + wxData.id, JSON.stringify(wxData));

    return wxData;
}

/**
 * 删除已保存的账号
 *
 * 删除账号的配置目录及其所有内容，此操作不可恢复。
 * 不会删除微信的实际账号数据，只是删除插件保存的配置快照。
 *
 * @param {Object} itemData - 要删除的账号信息
 * @param {string} itemData.path - 账号配置目录路径
 * @throws {Error} 账号信息不存在
 *
 * @example
 * deleteWechat({ id: 'wxid_abc', path: 'C:/.../plugin_save_config/wxid_abc' });
 */
function deleteWechat(itemData) {
    if (!fs.existsSync(itemData.path)) {
        throw new Error('微信账号信息不存在');
    }
    fs.rmSync(itemData.path, { recursive: true, force: true });
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
    isAccountLoggedIn,
    getSortedAccounts,
    getConfigStatus,
    startWechat,
    saveWechat,
    deleteWechat,
    setManualNickname: nicknameModule.setManualNickname,
    clearManualNickname: nicknameModule.clearManualNickname,
};
