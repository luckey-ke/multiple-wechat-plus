require('./lib/utoolsHelp');

const {wechatHelp} = require('./lib/wechatHelp');
const {downloadHandle, HANDLE_EXE_PATH} = require("./lib/kill");
const {GoConfigError} = require("./lib/error");
const fs = require("node:fs");

// ========== 工具函数 ==========

function fileToBase64(filePath) {
    return new Promise((resolve) => {
        if (!filePath || !fs.existsSync(filePath)) {
            resolve('./logo.png');
            return;
        }
        fs.readFile(filePath, (err, data) => {
            if (err) return resolve('./logo.png');
            resolve('data:image/png;base64,' + data.toString('base64'));
        });
    });
}

// ========== 数据构建 ==========

async function buildAccountList() {
    const localList = await wechatHelp.getLocalWechatAccountList();
    const list = [];
    for (const data of localList) {
        list.push({
            title: data.name + (data.isLogin ? ' - [在线]' : ' - [离线]'),
            description: data.id,
            icon: await fileToBase64(data.logo),
            id: data.id,
            type: 'account',
            path: data.path,
            accountPath: data.accountPath
        });
    }
    return list;
}

function buildMainList(accountList) {
    return [
        {
            title: '➕ 新建多开',
            description: '启动新微信，登录后点击"保存当前"保存',
            icon: './logo.png',
            type: 'new'
        },
        {
            title: '💾 保存当前登录',
            description: '保存当前已登录的微信账号信息，下次可直接切换',
            icon: './logo.png',
            type: 'save'
        },
        {
            title: '🔄 刷新状态',
            description: '重新检测所有账号的在线状态',
            icon: './logo.png',
            type: 'refresh'
        },
        {
            title: '⚙️ 配置中心',
            description: '下载 handle.exe、设置微信文档路径等',
            icon: './logo.png',
            type: 'config'
        },
        ...accountList
    ];
}

function buildConfigList(status) {
    const items = [
        {
            title: '📥 下载 handle.exe',
            description: status.handleInstalled
                ? '✅ 已安装 - 用于释放文件锁和互斥体'
                : '用于释放文件锁和互斥体，点击下载',
            icon: './logo.png',
            type: 'download'
        },
        {
            title: '📂 设置微信文档路径',
            description: status.pathSet
                ? '✅ 已设置 - 点击可重新选择路径'
                : '微信 4.0+ 默认路径为 xwechat_files 文件夹，点击选择',
            icon: './logo.png',
            type: 'setpath'
        },
        {
            title: 'ℹ️ 使用须知',
            description: '当前只支持 4.0+ 微信版本，低版本请搜索 blowsnow 旧版插件',
            icon: './logo.png',
            type: 'info'
        },
        {
            title: '← 返回我的账号',
            description: '返回账号列表',
            icon: './logo.png',
            type: 'back'
        }
    ];

    if (status.ready) {
        items.unshift({
            title: '✅ 所有配置已完成，可以开始使用了',
            description: '返回账号列表开始管理你的微信账号',
            icon: './logo.png',
            type: 'ready'
        });
    }

    return items;
}

function filterList(list, keyword) {
    if (!keyword) return list;
    return list.filter(item =>
        item.title.toLowerCase().includes(keyword.toLowerCase()) ||
        (item.description && item.description.toLowerCase().includes(keyword.toLowerCase()))
    );
}

// ========== 操作处理 ==========

async function handleNewWx() {
    utools.hideMainWindow();
    try {
        await wechatHelp.startWx(null);
        utools.showNotification('新微信已启动，请扫码登录，登录后点击"保存当前"');
    } catch (e) {
        logger.error("新建多开失败", e);
        utools.showNotification("启动失败：" + e.message);
        if (e instanceof GoConfigError) {
            utools.showNotification("请先在配置中心完成设置");
        }
    }
    utools.outPlugin();
}

async function handleSaveWx() {
    utools.hideMainWindow();
    try {
        let data = await wechatHelp.saveWxData();
        utools.showNotification("保存成功：" + data.name);
    } catch (e) {
        logger.error("保存微信账号失败", e);
        utools.showNotification("保存失败：" + e.message);
    }
    utools.outPlugin();
}

async function handleSwitchAccount(itemData) {
    utools.hideMainWindow();
    try {
        await wechatHelp.startWx(itemData);
        utools.showNotification("已切换到：" + itemData.id);
    } catch (e) {
        logger.error("切换登录失败", e);
        utools.showNotification("切换失败：" + e.message);
        if (e instanceof GoConfigError) {
            utools.showNotification("请先在配置中心完成设置");
        }
    }
    utools.outPlugin();
}

function handleDeleteAccount(itemData) {
    if (!itemData || !itemData.path) return;

    const result = utools.showMessageBox({
        type: 'warning',
        title: '确认删除',
        message: '确定要删除账号 ' + itemData.id + ' 吗？\n此操作不可恢复。',
        buttons: ['取消', '确认删除']
    });

    if (result === 1) {
        try {
            wechatHelp.deleteWechat(itemData);
            utools.showNotification("已删除：" + itemData.id);
        } catch (e) {
            utools.showNotification("删除失败：" + e.message);
        }
    }
}

