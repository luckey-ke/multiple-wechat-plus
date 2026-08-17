/**
 * patches/index.js — 补丁签名加载器
 *
 * 自动扫描 patches/ 下所有子目录的 patch.json，
 * 直接兼容 RevokeMsgPatcher 的 JSON 格式。
 *
 * 新增版本支持：从 RevokeMsgPatcher 的 patch.json 复制对应条目，
 * 在 patches/ 下新建文件夹放入即可，无需改代码。
 *
 * patch.json 格式（与 RevokeMsgPatcher 完全一致）：
 * {
 *   "Name": "Weixin.dll",
 *   "StartVersion": "4.0.3.0",
 *   "EndVersion": "",
 *   "ReplacePatterns": [
 *     {
 *       "Search": [117, 33, ...],   // 十进制字节数组，63=通配符
 *       "Replace": [235, 33, ...],
 *       "Category": "防撤回"
 *     }
 *   ]
 * }
 *
 * @module patches
 */

var fs = require('fs');
var path = require('path');

// ============================================================
// 版本号比较
// ============================================================

function compareVersion(a, b) {
    var pa = a.split('.').map(Number);
    var pb = b.split('.').map(Number);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
        var na = pa[i] || 0;
        var nb = pb[i] || 0;
        if (na < nb) return -1;
        if (na > nb) return 1;
    }
    return 0;
}

// ============================================================
// 加载所有 patch.json
// ============================================================

var allEntries = [];
var patchesDir = __dirname;

try {
    var dirs = fs.readdirSync(patchesDir);
    for (var i = 0; i < dirs.length; i++) {
        var dir = dirs[i];
        var dirPath = path.join(patchesDir, dir);
        try { if (!fs.statSync(dirPath).isDirectory()) continue; } catch (e) { continue; }

        var jsonPath = path.join(dirPath, 'patch.json');
        if (!fs.existsSync(jsonPath)) continue;

        try {
            var data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            if (!data.ReplacePatterns || !data.StartVersion) continue;

            // 加载全部类别的补丁（防撤回 / 禁止更新等）
            var patches = [];
            for (var j = 0; j < data.ReplacePatterns.length; j++) {
                var p = data.ReplacePatterns[j];
                if (p.Category) {
                    patches.push({
                        name: p.Category,
                        category: p.Category,
                        search: p.Search,     // 直接使用十进制数组
                        replace: p.Replace,   // 直接使用十进制数组
                    });
                }
            }

            if (patches.length > 0) {
                allEntries.push({
                    startVersion: data.StartVersion,
                    endVersion: data.EndVersion || '',
                    dllFile: data.Name,
                    patches: patches,
                });
            }
        } catch (e) {
            // 单个文件解析失败不影响其他文件
        }
    }
} catch (e) {
    // 目录读取失败
}

// 按 startVersion 降序排列（新版本优先匹配）
allEntries.sort(function(a, b) {
    return compareVersion(b.startVersion, a.startVersion);
});

// ============================================================
// 查询接口
// ============================================================

/**
 * 根据微信版本查找匹配的补丁定义
 *
 * @param {string} version - 微信版本号
 * @param {string} [category] - 可选，按类别过滤（如 '撤回'、'禁止更新'），缺省不过滤
 * @returns {Object|null} { dllFile, patches, name } 或 null
 */
function findPatch(version, category) {
    for (var i = 0; i < allEntries.length; i++) {
        var entry = allEntries[i];
        var inRange = true;
        // start <= version <= end（闭区间，与 RevokeMsgPatcher 的 EndVersion 闭区间一致）
        if (entry.startVersion && compareVersion(version, entry.startVersion) < 0) inRange = false;
        if (entry.endVersion && entry.endVersion !== '' && compareVersion(version, entry.endVersion) > 0) inRange = false;

        if (inRange) {
            // 按类别过滤
            var patches = entry.patches;
            if (category) {
                patches = patches.filter(function(p) {
                    return p.category.indexOf(category) !== -1;
                });
            }
            if (patches.length === 0) continue;

            return {
                dllFile: entry.dllFile,
                patches: patches,
                name: category || patches[0].category,
            };
        }
    }
    return null;
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
    findPatch: findPatch,
    allEntries: allEntries,
};
