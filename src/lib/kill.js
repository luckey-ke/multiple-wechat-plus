/**
 * kill.js — handle.exe 操作与进程锁管理
 *
 * 提供微信多开的核心底层能力：
 * - handle.exe 的下载与管理
 * - 进程互斥锁的释放（允许启动多个微信实例）
 * - 文件句柄锁的释放（允许替换配置文件）
 *
 * 技术原理：
 * Windows 微信使用命名互斥体 XWeChat_App_Instance_Identity_Mutex_Name
 * 来防止多实例运行。通过微软 Sysinternals 的 handle.exe 工具，
 * 可以找到并关闭该互斥体，从而允许启动多个微信进程。
 *
 * @module kill
 * @requires child_process
 * @requires fs
 * @requires path
 * @requires os
 * @requires node-fetch
 * @requires adm-zip
 * @requires ./error
 * @requires ./logger
 */

const { exec } = require('child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { GoConfigError } = require('./error');
const { createLogger } = require('./logger');

// ============================================================
// 常量定义
// ============================================================

/** 模块内部日志实例 */
const logger = createLogger(null);

/** handle.exe 存储目录 */
const basePath = path.join(os.homedir(), 'multiple_wechat');
if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
}

/** handle.exe 完整路径 */
const HANDLE_EXE_PATH = path.join(basePath, 'handle.exe');

/** Handle.zip 临时路径 */
const HANDLE_ZIP_PATH = path.join(basePath, 'Handle.zip');

/** handle.exe 下载地址（微软 Sysinternals 官方） */
const HANDLE_ZIP_URL = 'https://download.sysinternals.com/files/Handle.zip';

/** 微信进程互斥体名称 */
const WECHAT_MUTEX_NAME = 'XWeChat_App_Instance_Identity_Mutex_Name';

// ============================================================
// handle.exe 下载
// ============================================================

/**
 * 自动下载 handle.exe（如不存在）
 *
 * 下载流程：
 * 1. 检查 handle.exe 是否已存在
 * 2. 从微软 Sysinternals 官方下载 Handle.zip
 * 3. 解压到 ~/multiple_wechat/ 目录
 * 4. 删除临时 zip 文件
 *
 * @returns {Promise<string>} 下载结果提示
 * @throws {Error} 下载失败或解压失败
 *
 * @example
 * try {
 *     const result = await downloadHandle();
 *     console.log(result); // 'handle.exe 下载并解压成功！'
 * } catch (e) {
 *     console.error('下载失败:', e.message);
 * }
 */
function downloadHandle() {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(HANDLE_EXE_PATH)) {
            return resolve('handle.exe 已存在');
        }

        logger.info('下载 handle.exe...');
        fetch(HANDLE_ZIP_URL)
            .then((res) => {
                if (res.status !== 200) {
                    throw new Error('下载失败，HTTP ' + res.status);
                }
                const file = fs.createWriteStream(HANDLE_ZIP_PATH);
                res.body.pipe(file);
                file.on('finish', () => {
                    file.close(() => {
                        logger.info('下载 Handle.zip 完成，正在解压...');
                        try {
                            const zip = new AdmZip(HANDLE_ZIP_PATH);
                            zip.extractAllTo(basePath, true);
                            fs.unlinkSync(HANDLE_ZIP_PATH);
                            resolve('handle.exe 下载并解压成功！');
                        } catch (err) {
                            logger.error('解压失败', err.message);
                            reject(new Error('解压失败: ' + err.message));
                        }
                    });
                });
            })
            .catch((err) => {
                logger.error('下载失败', err.message);
                reject(new Error('下载失败: ' + err.message));
            });
    });
}

// ============================================================
// handle.exe 本地安装
// ============================================================

/**
 * 从插件内置的 Handle.zip 安装 handle.exe（离线安装）
 *
 * Handle.zip 随插件打包在 src/lib/ 目录下，
 * 适用于无网络或不想从微软官网下载的场景。
 *
 * @returns {Promise<string>} 安装结果提示
 * @throws {Error} 内置压缩包不存在、解压失败等
 *
 * @example
 * installLocalHandle()
 *     .then((msg) => console.log(msg)) // 'handle.exe 本地安装成功！'
 *     .catch((e) => console.error(e.message));
 */
function installLocalHandle() {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(HANDLE_EXE_PATH)) {
            return resolve('handle.exe 已存在，无需安装');
        }

        const localZipPath = path.join(__dirname, 'Handle.zip');
        if (!fs.existsSync(localZipPath)) {
            return reject(new Error('内置 Handle.zip 不存在'));
        }

        logger.info('从内置压缩包安装 handle.exe...');
        try {
            const zip = new AdmZip(localZipPath);
            zip.extractAllTo(basePath, true);
            if (!fs.existsSync(HANDLE_EXE_PATH)) {
                return reject(new Error('解压完成但未找到 handle.exe'));
            }
            logger.info('handle.exe 本地安装成功');
            resolve('handle.exe 本地安装成功！');
        } catch (err) {
            logger.error('本地安装失败', err.message);
            reject(new Error('本地安装失败: ' + err.message));
        }
    });
}

// ============================================================
// 句柄关闭（内部函数）
// ============================================================

/**
 * 关闭指定进程的指定句柄（提权执行）
 *
 * 使用 PowerShell 的 Start-Process -Verb RunAs 提权执行 handle.exe，
 * 以关闭目标进程的句柄。需要管理员权限。
 *
 * @param {string} pid - 目标进程 ID
 * @param {string} handleId - 要关闭的句柄 ID
 * @returns {Promise<void>}
 *
 * @private
 */
