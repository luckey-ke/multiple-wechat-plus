require('./lib/utoolsHelp');

const { initShared, setWechatFilePath } = require('./lib/shared');
const { wechatHelp } = require('./lib/wechatHelp');
const { downloadHandle } = require('./lib/kill');
const { GoConfigError } = require('./lib/error');
const path = require('path');

// 初始化共享模块
initShared();

// ========== 仪表盘窗口 ==========

let dashboardWin = null;

function openDashboard() {
    if (dashboardWin) {
        try {
            dashboardWin.show();
            return;
        } catch (e) {
            dashboardWin = null;
        }
    }

    const preloadPath = path.join(__dirname, 'dashboard-preload.js');

    dashboardWin = utools.createBrowserWindow(
        'index.html',
        {
            width: 720,
            height: 640,
            minHeight: 400,
            minWidth: 500,
            title: '微信多开仪表盘',
            resizable: true,
            webPreferences: {
                preload: preloadPath,
                nodeIntegration: true,
                contextIsolation: false,
            },
        },
        () => {}
    );

    dashboardWin.on('closed', () => {
        dashboardWin = null;
    });
}

// ========== uTools 入口 ==========

window.exports = {
    dashboard: {
        mode: 'none',
        args: {
            enter: () => {
                utools.hideMainWindow();
                openDashboard();
            },
        },
    },

    wechat_file_path: {
        mode: 'none',
        args: {
            enter: ({ payload }) => {
                utools.hideMainWindow();
                if (payload && payload.length > 0) {
                    try {
                        wechatHelp.saveWechatFilePath(payload[0].path);
                        utools.showNotification('路径保存成功');
                    } catch (e) {
                        utools.showNotification('保存失败: ' + e.message);
                    }
                } else {
                    utools.showNotification('未检测到路径');
                }
                utools.outPlugin();
            },
        },
    },
};
