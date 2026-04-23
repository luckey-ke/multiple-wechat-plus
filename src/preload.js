/**
 * preload.js — 微信多开插件主入口
 * mode: none + 直接操作 DOM 渲染到 uTools 主窗口
 */
require('./lib/utoolsHelp');

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const { exec } = require('child_process');

const {
    initShared,
    getWechatFilePath,
    setWechatFilePath: setWechatFilePathRaw,
    getAccountOrder,
    saveAccountOrder,
} = require('./lib/shared');

const { downloadHandle, releaseFileLock, releaseMutex, HANDLE_EXE_PATH, WECHAT_MUTEX_NAME } = require('./lib/kill');

// ========== 初始化 ==========
initShared();

// ========== 工具函数 ==========

function findDirName(findDir, name) {
    const dirs = fs.readdirSync(findDir);
    for (const dir of dirs) {
        const dirPath = path.join(findDir, dir);
        if (fs.statSync(dirPath).isDirectory() && dir.includes(name)) {
            return dirPath;
        }
    }
    return null;
}

function isAccountLoggedIn(accountPath) {
    const msgFolder = path.join(accountPath, 'db_storage', 'message');
    if (!fs.existsSync(msgFolder)) return false;
    let shmCount = 0;
    let walCount = 0;
    const files = fs.readdirSync(msgFolder);
    for (const file of files) {
        if (file.endsWith('.db-shm')) shmCount++;
        else if (file.endsWith('.db-wal')) walCount++;
        if (shmCount >= 4 && walCount >= 4) return true;
    }
    return false;
}

function getSortedAccounts() {
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) return [];

    const configDirPath = path.join(wechatFilePath, 'all_users', 'plugin_save_config');
    if (!fs.existsSync(configDirPath)) return [];

    const dirs = fs.readdirSync(configDirPath);
    const wxMap = {};

    for (const dir of dirs) {
        const wxidPath = path.join(configDirPath, dir);
        if (!fs.statSync(wxidPath).isDirectory()) continue;
        const wxid = dir;
        const wxidRealPath = findDirName(wechatFilePath, wxid);
        wxMap[wxid] = {
            id: wxid,
            logo: path.join(wxidPath, 'logo.png'),
            name: wxid,
            path: wxidPath,
            accountPath: wxidRealPath,
            isLogin: wxidRealPath ? isAccountLoggedIn(wxidRealPath) : false,
        };
    }

    const order = getAccountOrder();
    const sorted = [];
    for (const id of order) {
        if (wxMap[id]) {
            sorted.push(wxMap[id]);
            delete wxMap[id];
        }
    }
    for (const id of Object.keys(wxMap)) {
        sorted.push(wxMap[id]);
    }

    return sorted;
}

// ========== RPC 函数 ==========

async function getConfigStatus() {
    const handleExists = fs.existsSync(HANDLE_EXE_PATH);
    let handleDate = null;
    if (handleExists) {
        handleDate = new Date(fs.statSync(HANDLE_EXE_PATH).mtimeMs).toISOString().slice(0, 10);
    }
    return {
        handle: { installed: handleExists, date: handleDate, path: HANDLE_EXE_PATH },
        wechatPath: getWechatFilePath(),
    };
}

async function rpcDownloadHandle() {
    return new Promise((resolve, reject) => {
        downloadHandle((pct) => {
            if (window.onDownloadProgress) window.onDownloadProgress(pct);
        }).then(resolve).catch(reject);
    });
}

async function getWechatList() {
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');
    return getSortedAccounts();
}

