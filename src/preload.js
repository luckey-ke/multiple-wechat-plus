require('./lib/utoolsHelp');

const { wechatHelp } = require('./lib/wechatHelp');
const { downloadHandle, HANDLE_EXE_PATH } = require('./lib/kill');
const { GoConfigError } = require('./lib/error');
const fs = require('node:fs');

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

// ========== 插件入口 ==========

window.exports = {
    wechat_plus: {
        mode: 'list',
        args: {
            enter: (action) => {
                window._pluginAction = action;
                // 跳转到仪表盘页面，preload 上下文保留
                window.location.href = 'index.html';
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
