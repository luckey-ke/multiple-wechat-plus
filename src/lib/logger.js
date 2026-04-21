// logger.js — 基于原 node-logger 改造，移除废弃 sys 模块
// 原作者: Aaron Quint (MIT License)

const path = require('path');
const fs = require('fs');

function makeArray(nonarray) {
    return Array.prototype.slice.call(nonarray);
}

function Logger(log_file_path) {
    this.write = (text) => process.stdout.write(text);
    this.log_level_index = 3; // info

    if (log_file_path) {
        log_file_path = path.normalize(log_file_path);
        this.stream = fs.createWriteStream(log_file_path, {
            flags: 'a',
            encoding: 'utf8',
            mode: 0o666,
        });
        this.stream.write('\n');
        this.write = (text) => this.stream.write(text);
    }
}

Logger.levels = ['fatal', 'error', 'warn', 'info', 'debug'];

Logger.prototype.format = function (level, date, message) {
    return `${level} [${date}] ${message}`;
};

Logger.prototype.setLevel = function (new_level) {
    var index = Logger.levels.indexOf(new_level);
    return index !== -1 ? (this.log_level_index = index) : false;
};

Logger.prototype.log = function () {
    var args = makeArray(arguments);
    var log_index = Logger.levels.indexOf(args[0]);
    var message = '';

    if (log_index === -1) {
        log_index = this.log_level_index;
    } else {
        args.shift();
    }

    if (log_index <= this.log_level_index) {
        args.forEach(function (arg) {
            if (typeof arg === 'string') {
                message += ' ' + arg;
            } else {
                message += ' ' + require('util').inspect(arg, false, null);
            }
        });
        message = this.format(Logger.levels[log_index], new Date(), message);
        this.write(message + '\n');
        return message;
    }
    return false;
};

Logger.levels.forEach(function (level) {
    Logger.prototype[level] = function () {
        var args = makeArray(arguments);
        args.unshift(level);
        return this.log.apply(this, args);
    };
});

exports.Logger = Logger;
exports.createLogger = function (log_file_path) {
    return new Logger(log_file_path);
};
