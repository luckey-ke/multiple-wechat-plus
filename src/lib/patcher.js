/**
 * patcher.js — DLL 二进制补丁引擎
 *
 * 完全按照 RevokeMsgPatcher 的算法实现：
 * - 通配符：0x3F (63)，Search 中匹配任意字节，Replace 中保留原字节
 * - 搜索：Boyer-Moore 在非通配符前缀上快速定位，再逐字节验证
 * - 补丁：逐字节写入，0x3F 跳过（保留原字节）
 *
 * @module patcher
 * @see https://github.com/huiyadanli/RevokeMsgPatcher
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var execSync = require('child_process').execSync;

// ============================================================
// Boyer-Moore 搜索器
// ============================================================

/**
 * Boyer-Moore-Horspool 搜索，返回所有匹配位置
 *
 * @param {Buffer} text - 被搜索的数据
 * @param {number[]} pattern - 搜索模式（纯字节数组，不含通配符）
 * @returns {number[]} 所有匹配位置
 */
function boyerMooreMatchAll(text, pattern) {
    var m = pattern.length;
    var n = text.length;
    if (m === 0 || n < m) return [];

    // 坏字符表
    var badChar = new Array(256);
    for (var i = 0; i < 256; i++) badChar[i] = m;
    for (var j = 0; j < m - 1; j++) badChar[pattern[j]] = m - 1 - j;

    var results = [];
    var s = 0;
    while (s <= n - m) {
        var k = m - 1;
        while (k >= 0 && pattern[k] === text[s + k]) k--;
        if (k < 0) {
            results.push(s);
            s += badChar[pattern[m - 1]];
        } else {
            s += badChar[text[s + m - 1]] || m;
        }
    }
    return results;
}

/**
 * 提取模式的非通配符前缀（head）
 *
 * @param {number[]} pattern - 含通配符的模式
 * @returns {number[]} 第一个 0x3F 之前的所有字节
 */
function getHead(pattern) {
    var head = [];
    for (var i = 0; i < pattern.length; i++) {
        if (pattern[i] === 0x3F) break;
        head.push(pattern[i]);
    }
    return head;
}

// ============================================================
// 模式匹配
// ============================================================

/**
 * 在 Buffer 中搜索含通配符的模式
 *
 * 两阶段匹配：
 * 1. Boyer-Moore 在非通配符前缀上快速定位候选位置
 * 2. 逐字节验证完整模式（0x3F 匹配任意字节）
 *
 * @param {Buffer} buf - 数据缓冲区
 * @param {number[]} pattern - 含通配符的模式（0x3F = 通配符）
 * @returns {number[]} 所有匹配位置
 */
function matchAll(buf, pattern) {
    var head = getHead(pattern);
    if (head.length === 0) return []; // 模式以通配符开头，不合法

    // 阶段 1：Boyer-Moore 在 head 上搜索
    var candidates = boyerMooreMatchAll(buf, head);

    // 如果没有通配符，直接返回
    if (head.length === pattern.length) return candidates;

    // 阶段 2：逐字节验证完整模式
    var results = [];
    for (var i = 0; i < candidates.length; i++) {
        var pos = candidates[i];
        if (isEqual(buf, pos, pattern)) {
            results.push(pos);
        }
    }
    return results;
}

/**
 * 逐字节比较，0x3F 通配符匹配任意字节
 *
 * @param {Buffer} buf - 数据缓冲区
 * @param {number} start - 起始偏移
 * @param {number[]} pattern - 含通配符的模式
 * @returns {boolean}
 */
function isEqual(buf, start, pattern) {
    for (var i = 0; i < pattern.length; i++) {
        if (pattern[i] === 0x3F) continue; // 通配符跳过
        if (buf[start + i] !== pattern[i]) return false;
    }
    return true;
}

/**
 * 检查 Replace 模式是否已存在于指定位置
 *
 * @param {Buffer} buf - 数据缓冲区
 * @param {number} start - 起始偏移
 * @param {number[]} replace - Replace 模式（0x3F = 保留原字节）
 * @returns {boolean}
 */
function isAlreadyReplaced(buf, start, replace) {
    for (var i = 0; i < replace.length; i++) {
        if (replace[i] === 0x3F) continue; // 通配符跳过
        if (buf[start + i] !== replace[i]) return false;
    }
    return true;
}

// ============================================================
// 补丁检测
// ============================================================

/**
 * 检测 DLL 是否已被打补丁（兼容 RevokeMsgPatcher）
 *
 * 算法与 RevokeMsgPatcher 的 ModifyFinder.IsAllReplaced 一致：
 * - 搜索 Search 模式：0 个匹配
 * - 搜索 Replace 模式：>= 1 个匹配
 * → 已被打过补丁
 *
 * @param {Buffer} buf - DLL 数据
 * @param {Array<{search: number[], replace: number[]}>} patches - 补丁定义
 * @returns {boolean}
 */
