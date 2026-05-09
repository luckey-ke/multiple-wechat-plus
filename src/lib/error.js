/**
 * error.js — 自定义错误类型
 *
 * 提供专门的错误类型，用于区分配置错误和运行时错误，
 * 以便前端可以针对不同类型的错误给出不同的提示。
 *
 * @module error
 */

// ============================================================
// GoConfigError 类
// ============================================================

/**
 * 配置错误类型
 *
 * 用于标识因配置问题导致的错误（如 handle.exe 不存在、微信路径未设置等），
 * 与普通运行时错误区分。前端可以通过 isConfigError 属性判断错误类型，
 * 给出更有针对性的提示。
 *
 * @class GoConfigError
 * @extends Error
 * @param {string} message - 错误消息
 *
 * @example
 * const { GoConfigError } = require('./error');
 *
 * // 抛出配置错误
 * throw new GoConfigError('handle.exe 不存在，请先下载');
 *
 * // 捕获并判断类型
 * try {
 *     await startWechat();
 * } catch (e) {
 *     if (e.isConfigError) {
 *         showConfigGuide(e.message);
 *     } else {
 *         showError(e.message);
 *     }
 * }
 */
class GoConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GoConfigError';
        /**
         * 标识这是一个配置错误
         * @type {boolean}
         */
        this.isConfigError = true;
    }
}

// ============================================================
// 模块导出
// ============================================================

module.exports = { GoConfigError };
