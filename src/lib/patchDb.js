/**
 * patchDb.js — 微信防撤回补丁数据库
 *
 * 补丁签名统一维护在 patches/ 目录下，按版本范围分文件。
 * 新增版本支持只需在 patches/ 下新增文件并在 index.js 中注册。
 *
 * @module patchDb
 * @see patches/index.js - 签名加载器
 * @see patches/wechat4.js - WeChat 4.0+ 签名
 */

var patchesIndex = require('./patches');

// ============================================================
// 查询函数
// ============================================================

/**
 * 根据微信版本查找匹配的补丁定义
 *
 * @param {string} version - 微信版本号，如 '4.0.6.26'
 * @param {string} [category] - 可选，按类别过滤（如 '撤回'、'禁止更新'），缺省不过滤
 * @returns {Object|null} { dllFile, patches, name } 或 null
 */
function findPatch(version, category) {
    return patchesIndex.findPatch(version, category);
}

/**
 * 获取所有支持的补丁条目
 *
 * @returns {Array<Object>}
 */
function getAllPatches() {
    return patchesIndex.allEntries;
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
    findPatch: findPatch,
    getAllPatches: getAllPatches,
};