function isPatched(buf, patches) {
    for (var i = 0; i < patches.length; i++) {
        var searchMatches = matchAll(buf, patches[i].search);
        if (searchMatches.length > 0) continue; // 原始代码还在，未打补丁

        // 原始代码不存在，检查替换代码是否存在
        var replaceMatches = matchAll(buf, patches[i].replace);
        if (replaceMatches.length > 0) return true; // 已被本工具打过补丁

        // 两者都不存在，可能是被其他工具改过（如 RevokeMsgPatcher 用了不同的 Replace）
        // 只要 Search 消失就视为已修改
        return true;
    }
    return false;
}

// ============================================================
// 补丁应用
// ============================================================

/**
 * 应用补丁到 DLL 文件
 *
 * 严格按照 RevokeMsgPatcher 的 ModifyFinder.FindChanges + FileUtil.EditMultiHex 实现
 *
 * @param {string} dllPath - DLL 文件路径
 * @param {Array<{name: string, search: number[], replace: number[]}>} patches - 补丁定义
 * @param {Object} [options] - 选项
 * @param {boolean} [options.force=false] - 强制补丁
 * @param {boolean} [options.backup=true] - 是否备份
 * @returns {{ success: boolean, message: string, details: Array }}
 */
function patchDll(dllPath, patches, options) {
    options = options || {};
    var force = options.force || false;
    var doBackup = options.backup !== false;

    if (!fs.existsSync(dllPath)) {
        return { success: false, message: 'DLL 文件不存在: ' + dllPath, details: [] };
    }

    var buf = fs.readFileSync(dllPath);

    // 检测是否已打补丁
    if (!force && isPatched(buf, patches)) {
        return { success: true, message: '已打过补丁，无需重复操作', details: [] };
    }

    // 备份
    if (doBackup && !hasBackup(dllPath)) {
        try {
            backupDll(dllPath);
        } catch (e) {
            return { success: false, message: '备份失败: ' + e.message, details: [] };
        }
    }

    // 收集所有变更（ModifyFinder.FindChanges 逻辑）
    var changes = [];
    var totalMatches = 0;

    for (var i = 0; i < patches.length; i++) {
        var patch = patches[i];
        var matches = matchAll(buf, patch.search);
        totalMatches += matches.length;

        for (var j = 0; j < matches.length; j++) {
            var pos = matches[j];
            // 检查是否已经是替换后的状态
            if (!isAlreadyReplaced(buf, pos, patch.replace)) {
                changes.push({ position: pos, replace: patch.replace, name: patch.name });
            }
        }
    }

    // 没有任何匹配
    if (totalMatches === 0) {
        return { success: false, message: '所有签名均未匹配，当前版本可能不支持', details: [] };
    }

    // 所有匹配都已经是替换后的状态
    if (changes.length === 0) {
        return { success: true, message: '已由其他工具启用过防撤回', details: [] };
    }

    // 应用变更（FileUtil.EditMultiHex 逻辑）
    for (var c = 0; c < changes.length; c++) {
        var change = changes[c];
        for (var b = 0; b < change.replace.length; b++) {
            if (change.replace[b] === 0x3F) continue;
            buf[change.position + b] = change.replace[b];
        }
    }

    // 写入 DLL
    var writeOk = false;
    try {
        fs.writeFileSync(dllPath, buf);
        writeOk = true;
    } catch (e) {
        // 区分"被占用"和"权限不足"
        if (e.code === 'EBUSY' || e.message.indexOf('busy') !== -1 || e.message.indexOf('locked') !== -1) {
            return { success: false, message: 'DLL 被占用，请先关闭微信后再试', details: [] };
        }
        // 权限不足，尝试管理员权限
        if (isInProgramFiles(dllPath)) {
            var tmpPath = path.join(os.tmpdir(), 'wechat_patch_' + Date.now() + '.dll.tmp');
            try {
                fs.writeFileSync(tmpPath, buf);
                var result = copyFileElevated(tmpPath, dllPath);
                try { fs.unlinkSync(tmpPath); } catch (ignore) {}
                if (result.success) {
                    writeOk = true;
                } else if (result.message === 'uac_canceled') {
                    return { success: false, message: 'uac_canceled', details: [] };
                } else {
                    return { success: false, message: '写入失败: ' + result.message, details: [] };
                }
            } catch (e2) {
                return { success: false, message: '写入失败: ' + e2.message, details: [] };
            }
        } else {
            return { success: false, message: '写入失败: ' + e.message, details: [] };
        }
    }

    if (!writeOk) {
        return { success: false, message: '写入失败', details: [] };
    }

    return { success: true, message: '补丁成功', details: changes.map(function(c) {
        return { name: c.name, position: c.position };
    }) };
}

// ============================================================
// 路径工具
// ============================================================

/**
 * 检测路径是否在 Program Files 目录下（任意盘符）
 */
