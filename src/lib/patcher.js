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
    if (doBackup && !fs.existsSync(dllPath + '.bak')) {
        try {
            fs.copyFileSync(dllPath, dllPath + '.bak');
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
    try {
        for (var c = 0; c < changes.length; c++) {
            var change = changes[c];
            for (var b = 0; b < change.replace.length; b++) {
                if (change.replace[b] === 0x3F) {
                    // 通配符：保留原字节，不写入
                    continue;
                }
                buf[change.position + b] = change.replace[b];
            }
        }
        fs.writeFileSync(dllPath, buf);
    } catch (e) {
        // 写入失败时尝试恢复备份
        if (doBackup && fs.existsSync(dllPath + '.bak')) {
            try { fs.copyFileSync(dllPath + '.bak', dllPath); } catch (ignore) {}
        }
        return { success: false, message: '写入失败: ' + e.message, details: [] };
    }

    return { success: true, message: '补丁成功', details: changes.map(function(c) {
        return { name: c.name, position: c.position };
    }) };
}

// ============================================================
// 备份管理
// ============================================================

function hasBackup(dllPath) {
    return fs.existsSync(dllPath + '.bak');
}

function restoreDll(dllPath) {
    var bakPath = dllPath + '.bak';
    if (!fs.existsSync(bakPath)) return false;
    fs.copyFileSync(bakPath, dllPath);
    return true;
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
    matchAll: matchAll,
    isPatched: isPatched,
    patchDll: patchDll,
    hasBackup: hasBackup,
    restoreDll: restoreDll,
};
