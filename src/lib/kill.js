const { exec } = require('child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { GoConfigError } = require('./error');
const { createLogger } = require('./logger');

const logger = createLogger(null); // 输出到 stdout，由 window.logger 统一管理

const basePath = path.join(os.homedir(), 'multiple_wechat');
if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
}

const HANDLE_EXE_PATH = path.join(basePath, 'handle.exe');
const HANDLE_ZIP_PATH = path.join(basePath, 'Handle.zip');
const HANDLE_ZIP_URL = 'https://download.sysinternals.com/files/Handle.zip';
const WECHAT_MUTEX_NAME = 'XWeChat_App_Instance_Identity_Mutex_Name';

/**
 * 关闭指定进程的指定句柄（提权执行）
 */
function closeHandle(pid, handleId) {
    return new Promise((resolve) => {
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

/**
 * 自动下载 handle.exe（如不存在）
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

/**
 * 查找并释放微信互斥锁
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

/**
 * 释放指定文件的句柄锁
 * @param {string} filePath - 被锁的文件路径
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

module.exports = {
    releaseMutex,
    downloadHandle,
    releaseFileLock,
    closeHandle,
    HANDLE_EXE_PATH,
    WECHAT_MUTEX_NAME,
};
