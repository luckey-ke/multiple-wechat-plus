/**
 * antiRevoke.js — 微信防撤回业务逻辑
 *
 * 提供防撤回功能的状态检测、启用、禁用。
 * 通过静态 DLL 二进制补丁实现，参考 RevokeMsgPatcher 和 BetterWX。
 *
 * @module antiRevoke
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const iconv = require('iconv-lite');
const patcher = require('./patcher');
const patchDb = require('./patchDb');

// ============================================================
// 微信安装目录与版本检测
// ============================================================

/**
 * 从 Windows 注册表获取微信安装目录
 *
 * @returns {Promise<string>} 微信安装目录路径
 */
function getWechatExeDir() {
    return new Promise(function(resolve, reject) {
        exec(
            'REG QUERY HKEY_CURRENT_USER\\Software\\Tencent\\Weixin /v InstallPath',
            { encoding: 'buffer' },
            function(err, stdout) {
                if (err) return reject(new Error('未找到微信安装路径，请确认微信已安装'));
                var data = iconv.decode(stdout, 'gbk').toString();
                var matches = data.match(/[a-zA-Z]*?:.*/);
                if (matches) return resolve(matches[0].trim());
                reject(new Error('注册表无微信路径'));
            }
        );
    });
}

/**
 * 读取文件的版本信息
 * 从 PE 文件的 VERSION_INFO 资源中提取
 *
 * @param {string} filePath - 文件路径
 * @returns {string|null} 版本号字符串，如 '4.0.6.26'
 */
function getFileVersion(filePath) {
    try {
        var buf = fs.readFileSync(filePath);
        // 搜索 Unicode 版本字符串 "FileVersion" 或 "ProductVersion"
        var str = buf.toString('utf16le');
        var match = str.match(/FileVersion[^\d]*(\d+\.\d+\.\d+\.\d+)/);
        if (match) return match[1];
        match = str.match(/ProductVersion[^\d]*(\d+\.\d+\.\d+\.\d+)/);
        if (match) return match[1];
    } catch (e) { /* ignore */ }
    return null;
}

/**
 * 检测微信版本
 * 优先从 Weixin.exe（4.0）读取，回退到 WeChatWin.dll（3.x）
 *
 * @param {string} exeDir - 微信安装目录
 * @returns {string|null} 版本号
 */
function detectWechatVersion(exeDir) {
    // [Weixin.exe 是微信自动更新时临时重命名的文件，更新中断时可能残留
    var candidates = ['Weixin.exe', '[Weixin.exe', 'WeChatWin.dll'];
    for (var i = 0; i < candidates.length; i++) {
        var ver = getFileVersion(path.join(exeDir, candidates[i]));
        if (ver) return ver;
    }
    return null;
}

/**
 * 在安装目录中查找目标 DLL 文件
 * 先在根目录找，再递归搜索子目录
 *
 * @param {string} exeDir - 微信安装目录
 * @param {string} dllFile - 目标 DLL 文件名
 * @returns {string|null} DLL 完整路径
 */
function findDllPath(exeDir, dllFile) {
    // 1. 根目录直接查找
    var directPath = path.join(exeDir, dllFile);
    if (fs.existsSync(directPath)) return directPath;

    // 2. 搜索子目录（一级）
    try {
        var entries = fs.readdirSync(exeDir);
        for (var i = 0; i < entries.length; i++) {
            var subDir = path.join(exeDir, entries[i]);
            try {
                if (fs.statSync(subDir).isDirectory()) {
                    var subPath = path.join(subDir, dllFile);
                    if (fs.existsSync(subPath)) return subPath;
                }
            } catch (e) { /* skip inaccessible dirs */ }
        }
    } catch (e) { /* ignore read errors */ }

    return null;
}

// ============================================================
// 防撤回状态
// ============================================================

/**
 * 获取防撤回功能状态
 *
 * @returns {Promise<Object>} 状态对象
 */
