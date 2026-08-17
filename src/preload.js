/**
 * preload.js — 微信多开插件预加载脚本
 *
 * 运行环境：Electron preload 上下文（拥有 Node.js 完整能力）
 * 职责：初始化共享模块，向前端暴露 window.services API
 *
 * 架构说明：
 * - 本文件是 plugin.json 中 preload 字段指定的入口
 * - 业务逻辑委托给 lib/wechatService.js
 * - 数据存储委托给 lib/shared.js
 * - 文件操作委托给 lib/kill.js 和 lib/file.js
 *
 * @see plugin.json - preload 字段
 * @see index.html - 前端 UI 通过 window.services 调用后端接口
 */

const { initShared, getWechatFilePath, setWechatFilePath, getAccountOrder, saveAccountOrder } = require('./lib/shared');
const { downloadHandle, installLocalHandle, HANDLE_EXE_PATH } = require('./lib/kill');
const antiRevoke = require('./lib/antiRevoke');
const blockUpdate = require('./lib/blockUpdate');
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
 * - 初始化设备隔离的数据库封装 (window.dbDevice)
 * - 初始化日志系统 (window.logger)
 */
initShared();

// ============================================================
// 暴露给前端的服务接口
// ============================================================

/**
 * 前端可调用的服务接口集合
 *
 * 在 index.html 中通过 window.services 或 S 访问：
 * ```javascript
 * const S = window.services;
 * const status = S.getConfigStatus();
 * const accounts = S.getWechatList();
 * ```
 *
 * @namespace window.services
 */
window.services = {
    /**
     * 获取插件配置状态
     *
     * @returns {Object} 配置状态
     *   - handle.installed {boolean} handle.exe 是否已下载
     *   - handle.date {string|null} 文件修改日期
     *   - handle.path {string} handle.exe 路径
     *   - wechatPath {string|null} 微信文档路径
     */
    getConfigStatus,

    /**
     * 获取已排序的微信账号列表
     *
     * @returns {Array<Object>} 账号列表
     * @throws {Error} 微信文档路径未设置时抛出错误
     */
    getWechatList() {
        const wechatFilePath = getWechatFilePath();
        if (!wechatFilePath) throw new Error('请先设置微信文档路径');
        return getSortedAccounts();
    },

    /**
     * 设置微信文档目录路径
     *
     * @param {string} dirPath - 微信文档目录路径（如 C:\Users\xxx\Documents\xwechat_files）
     * @returns {Object} 设置结果
     *   - success {boolean} 是否成功
     *   - message {string} 提示信息
     */
    setWechatFilePath,

    /**
     * 下载 handle.exe 工具
     *
     * 从微软 Sysinternals 官方下载 Handle.zip 并解压。
     * 该工具用于释放微信的进程互斥锁和文件锁。
     *
     * @returns {Promise<string>} 下载结果提示
     * @throws {Error} 下载或解压失败
     */
    async downloadHandle() {
        return downloadHandle();
    },

    /**
     * 从插件内置压缩包本地安装 handle.exe（离线可用）
     *
     * Handle.zip 随插件打包，无需联网。
     *
     * @returns {Promise<string>} 安装结果提示
     * @throws {Error} 内置压缩包不存在、解压失败等
     */
    async installLocalHandle() {
        return installLocalHandle();
    },

    /**
     * 启动微信（支持指定账号或新建多开）
     *
     * @param {Object|null} itemData - 账号信息，null 表示新建多开
     * @returns {Promise<void>}
     * @throws {Error} handle.exe 不存在、配置替换失败等
     */
    startWechat,

    /**
     * 保存当前登录的微信账号配置
     *
     * @returns {Promise<Object>} 保存的账号信息
     * @throws {Error} 未登录微信、配置文件不存在等
     */
    saveWechat,

    /**
     * 删除已保存的账号配置
     *
     * @param {Object} itemData - 要删除的账号
     * @throws {Error} 账号信息不存在
     */
    deleteWechat,

    /**
     * 获取账号排序顺序
     *
     * @returns {Array<string>} 账号 ID 数组
     */
    getAccountOrder,

    /**
     * 保存账号排序顺序
     *
     * @param {Array<string>} order - 账号 ID 数组
     */
    saveAccountOrder,

    /**
     * 保存手动昵称
     *
     * @param {string} wxid - 账号 ID
     * @param {string} name - 昵称，空字符串则清除
     */
    saveNickname: setManualNickname,

    /**
     * 清除手动昵称
     *
     * @param {string} wxid - 账号 ID
     */
    clearNickname: clearManualNickname,

    /**
     * 保存自定义头像
     *
     * @param {string} wxid - 账号 ID
     * @param {string} sourcePath - 源图片路径
     */
    saveAvatar(wxid, sourcePath) {
        const wechatFilePath = getWechatFilePath();
        if (!wechatFilePath) throw new Error('请先设置微信文档路径');
        const configDirPath = require('path').join(wechatFilePath, 'all_users', 'plugin_save_config', wxid);
        setCustomAvatar(wxid, sourcePath, configDirPath);
    },

    /**
     * 清除自定义头像，恢复默认
     *
     * @param {string} wxid - 账号 ID
     */
    clearAvatar(wxid) {
        const wechatFilePath = getWechatFilePath();
        if (!wechatFilePath) throw new Error('请先设置微信文档路径');
        const configDirPath = require('path').join(wechatFilePath, 'all_users', 'plugin_save_config', wxid);
        clearCustomAvatar(wxid, configDirPath);
    },

    /**
     * 获取防撤回状态
     *
     * @returns {Promise<Object>} 状态对象
     */
    getAntiRevokeStatus() {
        return antiRevoke.getStatus();
    },

    /**
     * 启用防撤回
     *
     * @returns {Promise<Object>} 操作结果
     */
    enableAntiRevoke() {
        return antiRevoke.enable();
    },

    /**
     * 禁用防撤回（恢复原 DLL）
     *
     * @returns {Promise<Object>} 操作结果
     */
    disableAntiRevoke() {
        return antiRevoke.disable();
    },

    /**
     * 手动备份 DLL
     *
     * @returns {Promise<Object>} 操作结果
     */
    backupAntiRevoke() {
        return antiRevoke.backup();
    },

    /**
     * 获取禁止更新状态
     *
     * @returns {Promise<Object>} 状态对象
     */
    getBlockUpdateStatus() {
        return blockUpdate.getStatus();
    },

    /**
     * 禁止微信更新
     *
     * @returns {Promise<Object>} 操作结果
     */
    enableBlockUpdate() {
        return blockUpdate.enable();
    },

    /**
     * 还原微信更新
     *
     * @returns {Promise<Object>} 操作结果
     */
    disableBlockUpdate() {
        return blockUpdate.disable();
    },

    /**
     * 在文件管理器中打开指定路径
     *
     * @param {string} p - 文件或目录路径
     */
    openFolder(p) {
        utools.shellOpenPath(p);
    },
};