async function handleDownloadHandle() {
    utools.hideMainWindow();
    if (fs.existsSync(HANDLE_EXE_PATH)) {
        utools.showNotification("handle.exe 已存在，无需重复下载");
    } else {
        try {
            utools.showNotification("正在下载 handle.exe...");
            await downloadHandle();
            utools.showNotification("下载成功！");
        } catch (e) {
            logger.error("下载 handle.exe 失败", e);
            utools.showNotification("下载失败：" + e.message);
        }
    }
    utools.outPlugin();
}

function handleSetPath() {
    utools.hideMainWindow();
    try {
        const {dialog} = require('electron').remote;
        const result = dialog.showOpenDialog({
            title: '选择 xwechat_files 文件夹',
            properties: ['openDirectory'],
            defaultPath: utools.getPath('documents')
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const folderPath = result.filePaths[0];
            wechatHelp.saveWechatFilePath(folderPath);
            utools.showNotification("路径设置成功！");
        }
    } catch (e) {
        logger.error("设置路径失败", e);
        utools.showNotification("设置失败：" + e.message);
    }
    utools.outPlugin();
}

// ========== 主入口 ==========

window.exports = {
    "wechat_plus": {
        mode: "list",
        args: {
            enter: async (action, callbackSetList) => {
                try {
                    const accountList = await buildAccountList();
                    // 保存全部数据用于搜索
                    window._wechatPlusData = {
                        mainList: buildMainList(accountList),
                        accountList: accountList,
                        state: 'main'
                    };
                    callbackSetList(window._wechatPlusData.mainList);
                } catch (e) {
                    logger.error("初始化失败", e);
                    utools.showNotification("加载失败：" + e.message);
                    if (e instanceof GoConfigError) {
                        // 配置未就绪，直接进入配置中心
                        const status = wechatHelp.getConfigStatus();
                        window._wechatPlusData = {
                            mainList: [],
                            accountList: [],
                            state: 'config'
                        };
                        callbackSetList(buildConfigList(status));
                    }
                }
            },

            search: async (action, searchWord, callbackSetList) => {
                const data = window._wechatPlusData;
                if (!data) return;

                if (data.state === 'main') {
                    callbackSetList(filterList(data.mainList, searchWord));
                } else {
                    callbackSetList(filterList(buildConfigList(wechatHelp.getConfigStatus()), searchWord));
                }
            },

            select: async (action, itemData, callbackSetList) => {
                const data = window._wechatPlusData;
                if (!data) return;

                const type = itemData.type;

                // ===== 主页面操作 =====

                if (type === 'new') {
                    await handleNewWx();
                    return;
                }

                if (type === 'save') {
                    await handleSaveWx();
                    return;
                }

                if (type === 'account') {
                    await handleSwitchAccount(itemData);
                    return;
                }

                if (type === 'refresh') {
                    const accountList = await buildAccountList();
                    data.accountList = accountList;
                    data.mainList = buildMainList(accountList);
                    callbackSetList(data.mainList);
                    utools.showNotification("状态已刷新");
                    return;
                }

                // ===== Tab 切换 =====

                if (type === 'config') {
                    data.state = 'config';
                    callbackSetList(buildConfigList(wechatHelp.getConfigStatus()));
                    return;
                }

                if (type === 'back') {
                    data.state = 'main';
                    callbackSetList(data.mainList);
                    return;
                }

                // ===== 配置中心操作 =====

                if (type === 'download') {
                    await handleDownloadHandle();
                    return;
                }

                if (type === 'setpath') {
                    handleSetPath();
                    return;
                }

                if (type === 'info' || type === 'ready') {
                    return;
                }

                // ===== 账号右键菜单（由 uTools list 右键触发） =====

                if (type === 'delete') {
                    handleDeleteAccount(itemData);
                    // 刷新列表
                    const accountList = await buildAccountList();
                    data.accountList = accountList;
                    data.mainList = buildMainList(accountList);
                    if (data.state === 'main') {
                        callbackSetList(data.mainList);
                    }
                    return;
                }
            },

            placeholder: "搜索账号或功能"
        }
    },

    "wechat_file_path": {
        mode: "none",
        args: {
            enter: ({code, type, payload}) => {
                utools.hideMainWindow();

                if (payload && payload.length > 0) {
                    try {
                        wechatHelp.saveWechatFilePath(payload[0].path);
                        utools.showNotification("路径设置成功：" + payload[0].path);
                    } catch (e) {
                        logger.error("拖拽设置路径失败", e);
                        utools.showNotification("设置失败：" + e.message);
                    }
                } else {
                    utools.showNotification("请拖拽 xwechat_files 文件夹");
                }

                utools.outPlugin();
            }
        }
    }
};
