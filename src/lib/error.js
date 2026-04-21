/**
 * 自定义错误类型，用于区分配置错误和运行时错误
 */
class GoConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GoConfigError';
        this.isConfigError = true;
    }
}

module.exports = { GoConfigError };
