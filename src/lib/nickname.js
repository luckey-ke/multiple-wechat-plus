/**
 * nickname.js — 微信昵称提取与存储模块
 *
 * @module nickname
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Protobuf 工具
// ============================================================

function readVarint(buf, offset) {
    var result = 0, shift = 0;
    while (offset < buf.length) {
        var byte = buf[offset++];
        result |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return { value: result >>> 0, offset: offset };
        shift += 7;
        if (shift > 35) return null;
    }
    return null;
}

function isPlausibleNickname(str) {
    if (str.length < 1 || str.length > 64) return false;
    if (/^wxid_[a-zA-Z0-9_]+$/.test(str)) return false;
    if (/^[a-f0-9]{32,}$/.test(str)) return false;
    if (/^[0-9.]+$/.test(str)) return false;
    if (/^[A-Z]:\\/.test(str)) return false;
    if (/^https?:\/\//.test(str)) return false;
    if (/^[\x00-\x08\x0e-\x1f]+$/.test(str)) return false;
    return true;
}

function pickBestNickname(candidates) {
    if (candidates.length === 0) return null;
    var chinese = candidates.filter(function(c) { return /[^\x00-\x7f]/.test(c); });
    if (chinese.length > 0) return chinese[0];
    return candidates[0];
}

// ============================================================
// 自动提取
// ============================================================

function extractNicknameFromConfig(configPath) {
    var buf;
    try { buf = fs.readFileSync(configPath); } catch (e) { return null; }

    var candidates = [];
    var offset = 0;

    while (offset < buf.length) {
        var tagResult = readVarint(buf, offset);
        if (!tagResult) break;
        var wireType = tagResult.value & 0x07;
        offset = tagResult.offset;

        if (wireType === 2) {
            var lenResult = readVarint(buf, offset);
            if (!lenResult) break;
            var len = lenResult.value;
            offset = lenResult.offset;

            if (len > 0 && len < 256 && offset + len <= buf.length) {
                var slice = buf.slice(offset, offset + len);
                var str = slice.toString('utf8');
                if (isPlausibleNickname(str)) {
                    candidates.push(str);
                }
            }
            offset += len;
        } else if (wireType === 0) {
            var v = readVarint(buf, offset);
            if (!v) break;
            offset = v.offset;
        } else if (wireType === 5) {
            offset += 4;
        } else if (wireType === 1) {
            offset += 8;
        } else {
            break;
        }
    }

    return pickBestNickname(candidates);
}

// ============================================================
// 手动昵称存储
// ============================================================

function getManualNickname(wxid) {
    return window.dbDevice.getItem('nickname_' + wxid);
}

function setManualNickname(wxid, name) {
    if (!name || !name.trim()) {
        window.dbDevice.deleteItem('nickname_' + wxid);
    } else {
        window.dbDevice.setItem('nickname_' + wxid, name.trim());
    }
}

function clearManualNickname(wxid) {
    window.dbDevice.deleteItem('nickname_' + wxid);
}

// ============================================================
// 昵称解析（带缓存）
// ============================================================

function resolveNickname(wxid, configDirPath) {
    // 1. 手动昵称优先
    var manual = getManualNickname(wxid);
    if (manual) return manual;

    // 2. 自动提取（带缓存）
    var configPath = path.join(configDirPath, 'global_config');
    try {
        var stat = fs.statSync(configPath);
        var currentMtime = stat.mtimeMs;
        var cacheKey = 'auto_nickname_' + wxid;
        var cached = window.dbDevice.getItem(cacheKey);

        if (cached) {
            var parsed = JSON.parse(cached);
            if (parsed.mtime === currentMtime) {
                return parsed.name || wxid;
            }
        }

        var extracted = extractNicknameFromConfig(configPath);
        var cacheValue = JSON.stringify({ name: extracted, mtime: currentMtime });
        window.dbDevice.setItem(cacheKey, cacheValue);
        return extracted || wxid;
    } catch (e) {
        return wxid;
    }
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
    resolveNickname: resolveNickname,
    setManualNickname: setManualNickname,
    clearManualNickname: clearManualNickname,
};
