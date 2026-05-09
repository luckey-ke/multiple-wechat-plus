/**
 * shared.js — 共享初始化模块
 *
 * 提供所有 preload 脚本共用的基础设施：
 * - 设备隔离的数据库封装 (dbDevice)
 * - 日志系统 (logger)
 * - 微信文档路径管理
 * - 账号排序持久化
 *
 * 本模块必须在其他业务模块之前初始化（调用 initShared()），
 * 初始化后会将 dbDevice 和 logger 挂载到 window 全局对象。
 *
 * @module shared
 * @requires fs
 * @requires path
 * @requires os
 * @requires ./logger
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createLogger } = require('./logger');

// ============================================================
// 数据库封装（设备隔离）
// ============================================================

/**
 * 初始化设备隔离的数据库封装
 *
 * uTools 的 dbStorage 是全局共享的，但多开插件需要按设备隔离数据。
 * 本函数将 utools.getNativeId() 作为后缀拼接到每个 key，
 * 确保同一 uTools 账号在不同设备上的数据互不干扰。
 *
 * 初始化后挂载到 window.dbDevice，提供以下方法：
 * - getItem(name): 读取键值
 * - setItem(name, value): 写入键值
 * - deleteItem(name): 删除键值
 *
 * @example
 * // 在 initShared() 之后使用
 * window.dbDevice.setItem('wechatFilePath', 'C:/Users/xxx/Documents/xwechat_files');
 * const path = window.dbDevice.getItem('wechatFilePath');
 */
function initDbDevice() {
    if (window.dbDevice) return; // 避免重复初始化

    window.dbDevice = {
        /**
         * 读取设备隔离的键值
         * @param {string} name - 键名（不含设备后缀）
         * @returns {*} 键值，不存在返回 null
         */
        getItem(name) {
            const device = utools.getNativeId();
            return utools.dbStorage.getItem(name + '_' + device);
        },

        /**
         * 写入设备隔离的键值
         * @param {string} name - 键名（不含设备后缀）
         * @param {*} value - 键值
         */
        setItem(name, value) {
            const device = utools.getNativeId();
            utools.dbStorage.setItem(name + '_' + device, value);
        },

        /**
         * 删除设备隔离的键值
         * @param {string} name - 键名（不含设备后缀）
         */
        deleteItem(name) {
            const device = utools.getNativeId();
            utools.dbStorage.removeItem(name + '_' + device);
        },
    };
}

// ============================================================
// 日志系统
// ============================================================

/**
 * 初始化日志系统
 *
 * 日志输出位置：
 * - 开发模式：项目根目录的 log.log
 * - 生产模式：系统临时目录的 multiple_wechat.log
 *
 * 初始化后挂载到 window.logger，提供以下方法：
 * - logger.fatal(msg, ...args)
 * - logger.error(msg, ...args)
 * - logger.warn(msg, ...args)
 * - logger.info(msg, ...args)
 * - logger.debug(msg, ...args)
 *
 * @example
 * window.logger.info('操作成功', { id: 'wxid_abc' });
 * window.logger.error('操作失败', error.message);
 */
function initLogger() {
    if (window.logger) return; // 避免重复初始化

    const logPath = utools.isDev()
        ? path.join(__dirname, '..', '..', 'log.log')
        : path.join(os.tmpdir(), 'multiple_wechat.log');

    window.logger = createLogger(logPath);
}

// ============================================================
// 统一初始化
// ============================================================

/**
 * 初始化所有共享模块
 *
 * 调用顺序：
 * 1. initDbDevice() - 初始化数据库封装
 * 2. initLogger() - 初始化日志系统
 *
 * 此函数应在 preload 脚本的最开始调用，确保后续代码可以使用
 * window.dbDevice 和 window.logger。
 *
 * @example
 * const { initShared } = require('./lib/shared');
 * initShared();
 * // 现在可以使用 window.dbDevice 和 window.logger
 */
