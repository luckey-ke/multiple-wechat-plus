require('./lib/utoolsHelp');

const { wechatHelp } = require('./lib/wechatHelp');
const { downloadHandle, HANDLE_EXE_PATH } = require('./lib/kill');
const { GoConfigError } = require('./lib/error');
const fs = require('node:fs');
const path = require('path');

// ========== UI API（暴露给 index.html 调用） ==========

window.wechatAPI = {
    getConfigStatus: () => wechatHelp.getConfigStatus(),
    handleExists: () => fs.existsSync(HANDLE_EXE_PATH),

    async startWx(itemData) {
        try {
            await wechatHelp.startWx(itemData);
            return { success: true, message: itemData ? '已启动：' + itemData.id : '新微信已启动' };
        } catch (e) {
            if (e instanceof GoConfigError) return { success: false, configError: true, message: e.message };
            return { success: false, message: e.message };
        }
    },

    async saveWxData() {
        try {
            const data = await wechatHelp.saveWxData();
            return { success: true, data, message: '保存成功：' + data.name };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },

    async getAccountList() {
        try {
            return await wechatHelp.getLocalWechatAccountList();
        } catch (e) {
            if (e instanceof GoConfigError) return null;
            throw e;
        }
    },

    moveUp(wxid) { wechatHelp.moveAccountUp(wxid); },
    moveDown(wxid) { wechatHelp.moveAccountDown(wxid); },
    async deleteAccount(id) {
        try {
            const list = await wechatHelp.getLocalWechatAccountList();
            const acc = list.find(a => a.id === id);
            if (acc) wechatHelp.deleteWechat(acc);
            return true;
        } catch (e) {
            utools.showNotification('删除失败：' + e.message);
            return false;
        }
    },

    saveWechatFilePath(p) {
        wechatHelp.saveWechatFilePath(p);
    },

    async downloadHandle() {
        if (fs.existsSync(HANDLE_EXE_PATH)) return { success: true, message: '已存在' };
        try {
            await downloadHandle();
            return { success: true, message: '下载成功' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }
};

// ========== 加载自定义 HTML 仪表盘 ==========

function loadDashboard() {
    const htmlPath = path.join(__dirname, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // 从 HTML 中提取 <style> 和 <body> 内容
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];

    // 注入样式
    if (styleMatch) {
        const style = document.createElement('style');
        style.textContent = styleMatch[1];
        document.head.appendChild(style);
    }

    // 注入 body 内容
    if (bodyMatch) {
        document.body.innerHTML = bodyMatch[1];
    }

    // 执行内联脚本（跳过含 require 的，它们已在 preload 中加载）
    scriptMatches.forEach(m => {
        const content = m[1];
        if (content.includes('const API = window.wechatAPI') || !content.includes('require')) {
            try {
                const script = document.createElement('script');
                script.textContent = content;
                document.body.appendChild(script);
            } catch (e) {
                console.error('Script execution error:', e);
            }
        }
    });
}

// ========== 插件入口 ==========

window.exports = {
    wechat_plus: {
        mode: 'list',
        args: {
            enter: (action) => {
                window._pluginAction = action;
                if (window.utools && utools.whole) {
                    utools.whole.setExpendHeight(420);
                }
                loadDashboard();
            }
        },
        list: () => [],
        select: () => {}
    },
    wechat_file_path: {
        mode: 'none',
        args: {
            enter: ({ payload }) => {
                utools.hideMainWindow();
                if (payload && payload.length > 0) {
                    try {
                        wechatHelp.saveWechatFilePath(payload[0].path);
                        utools.showNotification('路径设置成功：' + payload[0].path);
                    } catch (e) {
                        utools.showNotification('设置失败：' + e.message);
                    }
                } else {
                    utools.showNotification('请拖拽 xwechat_files 文件夹');
                }
                utools.outPlugin();
            }
        }
    }
};