function isInProgramFiles(filePath) {
    var normalized = path.resolve(filePath).replace(/\//g, '\\').toLowerCase();
    return /^[a-z]:\\program files( \(x86\))?\\/i.test(normalized);
}

/**
 * 获取用户目录下的备份路径
 */
function getUserBackupPath(dllPath) {
    var dir = path.join(os.homedir(), 'multiple_wechat', 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var parentDir = path.basename(path.dirname(dllPath));
    var basename = path.basename(dllPath);
    return path.join(dir, parentDir + '_' + basename + '.bak');
}

// ============================================================
// 管理员权限复制
// ============================================================

/**
 * 用管理员权限复制文件
 * 写 .ps1 脚本到 %TEMP%，用 Start-Process -Verb RunAs 执行
 *
 * @param {string} src - 源文件路径
 * @param {string} dest - 目标文件路径
 * @returns {{ success: boolean, message: string }}
 */
function copyFileElevated(src, dest) {
    var powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    if (!fs.existsSync(powershell)) powershell = 'powershell';

    // 写 .ps1 脚本（UTF-8 BOM 确保中文路径正确）
    var psPath = path.join(os.tmpdir(), 'wxelevate_' + Date.now() + '.ps1');
    var script = 'Copy-Item -LiteralPath "' + src + '" -Destination "' + dest + '" -Force';
    try {
        fs.writeFileSync(psPath, '﻿' + script, 'utf8');
    } catch (e) {
        return { success: false, message: '创建临时脚本失败: ' + e.message };
    }

    // 用 -EncodedCommand 执行 Start-Process（避免引号问题）
    var psCmd = 'Start-Process -FilePath "' + powershell + '" -ArgumentList \'-NoProfile -ExecutionPolicy Bypass -File "' + psPath + '"\' -Verb RunAs -Wait';
    var encodedCmd = Buffer.from(psCmd, 'utf16le').toString('base64');

    try {
        execSync(powershell + ' -NoProfile -EncodedCommand ' + encodedCmd, {
            timeout: 60000,
            windowsHide: true,
            stdio: 'pipe'
        });
        // 验证结果
        if (!fs.existsSync(dest)) return { success: false, message: '管理员权限复制失败：目标文件未创建' };
        return { success: true, message: 'ok' };
    } catch (e) {
        // 检查是否是用户取消 UAC
        if (e.status === 1 || e.message.indexOf('canceled') !== -1 || e.message.indexOf('取消') !== -1) {
            return { success: false, message: 'uac_canceled' };
        }
        return { success: false, message: '管理员权限执行失败: ' + e.message };
    } finally {
        try { fs.unlinkSync(psPath); } catch (ignore) {}
    }
}

// ============================================================
// 备份管理
// ============================================================

function hasBackup(dllPath) {
    return fs.existsSync(dllPath + '.bak') || fs.existsSync(getUserBackupPath(dllPath));
}

function backupDll(dllPath) {
    if (!fs.existsSync(dllPath)) throw new Error('DLL 文件不存在');

    // 优先存到 DLL 同目录
    try {
        fs.copyFileSync(dllPath, dllPath + '.bak');
        return dllPath + '.bak';
    } catch (e) { /* 权限不足，继续 */ }

    // 回退到用户目录
    var userBakPath = getUserBackupPath(dllPath);
    fs.copyFileSync(dllPath, userBakPath);
    return userBakPath;
}

function restoreDll(dllPath) {
    // 查找备份文件
    var bakPath = null;
    if (fs.existsSync(dllPath + '.bak')) {
        bakPath = dllPath + '.bak';
    } else {
        var userBakPath = getUserBackupPath(dllPath);
        if (fs.existsSync(userBakPath)) bakPath = userBakPath;
    }
    if (!bakPath) return { success: false, message: '未找到备份文件' };

    // 直接写入
    try {
        fs.copyFileSync(bakPath, dllPath);
        return { success: true, message: '已恢复原文件' };
    } catch (e) {
        // 区分"被占用"和"权限不足"
        if (e.code === 'EBUSY' || e.message.indexOf('busy') !== -1 || e.message.indexOf('locked') !== -1) {
            return { success: false, message: 'DLL 被占用，请先关闭微信后再试' };
        }
    }

    // Program Files 需要管理员权限
    if (isInProgramFiles(dllPath)) {
        var result = copyFileElevated(bakPath, dllPath);
        if (result.success) return { success: true, message: '已恢复原文件' };
        if (result.message === 'uac_canceled') return { success: false, message: 'uac_canceled' };
        return { success: false, message: '恢复失败: ' + result.message };
    }

    return { success: false, message: '恢复失败: 权限不足' };
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
    matchAll: matchAll,
    isPatched: isPatched,
    patchDll: patchDll,
    hasBackup: hasBackup,
    backupDll: backupDll,
    restoreDll: restoreDll,
    isInProgramFiles: isInProgramFiles,
};