function initShared() {
    initDbDevice();
    initLogger();
}

// ============================================================
// 微信文档路径管理
// ============================================================

/**
 * 获取微信文档路径
 *
 * 查找优先级：
 * 1. 用户设置的路径（存储在 dbDevice.wechatFilePath）
 * 2. 默认路径（用户文档目录下的 xwechat_files）
 *
 * @returns {string|null} 微信文档路径，未找到返回 null
 *
 * @example
 * const wechatPath = getWechatFilePath();
 * if (!wechatPath) {
 *     console.log('请先设置微信文档路径');
 * }
 */
function getWechatFilePath() {
    let filePath = window.dbDevice.getItem('wechatFilePath');
    const defaultPath = path.join(utools.getPath('documents'), 'xwechat_files');

    if (!filePath || !fs.existsSync(filePath)) {
        filePath = fs.existsSync(defaultPath) ? defaultPath : null;
    }

    return filePath;
}

/**
 * 校验并保存微信文档路径
 *
 * 校验规则：目录下必须存在 all_users/config/global_config 或
 * all_users/plugin_save_config，否则认为不是有效的微信文档目录。
 *
 * @param {string} dirPath - 微信文档目录路径
 * @returns {Object} 设置结果
 *   - success {boolean} 是否成功
 *   - message {string} 提示信息
 *
 * @example
 * const result = setWechatFilePath('C:/Users/xxx/Documents/xwechat_files');
 * if (!result.success) {
 *     console.error(result.message);
 * }
 */
function setWechatFilePath(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath)) {
        return { success: false, message: '目录不存在' };
    }

    const globalConfig = path.join(dirPath, 'all_users', 'config', 'global_config');
    const pluginConfig = path.join(dirPath, 'all_users', 'plugin_save_config');

    if (!fs.existsSync(globalConfig) && !fs.existsSync(pluginConfig)) {
        return {
            success: false,
            message: '该目录不是有效的微信文档目录\n缺少 all_users\\config\\global_config\n请选择 xwechat_files 文件夹',
        };
    }

    window.dbDevice.setItem('wechatFilePath', dirPath);
    return { success: true, message: '路径已保存' };
}

// ============================================================
// 账号排序
// ============================================================

/**
 * 获取账号排序顺序
 *
 * @returns {Array<string>} 账号 ID 数组，按用户自定义顺序排列
 *
 * @example
 * const order = getAccountOrder();
 * console.log(order); // ['wxid_abc', 'wxid_def', ...]
 */
function getAccountOrder() {
    return window.dbDevice.getItem('accountOrder') || [];
}

/**
 * 保存账号排序顺序
 *
 * @param {Array<string>} order - 账号 ID 数组
 *
 * @example
 * saveAccountOrder(['wxid_abc', 'wxid_def']);
 */
function saveAccountOrder(order) {
    window.dbDevice.setItem('accountOrder', order);
}

// ============================================================
// handle.exe 路径
// ============================================================

/**
 * 获取 handle.exe 的存储路径
 *
 * handle.exe 存储在用户主目录下的 multiple_wechat 文件夹。
 * 如果目录不存在会自动创建。
 *
 * @returns {string} handle.exe 的完整路径
 *
 * @example
 * const handlePath = getHandleExePath();
 * console.log(handlePath); // C:\Users\xxx\multiple_wechat\handle.exe
 */
function getHandleExePath() {
    const basePath = path.join(os.homedir(), 'multiple_wechat');
    if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true });
    }
    return path.join(basePath, 'handle.exe');
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
    // 初始化
    initShared,
    initDbDevice,
    initLogger,

    // 路径管理
    getWechatFilePath,
    setWechatFilePath,
    getHandleExePath,

    // 排序
    getAccountOrder,
    saveAccountOrder,

    // 全局对象访问（初始化后可用）
    // 注意：这些在 initShared() 调用前为 undefined
    get dbDevice() { return window.dbDevice; },
    get logger() { return window.logger; },
};
