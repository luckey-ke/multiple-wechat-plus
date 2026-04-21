/**
 * lib/shared.js — 共享初始化（供 preload.js 和 dashboard-preload.js 复用）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createLogger } = require('./logger');

// ========== 数据库封装 ==========
function initDbDevice() {
    if (window.dbDevice) return; // 避免重复初始化
    window.dbDevice = {
        getItem(name) {
            const device = utools.getNativeId();
            return utools.dbStorage.getItem(name + '_' + device);
        },
        setItem(name, value) {
            const device = utools.getNativeId();
            utools.dbStorage.setItem(name + '_' + device, value);
        },
        deleteItem(name) {
            const device = utools.getNativeId();
            utools.dbStorage.removeItem(name + '_' + device);
        },
    };
}

// ========== 日志初始化 ==========
function initLogger() {
    if (window.logger) return;
    const logPath = utools.isDev()
        ? path.join(__dirname, '..', '..', 'log.log')
        : path.join(os.tmpdir(), 'multiple_wechat.log');
    window.logger = createLogger(logPath);
}

// ========== 微信文档路径获取（纯函数，无 UI 依赖）=========
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

// ========== 账号排序 ==========
function getAccountOrder() {
    return window.dbDevice.getItem('accountOrder') || [];
}

function saveAccountOrder(order) {
    window.dbDevice.setItem('accountOrder', order);
}

// ========== 核心业务（统一入口，避免重复）=========

function getHandleExePath() {
    const basePath = path.join(os.homedir(), 'multiple_wechat');
    if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
    return path.join(basePath, 'handle.exe');
}

// 初始化所有共享模块
function initShared() {
    initDbDevice();
    initLogger();
}

module.exports = {
    initShared,
    initDbDevice,
    initLogger,
    getWechatFilePath,
    setWechatFilePath,
    getAccountOrder,
    saveAccountOrder,
    getHandleExePath,
};