function getStatus() {
    return getWechatExeDir().then(function(exeDir) {
        var version = detectWechatVersion(exeDir);
        if (!version) {
            return {
                available: false, enabled: false, version: null,
                dllFile: null, dllPath: null, hasBackup: false,
                patchName: null, message: '无法检测微信版本',
            };
        }

        // 查找补丁定义（只调一次）
        var patchDef = patchDb.findPatch(version, '撤回');
        var baseDllFile = patchDef ? patchDef.dllFile : (version.indexOf('4.') === 0 ? 'Weixin.dll' : 'WeChatWin.dll');

        var dllPath = findDllPath(exeDir, baseDllFile);
        if (!dllPath) {
            var altDll = baseDllFile === 'Weixin.dll' ? 'WeChatWin.dll' : 'Weixin.dll';
            dllPath = findDllPath(exeDir, altDll);
        }

        if (!dllPath) {
            return {
                available: false, enabled: false, version: version,
                dllFile: baseDllFile, dllPath: null, hasBackup: false,
                patchName: null, message: '未找到微信 DLL 文件',
            };
        }

        var dllFile = path.basename(dllPath);

        if (!patchDef) {
            return {
                available: false, enabled: false, version: version,
                dllFile: dllFile, dllPath: dllPath, hasBackup: false,
                patchName: null, message: '当前版本 ' + version + ' 暂不支持防撤回',
            };
        }

        var buf;
        try {
            buf = fs.readFileSync(dllPath);
        } catch (e) {
            return {
                available: false, enabled: false, version: version,
                dllFile: dllFile, dllPath: dllPath, hasBackup: false,
                patchName: null, message: '读取 DLL 失败: ' + e.message,
            };
        }

        var enabled = patcher.isPatched(buf, patchDef.patches);
        var hasBackup = patcher.hasBackup(dllPath);
        var needsElevation = patcher.isInProgramFiles(dllPath);

        return {
            available: true, enabled: enabled, version: version,
            dllFile: dllFile, dllPath: dllPath, hasBackup: hasBackup,
            patchName: patchDef.name,
            needsElevation: needsElevation,
            message: enabled ? '防撤回已启用' : '防撤回未启用',
            versionText: '当前版本：' + version + '（支持特征防撤回）',
        };
    }).catch(function(err) {
        return {
            available: false, enabled: false, version: null,
            dllFile: null, dllPath: null, hasBackup: false,
            patchName: null, message: err.message,
        };
    });
}

// ============================================================
// 启用 / 禁用
// ============================================================

/**
 * 启用防撤回
 * 备份原 DLL 并应用补丁
 *
 * @returns {Promise<Object>} 操作结果
 */
function enable() {
    return getWechatExeDir().then(function(exeDir) {
        var version = detectWechatVersion(exeDir);
        if (!version) return { success: false, message: '无法检测微信版本' };

        var patchDef = patchDb.findPatch(version, '撤回');
        var baseDllFile = patchDef ? patchDef.dllFile : (version.indexOf('4.') === 0 ? 'Weixin.dll' : 'WeChatWin.dll');

        var dllPath = findDllPath(exeDir, baseDllFile);
        if (!dllPath) {
            var altDll = baseDllFile === 'Weixin.dll' ? 'WeChatWin.dll' : 'Weixin.dll';
            dllPath = findDllPath(exeDir, altDll);
        }
        if (!dllPath) return { success: false, message: '未找到微信 DLL 文件' };

        if (!patchDef) return { success: false, message: '当前版本暂不支持' };

        return patcher.patchDll(dllPath, patchDef.patches, { force: false });
    }).catch(function(err) {
        return { success: false, message: err.message };
    });
}

/**
 * 禁用防撤回
 * 从备份恢复原 DLL
 *
 * @returns {Promise<Object>} 操作结果
 */
function disable() {
    return getWechatExeDir().then(function(exeDir) {
        var version = detectWechatVersion(exeDir);
        if (!version) return { success: false, message: '无法检测微信版本' };

        var patchDef = patchDb.findPatch(version, '撤回');
        var baseDllFile = patchDef ? patchDef.dllFile : (version.indexOf('4.') === 0 ? 'Weixin.dll' : 'WeChatWin.dll');

        var dllPath = findDllPath(exeDir, baseDllFile);
        if (!dllPath) {
            var altDll = baseDllFile === 'Weixin.dll' ? 'WeChatWin.dll' : 'Weixin.dll';
            dllPath = findDllPath(exeDir, altDll);
        }
        if (!dllPath) return { success: false, message: '未找到微信 DLL 文件' };

        if (!patcher.hasBackup(dllPath)) {
            return { success: false, message: '未找到备份文件，无法恢复' };
        }

        return patcher.restoreDll(dllPath);
    }).catch(function(err) {
        return { success: false, message: err.message };
    });
}

/**
 * 手动备份 DLL
 *
 * @returns {Promise<Object>} 操作结果
 */
function backup() {
    return getWechatExeDir().then(function(exeDir) {
        var version = detectWechatVersion(exeDir);
        if (!version) return { success: false, message: '无法检测微信版本' };

        var patchDef = patchDb.findPatch(version, '撤回');
        var baseDllFile = patchDef ? patchDef.dllFile : (version.indexOf('4.') === 0 ? 'Weixin.dll' : 'WeChatWin.dll');

        var dllPath = findDllPath(exeDir, baseDllFile);
        if (!dllPath) {
            var altDll = baseDllFile === 'Weixin.dll' ? 'WeChatWin.dll' : 'Weixin.dll';
            dllPath = findDllPath(exeDir, altDll);
        }
        if (!dllPath) return { success: false, message: '未找到微信 DLL 文件' };

        if (patcher.hasBackup(dllPath)) {
            return { success: true, message: '备份已存在' };
        }

        try {
            patcher.backupDll(dllPath);
            return { success: true, message: '备份成功' };
        } catch (e) {
            return { success: false, message: '备份失败: ' + e.message };
        }
    }).catch(function(err) {
        return { success: false, message: err.message };
    });
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
    getStatus: getStatus,
    enable: enable,
    disable: disable,
    backup: backup,
    getWechatExeDir: getWechatExeDir,
    detectWechatVersion: detectWechatVersion,
    findDllPath: findDllPath,
};