async function startWechat(itemData) {
    if (!fs.existsSync(HANDLE_EXE_PATH)) {
        throw new Error('handle.exe 不存在，请先下载');
    }

    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');

    if (itemData) {
        if (!fs.existsSync(itemData.path)) throw new Error('微信账号信息不存在');

        const configPath = path.join(wechatFilePath, 'all_users', 'config', 'global_config');
        const crcPath = configPath + '.crc';

        try { await releaseFileLock(configPath); } catch (e) { /* ignore */ }
        try { await releaseFileLock(crcPath); } catch (e) { /* ignore */ }

        let copied = false;
        try {
            if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
            if (fs.existsSync(crcPath)) fs.rmSync(crcPath, { force: true });
            fs.copyFileSync(path.join(itemData.path, 'global_config'), configPath);
            fs.copyFileSync(path.join(itemData.path, 'global_config.crc'), crcPath);
            copied = true;
        } catch (e) { /* fallback */ }

        if (!copied) {
            try {
                if (fs.existsSync(configPath)) fs.renameSync(configPath, configPath + '.bak');
                if (fs.existsSync(crcPath)) fs.renameSync(crcPath, crcPath + '.bak');
                fs.copyFileSync(path.join(itemData.path, 'global_config'), configPath);
                fs.copyFileSync(path.join(itemData.path, 'global_config.crc'), crcPath);
            } catch (e) {
                throw new Error('无法替换配置文件: ' + e.message);
            }
        }
    } else {
        const configPath = path.join(wechatFilePath, 'all_users', 'config', 'global_config');
        fs.rmSync(configPath, { force: true });
        fs.rmSync(configPath + '.crc', { force: true });
    }

    try { await releaseMutex(); } catch (e) { /* no lock is fine */ }

    let binPath = null;
    try {
        binPath = await new Promise((resolve, reject) => {
            exec('REG QUERY HKEY_CURRENT_USER\\Software\\Tencent\\Weixin /v InstallPath', { encoding: 'buffer' }, (err, stdout) => {
                if (err) return reject(err);
                const data = iconv.decode(stdout, 'gbk').toString();
                const matches = data.match(/[a-zA-Z]*?:.*/);
                if (matches) return resolve(matches[0]);
                reject(new Error('注册表无微信路径'));
            });
        });
    } catch (e) {
        throw new Error('获取微信EXE路径失败: ' + e.message);
    }

    binPath = path.join(binPath, 'Weixin.exe');
    if (!fs.existsSync(binPath)) throw new Error('微信EXE不存在: ' + binPath);

    utools.shellOpenPath(binPath);
    utools.showNotification('登录完成后点击「保存当前登录」');
}

async function saveWechat() {
    const wechatFilePath = getWechatFilePath();
    if (!wechatFilePath) throw new Error('请先设置微信文档路径');

    const loginPath = path.join(wechatFilePath, 'all_users', 'login');
    if (!fs.existsSync(loginPath)) throw new Error('微信登录目录不存在');

    let latestTime = 0;
    let latestPath = null;
    for (const dir of fs.readdirSync(loginPath)) {
        const dirPath = path.join(loginPath, dir);
        if (!fs.statSync(dirPath).isDirectory()) continue;
        const shm = path.join(dirPath, 'key_info.db-shm');
        if (fs.existsSync(shm)) {
            const mtime = fs.statSync(shm).mtimeMs;
            if (mtime > latestTime) {
                latestTime = mtime;
                latestPath = dirPath;
            }
        }
    }
    if (!latestPath) throw new Error('未找到 key_info.db');

    const wxid = path.basename(latestPath);
    const wxidPath = path.join(wechatFilePath, 'all_users', 'plugin_save_config', wxid);
    if (!fs.existsSync(wxidPath)) fs.mkdirSync(wxidPath, { recursive: true });

    const configSrc = path.join(wechatFilePath, 'all_users', 'config', 'global_config');
    const crcSrc = configSrc + '.crc';
    if (!fs.existsSync(configSrc)) throw new Error('global_config 不存在');

    fs.copyFileSync(configSrc, path.join(wxidPath, 'global_config'));
    fs.copyFileSync(crcSrc, path.join(wxidPath, 'global_config.crc'));

    const headImgDir = path.join(wechatFilePath, 'all_users', 'head_imgs', '0');
    if (fs.existsSync(headImgDir)) {
        let imgTime = 0, imgPath = null;
        function loopImg(dir) {
            for (const item of fs.readdirSync(dir)) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) loopImg(fullPath);
                else if (stat.isFile() && stat.mtimeMs > imgTime) {
                    imgTime = stat.mtimeMs;
                    imgPath = fullPath;
                }
            }
        }
        loopImg(headImgDir);
        if (imgPath) fs.copyFileSync(imgPath, path.join(wxidPath, 'logo.png'));
    }

    const wxData = {
        id: wxid,
        logo: path.join(wxidPath, 'logo.png'),
        name: wxid,
        path: wxidPath,
        isLogin: isAccountLoggedIn(path.join(wechatFilePath, wxid)),
    };

    window.dbDevice.setItem('wx_' + wxData.id, JSON.stringify(wxData));
    return wxData;
}

function deleteWechat(itemData) {
    if (!fs.existsSync(itemData.path)) throw new Error('微信账号信息不存在');
    fs.rmSync(itemData.path, { recursive: true, force: true });
}

// ========== 仪表盘渲染（直接操作 DOM） ==========

