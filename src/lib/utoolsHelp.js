/**
 * utoolsHelp.js — uTools 全局辅助（必须最先加载）
 * 提供 dbDevice 和 logger 到 window 全局对象
 */
const { initDbDevice, initLogger } = require('./shared');

initDbDevice();
initLogger();
