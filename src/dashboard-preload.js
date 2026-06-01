/**
 * dashboard-preload.js — 仪表盘子窗口预加载脚本
 *
 * 运行环境：utools.createBrowserWindow() 创建的独立渲染窗口
 * 职责：复用共享模块，暴露 RPC 函数给子窗口前端
 *
 * 与 preload.js 的区别：
 * - preload.js 运行在主窗口，暴露 window.services 对象
 * - dashboard-preload.js 运行在独立窗口，直接暴露 window 全局函数
 *
 * @see utools.createBrowserWindow - 创建独立窗口的 API
 * @see plugin.json - 如使用独立窗口模式，需在 features 中指定
 */

const { initShared, getAccountOrder, saveAccountOrder, getWechatFilePath } = require('./lib/shared');
const { downloadHandle, HANDLE_EXE_PATH } = require('./lib/kill');
const path = require('path');
const {
    getConfigStatus,
    getSortedAccounts,
    startWechat,
    saveWechat,
    deleteWechat,
    setManualNickname,
    clearManualNickname,
    setCustomAvatar,
    clearCustomAvatar,
} = require('./lib/wechatService');

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化共享模块
 * 子窗口需要独立初始化，因为每个窗口有独立的 JavaScript 上下文
 */
initShared();

// ============================================================
// 暴露 RPC 函数（供子窗口前端调用）
// ============================================================

/**
 * 获取插件配置状态
 * @async
 * @returns {Promise<Object>} 配置状态对象
 */
window.getConfigStatus = getConfigStatus;

/**
 * 获取已排序的微信账号列表
 * @async
 * @returns {Promise<Array<Object>>} 账号列表
 */
window.getWechatList = getSortedAccounts;

/**
 * 启动微信
 * @async
 * @param {Object|null} itemData - 账号信息，null 表示新建多开
 * @returns {Promise<void>}
 */
window.startWechat = startWechat;

/**
 * 保存当前登录的微信账号
 * @async
 * @returns {Promise<Object>} 保存的账号信息
 */
window.saveWechat = saveWechat;

/**
 * 删除已保存的账号
 * @param {Object} itemData - 要删除的账号
 */
window.deleteWechat = deleteWechat;

/**
 * 下载 handle.exe
 * @async
 * @returns {Promise<string>} 下载结果
 */
window.downloadHandle = downloadHandle;

/**
 * 获取账号排序顺序
 * @returns {Array<string>} 账号 ID 数组
 */
window.getAccountOrder = getAccountOrder;

/**
 * 保存账号排序顺序
 * @param {Array<string>} order - 账号 ID 数组
 */
window.saveAccountOrder = saveAccountOrder;

/**
 * 保存手动昵称
 * @param {string} wxid - 账号 ID
 * @param {string} name - 昵称
 */
window.saveNickname = setManualNickname;

/**
 * 清除手动昵称
 * @param {string} wxid - 账号 ID
 */
window.clearNickname = clearManualNickname;

/**
 * 保存自定义头像
 * @param {string} wxid - 账号 ID
 * @param {string} sourcePath - 源图片路径
 */
window.saveAvatar = function(wxid, sourcePath) {
    var configDirPath = path.join(getWechatFilePath(), 'all_users', 'plugin_save_config', wxid);
    setCustomAvatar(wxid, sourcePath, configDirPath);
};

/**
 * 清除自定义头像，恢复默认
 * @param {string} wxid - 账号 ID
 */
window.clearAvatar = function(wxid) {
    var configDirPath = path.join(getWechatFilePath(), 'all_users', 'plugin_save_config', wxid);
    clearCustomAvatar(wxid, configDirPath);
};

/**
 * 在文件管理器中打开指定路径
 * @param {string} p - 文件或目录路径
 */
window.openFolder = (p) => utools.shellOpenPath(p);