function loadCSS() {
    if (document.getElementById('wx-dashboard-style')) return;
    const style = document.createElement('style');
    style.id = 'wx-dashboard-style';
    style.textContent = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif; background: #f5f6fa; color: #2d3436; padding: 20px; }
      .dashboard { max-width: 680px; margin: 0 auto; }
      h2.section-title { font-size: 14px; font-weight: 600; color: #636e72; margin-bottom: 10px; padding-left: 2px; }
      .config-bar { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
      .config-card { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); display: flex; flex-direction: column; gap: 8px; }
      .config-card .card-label { font-size: 11px; color: #b2bec3; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
      .config-card .card-value { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; min-height: 20px; }
      .config-card .card-path { font-size: 11px; color: #8395a7; word-break: break-all; line-height: 1.4; }
      .config-card .card-actions { display: flex; gap: 8px; margin-top: 4px; }
      .badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
      .badge-ok { background: #e8f8f0; color: #00b894; }
      .badge-warn { background: #fff5e6; color: #e17055; }
      .progress-wrap { width: 100%; height: 6px; background: #f0f2f5; border-radius: 3px; overflow: hidden; margin-top: 6px; display: none; }
      .progress-wrap.show { display: block; }
      .progress-bar { height: 100%; background: linear-gradient(90deg, #0984e3, #74b9ff); border-radius: 3px; width: 0%; transition: width 0.2s; }
      .progress-text { font-size: 10px; color: #636e72; margin-top: 4px; display: none; }
      .progress-text.show { display: block; }
      .action-bar { background: #fff; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); display: flex; gap: 10px; flex-wrap: wrap; }
      .btn { border: none; border-radius: 8px; padding: 8px 16px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; gap: 4px; user-select: none; }
      .btn:active { transform: scale(0.97); }
      .btn-primary { background: #0984e3; color: #fff; }
      .btn-primary:hover { background: #0770c2; }
      .btn-success { background: #00b894; color: #fff; }
      .btn-success:hover { background: #00a381; }
      .btn-ghost { background: #f0f3f5; color: #636e72; }
      .btn-ghost:hover { background: #dfe6e9; }
      .btn-danger { background: #fff0f0; color: #d63031; }
      .btn-danger:hover { background: #ffe0e0; }
      .btn-sm { padding: 5px 10px; font-size: 11px; }
      .account-section { background: #fff; border-radius: 12px; padding: 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
      .account-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
      .account-header h3 { font-size: 15px; font-weight: 600; }
      .account-count { font-size: 11px; color: #b2bec3; background: #f0f3f5; padding: 2px 8px; border-radius: 10px; margin-left: 8px; font-weight: 500; }
      .search-input { border: 1px solid #e0e4e8; border-radius: 8px; padding: 6px 12px 6px 30px; font-size: 12px; width: 200px; outline: none; background: #f8f9fa url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23b2bec3' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E") 10px center no-repeat; transition: border-color 0.15s; }
      .search-input:focus { border-color: #0984e3; background-color: #fff; }
      .account-card { display: flex; align-items: center; padding: 12px 14px; border: 1px solid #f0f2f5; border-radius: 10px; margin-bottom: 8px; transition: all 0.15s; }
      .account-card:last-child { margin-bottom: 0; }
      .account-card:hover { border-color: #dfe6e9; background: #fafbfc; }
      .account-avatar { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; margin-right: 12px; background: #f0f2f5; flex-shrink: 0; }
      .account-info { flex: 1; min-width: 0; }
      .account-name { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
      .account-id { font-size: 11px; color: #b2bec3; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .status-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
      .status-online { background: #00b894; box-shadow: 0 0 4px rgba(0,184,148,0.4); }
      .status-offline { background: #dfe6e9; }
      .status-text { font-size: 10px; font-weight: 600; }
      .status-text.online { color: #00b894; }
      .status-text.offline { color: #b2bec3; }
      .account-actions { display: flex; gap: 5px; flex-shrink: 0; margin-left: 8px; }
      .empty { text-align: center; padding: 48px 20px; color: #b2bec3; }
      .empty-icon { font-size: 40px; margin-bottom: 12px; }
      .empty-title { font-size: 14px; font-weight: 500; color: #636e72; margin-bottom: 6px; }
      .empty-desc { font-size: 12px; line-height: 1.6; }
      .error-banner { background: #fff5f5; border: 1px solid #ffe0e0; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; font-size: 12px; color: #d63031; display: none; }
      .error-banner.show { display: flex; align-items: center; gap: 8px; }
      .toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%) translateY(-80px); background: #2d3436; color: #fff; padding: 10px 22px; border-radius: 10px; font-size: 12px; font-weight: 500; z-index: 999; transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 80%; text-align: center; }
      .toast.show { transform: translateX(-50%) translateY(0); }
      .toast.toast-err { background: #d63031; }
      .loading { text-align: center; padding: 40px; color: #b2bec3; font-size: 13px; }
      .loading::before { content: ''; display: inline-block; width: 16px; height: 16px; border: 2px solid #dfe6e9; border-top-color: #0984e3; border-radius: 50%; animation: spin 0.6s linear infinite; margin-right: 8px; vertical-align: middle; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .account-card.drag-over { border-color: #0984e3; background: #f0f8ff; }
    `;
    document.head.appendChild(style);
}

function renderDashboardHTML() {
    loadCSS();
    document.body.innerHTML = `
      <div class="toast" id="toast"></div>
      <div class="dashboard">
        <div class="error-banner" id="errorBanner">
          <span>⚠️</span>
          <span id="errorText"></span>
        </div>
        <h2 class="section-title">⚙️ 配置状态</h2>
        <div class="config-bar">
          <div class="config-card" id="handleCard">
            <div class="card-label">handle.exe</div>
            <div class="card-value" id="handleStatus"><span class="loading" style="padding:0;font-size:12px"></span></div>
            <div class="card-path" id="handlePath"></div>
            <div class="progress-wrap" id="handleProgress"><div class="progress-bar" id="handleProgressBar"></div></div>
            <div class="progress-text" id="handleProgressText"></div>
            <div class="card-actions" id="handleActions"></div>
          </div>
          <div class="config-card" id="pathCard">
            <div class="card-label">微信文档路径</div>
            <div class="card-value" id="pathStatus"><span class="loading" style="padding:0;font-size:12px"></span></div>
            <div class="card-path" id="pathText"></div>
            <div class="card-actions" id="pathActions"></div>
          </div>
        </div>
        <h2 class="section-title">⚡ 快捷操作</h2>
        <div class="action-bar">
          <button class="btn btn-primary" id="btnNew" onclick="window._wxHandleNew()">➕ 新建多开</button>
          <button class="btn btn-success" id="btnSave" onclick="window._wxHandleSave()">💾 保存当前登录</button>
          <button class="btn btn-ghost" onclick="window._wxLoadDashboard()">🔄 刷新</button>
        </div>
        <div class="account-section">
          <div class="account-header">
            <div>
              <span style="font-size:15px;font-weight:600">👥 微信账号</span>
              <span class="account-count" id="accountCount">0</span>
              <span style="font-size:10px;color:#b2bec3;margin-left:6px">多开免登需要按首次保存顺序启动</span>
            </div>
            <input class="search-input" id="searchInput" placeholder="搜索账号..." oninput="window._wxFilterAccounts(this.value)">
          </div>
          <div id="accountList"><div class="loading">加载中...</div></div>
        </div>
      </div>
    `;
}

// ========== 仪表盘交互逻辑 ==========

let allAccounts = [];
let displayAccounts = [];

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function toast(msg, isError, duration) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' toast-err' : '');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.className = 'toast', duration || 2000);
}

function showError(msg) {
    const el = document.getElementById('errorBanner');
    document.getElementById('errorText').textContent = msg;
    el.classList.add('show');
}
function hideError() {
    document.getElementById('errorBanner').classList.remove('show');
}

function isConfigReady(status) {
    return status.handle.installed && status.wechatPath;
}

async function loadDashboard() {
    hideError();
    try {
        const status = await getConfigStatus();
        renderConfig(status);
        const ready = isConfigReady(status);
        document.getElementById('btnNew').disabled = !ready;
        document.getElementById('btnSave').disabled = !ready;
        document.getElementById('btnNew').style.opacity = ready ? '1' : '0.4';
        document.getElementById('btnSave').style.opacity = ready ? '1' : '0.4';
        document.getElementById('searchInput').disabled = !ready;
        if (ready) {
            try {
                allAccounts = await getWechatList() || [];
                renderAccounts(allAccounts);
            } catch (e) {
                showError('获取账号列表失败: ' + e.message);
                renderAccounts([]);
            }
        } else {
            renderAccounts([]);
        }
    } catch (e) {
        showError('加载失败: ' + e.message);
    }
}

function renderConfig(status) {
    const hStatus = document.getElementById('handleStatus');
    const hPath = document.getElementById('handlePath');
    const hActions = document.getElementById('handleActions');
    if (status.handle.installed) {
        hStatus.innerHTML = '<span class="badge badge-ok">✓ 已安装</span>';
        hPath.textContent = status.handle.path;
        hActions.innerHTML = '<button class="btn btn-ghost btn-sm" onclick="window._wxOpenHandle()">📂 打开</button> <button class="btn btn-ghost btn-sm" onclick="window._wxHandleDownload()">重新下载</button>';
    } else {
        hStatus.innerHTML = '<span class="badge badge-warn">✕ 未安装</span>';
        hPath.textContent = '';
        hActions.innerHTML = '<button class="btn btn-primary btn-sm" onclick="window._wxHandleDownload()">下载 handle.exe</button>';
    }

    const pStatus = document.getElementById('pathStatus');
    const pText = document.getElementById('pathText');
    const pActions = document.getElementById('pathActions');
    if (status.wechatPath) {
        pStatus.innerHTML = '<span class="badge badge-ok">✓ 已设置</span>';
        pText.textContent = status.wechatPath;
        pActions.innerHTML = '<button class="btn btn-ghost btn-sm" onclick="window._wxOpenFolder()">📂 打开</button> <button class="btn btn-ghost btn-sm" onclick="window._wxHandleSetPath()">设置</button>';
    } else {
        pStatus.innerHTML = '<span class="badge badge-warn">✕ 未设置</span>';
        pText.textContent = '';
        pActions.innerHTML = '<button class="btn btn-primary btn-sm" onclick="window._wxHandleSetPath()">设置文件夹</button>';
    }
}

function renderAccounts(accounts) {
    displayAccounts = accounts;
    const container = document.getElementById('accountList');
    document.getElementById('accountCount').textContent = accounts.length + '/' + allAccounts.length;

    if (!accounts.length) {
        const ready = !document.getElementById('btnNew').disabled;
        container.innerHTML = '<div class="empty"><div class="empty-icon">' + (ready ? '📭' : '⚙️') + '</div><div class="empty-title">' + (ready ? '暂无已保存的账号' : '请先完成配置') + '</div><div class="empty-desc">' + (ready ? '点击「新建多开」启动微信，登录后点击「保存当前登录」' : '请下载 handle.exe 并设置微信文档路径') + '</div></div>';
        return;
    }

    const isSearching = !!document.getElementById('searchInput').value.trim();
    container.innerHTML = accounts.map((a, i) => {
        const online = a.isLogin;
        const name = a.name || a.id;
        return '<div class="account-card" ' + (isSearching ? '' : 'draggable="true"') + ' ' + (isSearching ? '' : 'ondragstart="window._wxOnDragStart(event,' + i + ')"') + ' ondragover="event.preventDefault()" ondragenter="this.classList.add(\'drag-over\')" ondragleave="this.classList.remove(\'drag-over\')" ondrop="window._wxOnDrop(event,' + i + ')">' +
            '<img class="account-avatar" src="' + (a.logo || './logo.png') + '" onerror="this.src=\'./logo.png\'" draggable="false">' +
            '<div class="account-info"><div class="account-name">' + escHtml(name) + ' <span class="status-dot ' + (online ? 'status-online' : 'status-offline') + '"></span><span class="status-text ' + (online ? 'online' : 'offline') + '">' + (online ? '在线' : '离线') + '</span></div><div class="account-id">' + escHtml(a.id) + '</div></div>' +
            '<div class="account-actions"><button class="btn btn-primary btn-sm" onclick="window._wxHandleStart(' + i + ')" title="启动此账号">启动</button><button class="btn btn-ghost btn-sm" onclick="window._wxHandleMove(' + i + ',-1)" title="上移" ' + (i === 0 ? 'disabled style="opacity:0.3"' : '') + '>↑</button><button class="btn btn-ghost btn-sm" onclick="window._wxHandleMove(' + i + ',1)" title="下移" ' + (i === accounts.length - 1 ? 'disabled style="opacity:0.3"' : '') + '>↓</button><button class="btn btn-danger btn-sm" onclick="window._wxHandleDelete(' + i + ')" title="删除">🗑</button></div>' +
            '</div>';
    }).join('');
}

// ========== 挂载全局回调（供 onclick 调用） ==========

window._wxLoadDashboard = loadDashboard;
window._wxFilterAccounts = function(kw) {
    const k = kw.trim().toLowerCase();
    if (!k) return renderAccounts(allAccounts);
    renderAccounts(allAccounts.filter(a =>
        (a.name || '').toLowerCase().includes(k) || (a.id || '').toLowerCase().includes(k)
    ));
};

window._wxHandleDownload = async function() {
    const wrap = document.getElementById('handleProgress');
    const bar = document.getElementById('handleProgressBar');
    const text = document.getElementById('handleProgressText');
    wrap.classList.add('show');
    text.classList.add('show');
    bar.style.width = '0%';
    text.textContent = '下载中... 0%';
    window.onDownloadProgress = (pct) => {
        bar.style.width = pct + '%';
        text.textContent = pct >= 100 ? '解压中...' : '下载中... ' + pct + '%';
    };
    try {
        await rpcDownloadHandle();
        text.textContent = '下载完成 ✓';
        toast('下载成功 ✓');
        setTimeout(() => { wrap.classList.remove('show'); text.classList.remove('show'); }, 1500);
        loadDashboard();
    } catch (e) {
        text.textContent = '下载失败';
        toast('下载失败: ' + e.message, true, 3000);
        setTimeout(() => { wrap.classList.remove('show'); text.classList.remove('show'); }, 2000);
    } finally {
        window.onDownloadProgress = null;
    }
};

window._wxOpenHandle = async function() {
    try {
        const status = await getConfigStatus();
        if (status.handle.path) {
            const dir = status.handle.path.substring(0, status.handle.path.lastIndexOf('\\'));
            utools.shellOpenPath(dir);
        }
    } catch (e) { toast('打开失败', true); }
};

window._wxHandleSetPath = function() {
    const result = utools.showOpenDialog({ title: '选择微信文档文件夹 (xwechat_files)', properties: ['openDirectory', 'createDirectory'] });
    if (!result || !result.length) return;
    const ret = setWechatFilePathRaw(result[0]);
    if (ret.success) { toast('路径已更新 ✓'); loadDashboard(); }
    else { toast(ret.message, true, 4000); }
};

window._wxOpenFolder = function() {
    const p = document.getElementById('pathText').textContent;
    if (p) utools.shellOpenPath(p);
};

window._wxHandleNew = async function() {
    try { await startWechat(null); toast('微信已启动，请登录'); }
    catch (e) { toast('启动失败: ' + e.message, true, 3000); }
};

window._wxHandleSave = async function() {
    try { const data = await saveWechat(); toast('保存成功: ' + (data.name || data.id)); loadDashboard(); }
    catch (e) { toast('保存失败: ' + e.message, true, 3000); }
};

window._wxHandleStart = async function(i) {
    try { await startWechat(displayAccounts[i]); toast('已启动'); }
    catch (e) { toast('启动失败: ' + e.message, true, 3000); }
};

window._wxHandleDelete = async function(i) {
    const a = displayAccounts[i];
    const name = a.name || a.id;
    if (!confirm('确定删除「' + name + '」？\n此操作不可恢复。')) return;
    try { deleteWechat(a); toast('已删除'); loadDashboard(); }
    catch (e) { toast('删除失败: ' + e.message, true, 3000); }
};

window._wxHandleMove = function(i, dir) {
    if (document.getElementById('searchInput').value.trim()) { toast('请清除搜索后再排序', false, 1500); return; }
    const j = i + dir;
    if (j < 0 || j >= allAccounts.length) return;
    [allAccounts[i], allAccounts[j]] = [allAccounts[j], allAccounts[i]];
    renderAccounts(allAccounts);
    saveAccountOrder(allAccounts.map(a => a.id));
};

let dragIdx = null;
window._wxOnDragStart = function(e, i) {
    dragIdx = i;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.4';
};
window._wxOnDrop = function(e, targetIdx) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (dragIdx !== null && dragIdx !== targetIdx && !document.getElementById('searchInput').value.trim()) {
        const item = allAccounts.splice(dragIdx, 1)[0];
        allAccounts.splice(targetIdx, 0, item);
        renderAccounts(allAccounts);
        saveAccountOrder(allAccounts.map(a => a.id));
    }
    dragIdx = null;
    document.querySelectorAll('.account-card').forEach(c => c.style.opacity = '1');
};

// ========== uTools 入口 ==========

window.exports = {
    dashboard: {
        mode: 'none',
        args: {
            enter: () => {
                // 不隐藏主窗口，直接渲染仪表盘到当前页面
                utools.setExpendHeight(600);
                renderDashboardHTML();
                loadDashboard();
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
                        setWechatFilePathRaw(payload[0].path);
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