function closeHandle(pid, handleId) {
    return new Promise((resolve) => {
        // 定位 PowerShell 路径
        let powershell = 'powershell';
        if (fs.existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')) {
            powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
        }

        // 超时兜底：3秒后自动 resolve，避免 UI 卡死
        const timer = setTimeout(() => {
            logger.warn('closeHandle 超时，跳过等待');
            resolve();
        }, 3000);

        const command = `${powershell} Start-Process "${HANDLE_EXE_PATH}" -ArgumentList @('-c','${handleId}','-p','${pid}','-y') -Verb RunAs -Wait`;

        exec(command, (err, stdout) => {
            clearTimeout(timer);
            if (err) {
                logger.error('closeHandle 失败', { pid, handleId, error: err.message });
            } else {
                logger.info('closeHandle 成功', { pid, handleId });
            }
            resolve(stdout);
        });
    });
}

// ============================================================
// 互斥锁释放
// ============================================================

/**
 * 查找并释放微信进程互斥锁
 *
 * 微信使用命名互斥体 XWeChat_App_Instance_Identity_Mutex_Name 来防止多实例。
 * 本函数通过 handle.exe 找到该互斥体的句柄并关闭它，从而允许启动多个微信。
 *
 * @returns {Promise<void>}
 * @throws {Error} handle.exe 不存在
 *
 * @example
 * // 在启动新微信实例之前调用
 * await releaseMutex();
 * // 现在可以启动新的微信实例了
 */
function releaseMutex() {
    if (!fs.existsSync(HANDLE_EXE_PATH)) {
        throw new GoConfigError('handle.exe 不存在，请先下载');
    }

    return new Promise((resolve, reject) => {
        exec(
            `"${HANDLE_EXE_PATH}" -accepteula -p weixin -a ${WECHAT_MUTEX_NAME}`,
            (err, stdout, stderr) => {
                if (err || stderr) {
                    logger.error('未能查找到互斥体');
                    return reject(new Error('未能查找到互斥体'));
                }

                const match = stdout.match(/pid: (\d+)\s+type: (.*?)\s+([a-zA-Z0-9]+):/i);
                if (!match) {
                    logger.info('未找到互斥体（可能无多开锁）');
                    return resolve(); // 没找到锁不算错误
                }

                const [, pid, , handleId] = match;
                logger.info(`找到互斥体：PID=${pid}, 句柄=${handleId}`);
                closeHandle(pid, handleId).then(resolve).catch(reject);
            }
        );
    });
}

// ============================================================
// 文件锁释放
// ============================================================

/**
 * 释放指定文件的句柄锁
 *
 * 微信在运行时会锁定配置文件（global_config 等），
 * 导致无法替换配置文件。本函数通过 handle.exe 找到并关闭这些文件锁。
 *
 * @param {string} filePath - 被锁的文件路径
 * @returns {Promise<void>}
 * @throws {Error} handle.exe 不存在或查找文件锁失败
 *
 * @example
 * const configPath = 'C:/.../all_users/config/global_config';
 * try {
 *     await releaseFileLock(configPath);
 *     // 文件锁已释放，可以安全替换文件
 *     fs.copyFileSync(newConfig, configPath);
 * } catch (e) {
 *     console.error('释放文件锁失败:', e.message);
 * }
 */
function releaseFileLock(filePath) {
    if (!fs.existsSync(HANDLE_EXE_PATH)) {
        throw new GoConfigError('handle.exe 不存在，请先下载');
    }

    return new Promise((resolve, reject) => {
        exec(`"${HANDLE_EXE_PATH}" -p weixin "${filePath}"`, (err, stdout, stderr) => {
            if (err) {
                logger.error('查找文件锁失败', stderr || err.message);
                return reject(new Error('查找文件锁失败: ' + (stderr || err.message)));
            }

            const matches = stdout.match(/pid: (\d+)\s+type: (.*?)\s+([a-zA-Z0-9]+):/gi);
            if (!matches) {
                // 没找到锁 = 没有锁
                return resolve();
            }

            // 串行关闭所有句柄，避免竞态
            let completed = 0;
            function next() {
                if (completed >= matches.length) {
                    return resolve();
                }
                const content = matches[completed];
                const match = content.match(/pid: (\d+)\s+type: (.*?)\s+([a-zA-Z0-9]+):/i);
                if (!match) {
                    completed++;
                    return next();
                }
                const [, pid, , handleId] = match;
                logger.info(`关闭文件锁: PID=${pid}, Handle=${handleId}`);
                exec(`"${HANDLE_EXE_PATH}" -c ${handleId} -p ${pid} -y`, (closeErr) => {
                    if (closeErr) {
                        logger.error('关闭句柄失败', { pid, handleId, error: closeErr.message });
                        // 继续尝试关闭其他句柄
                    } else {
                        logger.info(`句柄 ${handleId} 已释放`);
                    }
                    completed++;
                    next();
                });
            }
            next();
        });
    });
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
    // 核心功能
    releaseMutex,
    downloadHandle,
    installLocalHandle,
    releaseFileLock,
    closeHandle,

    // 常量（供其他模块引用）
    HANDLE_EXE_PATH,
    WECHAT_MUTEX_NAME,
};
