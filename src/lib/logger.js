/**
 * logger.js — 日志系统
 *
 * 提供多级别的日志记录功能，支持控制台输出和文件输出。
 *
 * 日志级别（从高到低）：
 * - fatal: 致命错误，程序无法继续运行
 * - error: 错误，某个操作失败但程序可以继续
 * - warn: 警告，潜在问题但不影响正常运行
 * - info: 信息，正常操作记录
 * - debug: 调试，详细的调试信息
 *
 * 使用方式：
 * ```javascript
 * const { createLogger } = require('./logger');
 *
 * // 输出到控制台
 * const consoleLogger = createLogger(null);
 * consoleLogger.info('操作成功');
 *
 * // 输出到文件
 * const fileLogger = createLogger('/path/to/logfile.log');
 * fileLogger.error('操作失败', error.message);
 * ```
 *
 * @module logger
 * @requires path
 * @requires fs
 *
 * @see shared.js - initLogger() 使用本模块创建全局日志实例
 */

const path = require('path');
const fs = require('fs');

// ============================================================
// 工具函数
// ============================================================

/**
 * 将类数组对象转换为数组
 *
 * @param {IArguments} nonarray - arguments 对象
 * @returns {Array} 数组
 * @private
 */
function makeArray(nonarray) {
    return Array.prototype.slice.call(nonarray);
}

// ============================================================
// Logger 类
// ============================================================

/**
 * 日志记录器
 *
 * 支持两种输出模式：
 * 1. 控制台输出（log_file_path 为 null）
 * 2. 文件输出（log_file_path 为文件路径）
 *
 * @class Logger
 * @param {string|null} log_file_path - 日志文件路径，null 表示输出到控制台
 *
 * @example
 * // 控制台日志
 * const logger = new Logger(null);
 * logger.info('Hello');  // 输出到 stdout
 *
 * @example
 * // 文件日志
 * const logger = new Logger('/var/log/app.log');
 * logger.error('Something went wrong');  // 写入文件
 */
function Logger(log_file_path) {
    // 默认输出到 stdout
    this.write = (text) => process.stdout.write(text);
    this.log_level_index = 3; // 默认级别：info

    if (log_file_path) {
        log_file_path = path.normalize(log_file_path);
        this.stream = fs.createWriteStream(log_file_path, {
            flags: 'a',       // 追加模式
            encoding: 'utf8',
            mode: 0o666,
        });
        this.stream.write('\n');
        this.write = (text) => this.stream.write(text);
    }
}

/**
 * 可用的日志级别列表
 * @static
 * @type {string[]}
 */
Logger.levels = ['fatal', 'error', 'warn', 'info', 'debug'];

/**
 * 格式化日志消息
 *
 * @param {string} level - 日志级别
 * @param {Date} date - 日志时间
 * @param {string} message - 日志消息
 * @returns {string} 格式化后的日志字符串
 */
Logger.prototype.format = function (level, date, message) {
    return `${level} [${date}] ${message}`;
};

/**
 * 设置日志级别
 *
 * 低于此级别的日志将被忽略。
 *
 * @param {string} new_level - 日志级别名称（'fatal'|'error'|'warn'|'info'|'debug'）
 * @returns {number|boolean} 设置后的级别索引，无效级别返回 false
 *
 * @example
 * logger.setLevel('debug');  // 启用所有日志
 * logger.setLevel('error');  // 只记录 fatal 和 error
 */
Logger.prototype.setLevel = function (new_level) {
    var index = Logger.levels.indexOf(new_level);
    return index !== -1 ? (this.log_level_index = index) : false;
};

/**
 * 记录日志
 *
 * @param {...*} args - 第一个参数可以是日志级别，后续参数为日志内容
 * @returns {string|false} 格式化后的日志字符串，被过滤时返回 false
 *
 * @example
 * logger.log('info', '用户登录', { id: 'wxid_abc' });
 * logger.log('操作成功');  // 使用当前级别
 */
Logger.prototype.log = function () {
    var args = makeArray(arguments);
    var log_index = Logger.levels.indexOf(args[0]);
    var message = '';

    if (log_index === -1) {
        // 第一个参数不是级别，使用当前级别
        log_index = this.log_level_index;
    } else {
        args.shift();
    }

    if (log_index <= this.log_level_index) {
        args.forEach(function (arg) {
            if (typeof arg === 'string') {
                message += ' ' + arg;
            } else {
                // 对象使用 util.inspect 序列化
                message += ' ' + require('util').inspect(arg, false, null);
            }
        });
        message = this.format(Logger.levels[log_index], new Date(), message);
        this.write(message + '\n');
        return message;
    }
    return false;
};

// ============================================================
// 动态生成各级别方法
// ============================================================

/**
 * 为每个日志级别生成便捷方法
 *
 * 生成的方法：
 * - logger.fatal(msg, ...args)
 * - logger.error(msg, ...args)
 * - logger.warn(msg, ...args)
 * - logger.info(msg, ...args)
 * - logger.debug(msg, ...args)
 */
Logger.levels.forEach(function (level) {
    Logger.prototype[level] = function () {
        var args = makeArray(arguments);
        args.unshift(level);
        return this.log.apply(this, args);
    };
});

// ============================================================
// 模块导出
// ============================================================

exports.Logger = Logger;

/**
 * 创建 Logger 实例的便捷函数
 *
 * @param {string|null} log_file_path - 日志文件路径，null 表示输出到控制台
 * @returns {Logger} Logger 实例
 *
 * @example
 * const { createLogger } = require('./logger');
 * const logger = createLogger(null);
 * logger.info('Hello');
 */
exports.createLogger = function (log_file_path) {
    return new Logger(log_file_path);
};
