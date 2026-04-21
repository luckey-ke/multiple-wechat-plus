require('./lib/utoolsHelp');

const {wechatHelp} = require('./lib/wechatHelp');
const {downloadHandle, HANDLE_EXE_PATH} = require("./lib/kill");
const {GoConfigError} = require("./lib/error");
const fs = require("node:fs");
const path = require("node:path");

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

/**
 * 构建账号列表，每个账号后面跟排序控制项
 */
async function buildAccountList() {
    const localList = await wechatHelp.getLocalWechatAccountList();
    const total = localList.length;

    // 并行加载图标
    const icons = await Promise.all(localList.map(d => fileToBase64(d.logo)));

    const list = [];
    for (let i = 0; i < total; i++) {
        const data = localList[i];
        const statusIcon = data.isLogin ? '🟢' : '⚪';

        // 账号卡片
        list.push({
            title: data.name,
            description: `${statusIcon} ${data.isLogin ? '在线' : '离线'}  |  ${data.id}`,
            icon: icons[i],
            id: data.id,
            type: 'account',
            path: data.path,
            accountPath: data.accountPath
        });

        // 排序控制项
        list.push({
            title: `${i > 0 ? '  ⬆️ 上移' : ''}${i > 0 && i < total - 1 ? '   ' : ''}${i < total - 1 ? '⬇️ 下移' : ''}`,
            description: `调整「${data.name}」的位置`,
            icon: './logo.png',
            type: 'reorder',
            targetId: data.id,
            canMoveUp: i > 0,
            canMoveDown: i < total - 1
        });
    }

    return list;
}

/**
 * 构建主界面列表（快捷操作 + 账号列表）
 */
function buildMainList(accountList) {
    const items = [
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
    ];

    // 有多个账号时才显示一键启动
    const accountCount = accountList.filter(i => i.type === 'account').length;
    if (accountCount >= 2) {
        items.push({
            title: '🚀 一键启动全部',
            description: `依次启动全部 ${accountCount} 个账号，每次启动后等待你登录`,
            icon: './logo.png',
            type: 'startAll'
        });
    }

    items.push({
        title: '⚙️ 配置中心',
        description: '下载 handle.exe、设置微信文档路径等',
        icon: './logo.png',
        type: 'config'
    });

    return [...items, ...accountList];
}

/**
 * 构建配置中心列表
 */
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

/**
 * 列表搜索过滤
 */
function filterList(list, keyword) {
    if (!keyword) return list;
    const kw = keyword.toLowerCase();
    return list.filter(item =>
        item.title.toLowerCase().includes(kw) ||
        (item.description && item.description.toLowerCase().includes(kw))
    );
}

/**
 * 刷新主列表并保持排序顺序
 */
async function refreshMainList(data) {
    try {
        const accountList = await buildAccountList();
        data.accountList = accountList;
        data.mainList = buildMainList(accountList);
    } catch (e) {
        logger.error("刷新列表失败", e);
        utools.showNotification("刷新失败：" + e.message);
        if (e instanceof GoConfigError) {
            data.state = 'config';
            return buildConfigList(wechatHelp.getConfigStatus());
        }
    }
    return data.mainList;
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
    }
    utools.outPlugin();
}

/**
 * 删除账号（带二次确认）
 * @returns {boolean} 是否实际执行了删除
 */
function handleDeleteAccount(itemData) {
    if (!itemData || !itemData.path) return false;

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
            return true;
        } catch (e) {
            utools.showNotification("删除失败：" + e.message);
        }
    }
    return false;
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

/**
 * 处理排序操作
 */
function handleReorder(itemData) {
    const targetId = itemData.targetId;
    if (!targetId) return;

    if (itemData.canMoveUp && itemData.canMoveDown) {
        // 两个选项都有，弹窗选择
        const result = utools.showMessageBox({
            type: 'question',
            title: '调整位置',
            message: '请选择操作：',
            buttons: ['⬆️ 上移', '⬇️ 下移', '取消']
        });
        if (result === 0) wechatHelp.moveAccountUp(targetId);
        else if (result === 1) wechatHelp.moveAccountDown(targetId);
    } else if (itemData.canMoveUp) {
        // 只能上移
        wechatHelp.moveAccountUp(targetId);
    } else if (itemData.canMoveDown) {
        // 只能下移
        wechatHelp.moveAccountDown(targetId);
    }
}

/**
 * 一键启动全部账号
 * 复用 wechatHelp.startWx() 逻辑，按排序顺序依次启动
 */
async function handleStartAll() {
    let accountList;
    try {
        accountList = await wechatHelp.getLocalWechatAccountList();
    } catch (e) {
        utools.showNotification("获取账号列表失败：" + e.message);
        return;
    }

    if (accountList.length === 0) {
        utools.showNotification("没有已保存的账号");
        return;
    }

    const total = accountList.length;
    const result = utools.showMessageBox({
        type: 'info',
        title: '一键启动',
        message: `即将依次启动全部 ${total} 个账号。\n\n每次启动后请完成登录，然后点击"继续"启动下一个。\n\n注意：每个账号启动前会关闭当前运行的微信。`,
        buttons: ['取消', '开始']
    });

    if (result !== 1) return;

    utools.hideMainWindow();

    try {
        for (let i = 0; i < total; i++) {
            const account = accountList[i];

            // 复用 startWx 的完整逻辑：kill 进程 → 等待 → 复制配置 → 释放互斥体 → 启动
            await wechatHelp.startWx(account);

            // 最后一个账号不弹确认
            if (i < total - 1) {
                const cont = utools.showMessageBox({
                    type: 'info',
                    title: `账号 ${i + 1}/${total}`,
                    message: `「${account.id}」已启动。\n\n请在微信中完成操作后，点击"继续"启动下一个账号。`,
                    buttons: ['结束', '继续启动下一个']
                });

                if (cont !== 1) {
                    utools.showNotification(`已启动 ${i + 1} 个账号`);
                    utools.outPlugin();
                    return;
                }
            }
        }

        utools.showNotification(`全部 ${total} 个账号已启动完毕！`);
    } catch (e) {
        logger.error("一键启动失败", e);
        utools.showNotification("一键启动失败：" + e.message);
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
                    window._wechatPlusData = {
                        mainList: buildMainList(accountList),
                        accountList: accountList,
                        state: 'main'
                    };
                    callbackSetList(window._wechatPlusData.mainList);
                } catch (e) {
                    logger.error("初始化失败", e);
                    utools.showNotification("加载失败：" + e.message);
                    // 配置未就绪，自动进入配置中心
                    const status = wechatHelp.getConfigStatus();
                    window._wechatPlusData = {
                        mainList: [],
                        accountList: [],
                        state: 'config'
                    };
                    callbackSetList(buildConfigList(status));
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
                    callbackSetList(await refreshMainList(data));
                    utools.showNotification("状态已刷新");
                    return;
                }

                if (type === 'startAll') {
                    await handleStartAll();
                    return;
                }

                // ===== 排序控制 =====

                if (type === 'reorder') {
                    handleReorder(itemData);
                    callbackSetList(await refreshMainList(data));
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

                // ===== 账号操作 =====

                if (type === 'delete') {
                    const deleted = handleDeleteAccount(itemData);
                    if (deleted) {
                        callbackSetList(await refreshMainList(data));
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
