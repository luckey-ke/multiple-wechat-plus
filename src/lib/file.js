/**
 * file.js — 文件与目录查找工具
 *
 * 提供文件系统相关的工具函数，主要用于：
 * - 查找目录下最新的指定文件
 * - 根据名称模糊匹配目录
 * - 递归查找最新文件
 *
 * 在微信多开插件中的应用场景：
 * - 查找最近登录的账号目录（通过 key_info.db-shm）
 * - 查找最新的头像文件
 * - 根据 wxid 查找对应的账号数据目录
 *
 * @module file
 * @requires fs
 * @requires path
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 文件查找
// ============================================================

/**
 * 查找目录下指定文件名的最新文件所在目录
 *
 * 遍历 findDir 下的所有子目录，查找包含指定文件名的目录，
 * 返回文件修改时间最新的那个目录路径。
 *
 * @param {string} findDir - 要搜索的父目录
 * @param {string} fileName - 要查找的文件名（如 'key_info.db-shm'）
 * @returns {string|null} 最新文件所在目录的路径，未找到返回 null
 *
 * @example
 * // 查找最近登录的微信账号目录
 * const loginPath = 'C:/Users/xxx/Documents/xwechat_files/all_users/login';
 * const latestLoginDir = findLatestFile(loginPath, 'key_info.db-shm');
 * if (latestLoginDir) {
 *     const wxid = path.basename(latestLoginDir);
 *     console.log('最近登录:', wxid);
 * }
 */
function findLatestFile(findDir, fileName) {
    let latestTime = 0;
    let latestPath = null;

    const loginDirs = fs.readdirSync(findDir);
    for (const dir of loginDirs) {
        const dirPath = path.join(findDir, dir);
        if (fs.statSync(dirPath).isDirectory()) {
            const keyInfoPath = path.join(dirPath, fileName);
            if (fs.existsSync(keyInfoPath)) {
                const fileStats = fs.statSync(keyInfoPath);
                if (fileStats.mtimeMs > latestTime) {
                    latestTime = fileStats.mtimeMs;
                    latestPath = dirPath;
                }
            }
        }
    }

    return latestPath;
}

// ============================================================
// 目录查找
// ============================================================

/**
 * 根据名称模糊匹配目录
 *
 * 遍历 findDir 下的所有子目录，返回第一个名称包含 name 的目录路径。
 * 用于根据 wxid 查找对应的微信账号数据目录。
 *
 * @param {string} findDir - 要搜索的父目录
 * @param {string} name - 要匹配的名称片段
 * @returns {string|null} 匹配的目录路径，未找到返回 null
 *
 * @example
 * // 根据 wxid 查找账号数据目录
 * const wxid = 'wxid_abc123';
 * const accountPath = findDirName(wechatFilePath, wxid);
 * // accountPath = 'C:/.../xwechat_files/wxid_abc123456'
 */
function findDirName(findDir, name) {
    const loginDirs = fs.readdirSync(findDir);
    for (const dir of loginDirs) {
        const dirPath = path.join(findDir, dir);
        if (fs.statSync(dirPath).isDirectory()) {
            if (dir.includes(name)) {
                return dirPath;
            }
        }
    }

    return null;
}

// ============================================================
// 递归文件查找
// ============================================================

/**
 * 递归查找目录下最新的文件
 *
 * 深度优先遍历目录树，返回修改时间最新的文件路径。
 * 可选地通过 filterDir 和 filterFile 函数过滤目录和文件。
 *
 * @param {string} findDir - 要搜索的目录
 * @param {Function|null} [filterDir=null] - 目录过滤函数，接收目录路径，返回 true 继续遍历
 * @param {Function|null} [filterFile=null] - 文件过滤函数，接收文件路径，返回 true 才参与比较
 * @returns {string|null} 最新文件的完整路径，未找到返回 null
 *
 * @example
 * // 查找最新的头像文件
 * const headImgDir = 'C:/.../all_users/head_imgs/0';
 * const latestImg = findLatestFileAll(headImgDir);
 * if (latestImg) {
 *     fs.copyFileSync(latestImg, destPath);
 * }
 *
 * @example
 * // 只查找 png 文件
 * const latestPng = findLatestFileAll(dir, null, (filePath) => {
 *     return filePath.endsWith('.png');
 * });
 */
function findLatestFileAll(findDir, filterDir = null, filterFile = null) {
    let latestTime = 0;
    let latestPath = null;

    function loop(dir) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                // 如果有过滤函数，检查是否继续遍历
                if (!filterDir || filterDir(fullPath)) {
                    loop(fullPath);
                }
            } else if (stat.isFile()) {
                // 如果有过滤函数，检查是否参与比较
                if (filterFile && !filterFile(fullPath)) {
                    continue;
                }
                // 比较文件修改时间，保留最新的
                if (stat.mtimeMs > latestTime) {
                    latestTime = stat.mtimeMs;
                    latestPath = fullPath;
                }
            }
        }
    }

    loop(findDir);
    return latestPath;
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
    findLatestFile,
    findDirName,
    findLatestFileAll,
};
