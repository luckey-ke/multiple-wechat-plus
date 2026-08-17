/**
 * blockUpdate.js — 禁止微信更新业务逻辑
 *
 * 原理（参考 BetterWX-UI issue #49）：
 * 把 Weixin.dll 中的 "WeixinUpdate.exe" 字符串首字符 W→X（等长替换 0x57→0x58），
 * 微信主程序启动更新器时按文件名找不到目标，更新流程中断。
 *
 * 还原方式：反向补丁 X→W（不走 .bak 整体恢复，避免把防撤回补丁一起还原）。
 *
 * @module blockUpdate
 */

const fs = require('fs');
const path = require('path');
const patcher = require('./patcher');
const patchDb = require('./patchDb');
const antiRevoke = require('./antiRevoke');

// ============================================================
// 内部工具
// ============================================================

/**
 * 定位 DLL 和补丁定义
 *
 * @returns {Promise<{exeDir, version, dllPath, patchDef}>}
 */
function locate() {
    return antiRevoke.getWechatExeDir().then(function(exeDir) {
        var version = antiRevoke.detectWechatVersion(exeDir);
        if (!version) throw new Error('无法检测微信版本');

        var patchDef = patchDb.findPatch(version, '禁止更新');
        if (!patchDef) throw new Error('当前版本暂不支持禁止更新');

        // 与 antiRevoke 相同的定位逻辑：优先 patchDef 指定的 DLL，回退另一个
        var dllPath = antiRevoke.findDllPath(exeDir, patchDef.dllFile);
        if (!dllPath) {
            var altDll = patchDef.dllFile === 'Weixin.dll' ? 'WeChatWin.dll' : 'Weixin.dll';
            dllPath = antiRevoke.findDllPath(exeDir, altDll);
        }
        if (!dllPath) throw new Error('未找到微信 DLL 文件');

        return { exeDir: exeDir, version: version, dllPath: dllPath, patchDef: patchDef };
    });
}

/**
 * 构造反向补丁（swap search/replace），用于还原
 *
 * @param {Array} patches - 正向补丁数组
 * @returns {Array} 反向补丁数组
 */
function reversedPatches(patches) {
    return patches.map(function(p) {
        return {
            name: p.name + '（还原）',
            search: p.replace,
            replace: p.search,
        };
    });
}

// ============================================================
// 状态检测
// ============================================================

/**
 * 获取禁止更新功能状态
 *
 * @returns {Promise<Object>} 状态对象
 *   - available {boolean} 是否可用
 *   - enabled {boolean} 是否已禁止更新（DLL 已打补丁）
 *   - version {string|null} 微信版本
 *   - dllFile {string|null} DLL 文件名
 *   - dllPath {string|null} DLL 完整路径
 *   - needsElevation {boolean} DLL 是否在 Program Files（需 UAC）
 *   - message {string} 状态说明
 */
function getStatus() {
    return locate().then(function(loc) {
        var buf;
        try {
            buf = fs.readFileSync(loc.dllPath);
        } catch (e) {
            return {
                available: false, enabled: false, version: loc.version,
                dllFile: path.basename(loc.dllPath), dllPath: loc.dllPath,
                needsElevation: false, message: '读取 DLL 失败: ' + e.message,
            };
        }

        var enabled = patcher.isPatched(buf, loc.patchDef.patches);
        return {
            available: true, enabled: enabled, version: loc.version,
            dllFile: path.basename(loc.dllPath), dllPath: loc.dllPath,
            needsElevation: patcher.isInProgramFiles(loc.dllPath),
            message: enabled ? '已禁止更新' : '未禁止更新',
        };
    }).catch(function(err) {
        return {
            available: false, enabled: false, version: null,
            dllFile: null, dllPath: null, needsElevation: false,
            message: err.message,
        };
    });
}

// ============================================================
// 启用 / 禁用
// ============================================================

/**
 * 禁止微信更新（正向补丁 W→X）
 *
 * @returns {Promise<Object>} 操作结果
 */
function enable() {
    return locate().then(function(loc) {
        return patcher.patchDll(loc.dllPath, loc.patchDef.patches, { force: false });
    }).catch(function(err) {
        return { success: false, message: err.message };
    });
}

/**
 * 还原微信更新（反向补丁 X→W，不影响防撤回补丁）
 *
 * @returns {Promise<Object>} 操作结果
 */
function disable() {
    return locate().then(function(loc) {
        var reverse = reversedPatches(loc.patchDef.patches);
        // skipCheck 必须传 true：反向补丁的 replace 是原始字符串，
        // isPatched 会误报"已打过"导致还原被跳过
        return patcher.patchDll(loc.dllPath, reverse, { force: false, backup: false, skipCheck: true });
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
};
