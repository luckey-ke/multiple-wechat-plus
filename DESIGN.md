# 微信多开 Plus — v3.0 仪表盘重构

## 一、背景

v2.0 使用 uTools `list` 模式（原生文字列表），存在以下问题：
- **多层级切换**：配置中心和账号列表是两个 Tab，需要来回切换
- **操作割裂**：每次切换账号需点账号 → 弹窗确认 → 隐藏窗口 → 通知 → 退出
- **视觉单一**：纯文字列表，无法直观展示配置状态和账号信息
- **Bug 回归**：`fs.copyFileSync` 偶发 UNKNOWN 错误、切换账号需重新扫码

## 二、重构目标

1. **单页仪表盘**：配置状态、快捷操作、账号列表一屏展示，无需切换
2. **即时启动**：点击启动直接启动，不再弹窗确认
3. **修复核心 Bug**：copyFileSync 兼容性、login 会话目录备份/恢复
4. **保留全部功能**：配置、多开、保存、删除、路径设置、拖拽排序

## 三、界面设计

### 3.1 仪表盘布局

```
┌──────────────────────────────────────────────┐
│  🟢 handle.exe 已安装    🟢 路径已设置        │ ← 配置状态栏
├──────────────────────────────────────────────┤
│  [➕ 新建多开]  [💾 保存当前]  [🔄 刷新]     │ ← 快捷操作栏
├──────────────────────────────────────────────┤
│  👥 我的账号 (2个)                            │
│  ┌──────────────────────────────────────┐    │
│  │ 👤 wxid_001            [🚀 启动] ▲▼ 🗑│    │
│  │    🟢 在线                            │    │
│  ├──────────────────────────────────────┤    │
│  │ 👤 wxid_002            [🚀 启动] ▲▼ 🗑│    │
│  │    ⚪ 离线                            │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

### 3.2 交互说明

| 操作 | 效果 |
|------|------|
| 点击配置栏未就绪项 | 弹窗选择文件夹 / 下载 handle.exe |
| 点击「新建多开」 | 杀进程 → 替换 config → 启动新微信 → 引导扫码 → 保存 |
| 点击「保存当前」 | 扫描登录目录 → 备份 config + login 目录 → 出现在列表 |
| 点击「🚀 启动」 | 杀进程 → 还原 config + login → 启动 → toast 提示，无需确认弹窗 |
| 点击 🗑️ | 二次确认弹窗 → 删除配置目录 + 移除排序 |
| 点击 ▲▼ | 即时调整排序位置，持久化存储 |
| 空账号列表 | 引导文案："点击新建多开扫码登录后点保存当前" |

### 3.3 配置状态

| 状态 | 配置栏显示 |
|------|-----------|
| handle.exe 已安装 + 路径已设置 | 🟢 绿灯，可正常操作 |
| handle.exe 未安装 | 🔴 红灯，点击下载 |
| 路径未设置 | 🔴 红灯，点击选择 / 拖拽文件夹 |
| 配置未就绪时操作账号 | toast 提示 + 自动高亮配置栏 |

## 四、用户操作流程

### 首次使用
```
搜索"微信多开" → 顶部红灯提示未配置 → 点击下载 handle → 点击设置路径
→ 配置完成变绿灯 → 点击「新建多开」 → 扫码登录 → 点击「保存当前」
→ 账号出现在列表中 ✅
```

### 日常使用（最短路径）
```
搜索"微信多开" → 点击账号卡片的「🚀 启动」→ 自动切换登录 ✅
```

### 保存新账号
```
打开插件 → 新建多开 → 扫码登录 → 保存当前 → 出现在列表
```

### 路径设置（双通道）
```
方式1：点击顶部配置栏路径项 → 弹窗选择文件夹
方式2：拖拽 xwechat_files 文件夹到 uTools 搜索框 → 自动保存
```

## 五、代码结构

### 5.1 目录结构
```
multiple-wechat-plus/
├── src/
│   ├── plugin.json          # 2 个 feature（wechat_plus + wechat_file_path）
│   ├── preload.js           # Node.js 层：暴露 window.wechatAPI
│   ├── index.html           # 完整仪表盘 UI（HTML + CSS + JS）
│   ├── logo.png / logo1.png # 图标
│   ├── package.json         # 依赖
│   ├── readme.md            # 使用说明
│   └── lib/
│       ├── wechatHelp.js    # 微信操作核心（含 login 备份/还原）
│       ├── kill.js          # 进程管理 + handle.exe 下载
│       ├── file.js          # 文件工具
│       ├── error.js         # 自定义错误
│       ├── logger.js        # 日志
│       └── utoolsHelp.js    # uTools 存储封装
├── test/
│   ├── test_wechat.js
│   └── test_kill.js
└── DESIGN.md                # 本文档
```

### 5.2 plugin.json

```json
{
  "logo": "logo.png",
  "preload": "preload.js",
  "platform": ["win32"],
  "features": [
    {
      "code": "wechat_plus",
      "explain": "微信多开 Plus - 一个界面管理所有微信账号",
      "cmds": ["微信多开", "wxdk", "多开", "wechat"]
    },
    {
      "code": "wechat_file_path",
      "explain": "设置微信文档目录（拖拽文件夹触发）",
      "cmds": [{ "type": "files", "fileType": "directory", "minLength": 1, "maxLength": 1 }]
    }
  ]
}
```

### 5.3 preload.js 架构

**职责**：Node.js 运行环境，桥接业务逻辑和 UI。

```js
// 暴露给 index.html 的 API
window.wechatAPI = {
    getConfigStatus()           // { ready, handleInstalled, pathSet }
    handleExists()              // boolean
    async startWx(itemData)     // { success, configError?, message }
    async saveWxData()          // { success, data?, message }
    async getAccountList()      // Account[] | null (配置未就绪)
    moveUp(wxid)                // 即时排序
    moveDown(wxid)              // 即时排序
    async deleteAccount(id)     // boolean
    saveWechatFilePath(p)       // 路径校验 + 存储
    async downloadHandle()      // { success, message }
}

// 插件入口
window.exports = {
    wechat_plus:     { mode: 'docview', args: { enter } }  // 仪表盘
    wechat_file_path:{ mode: 'none',    args: { enter } }  // 拖拽触发
}
```

**数据流**：
```
index.html ──onclick──→ window.wechatAPI.* ──→ wechatHelp.js / kill.js ──→ fs / process
                          ↓ 返回结果
index.html ←──重新渲染←── toast 通知
```

### 5.4 index.html 架构

**职责**：完整的仪表盘 UI，通过 `window.wechatAPI` 调用业务逻辑。

- **配置栏**：`renderConfigBar()` — 读取 `getConfigStatus()` 渲染绿/红指示灯
- **账号列表**：`renderAccounts()` — 异步调用 `getAccountList()` 渲染卡片
- **操作函数**：`doNewWx()`、`doLaunch()`、`doSave()`、`doDelete()` 等
- **Toast 通知**：底部浮动提示，替代 utools 原生通知
- **状态管理**：全局 `busy` 标记防止并发启动

### 5.5 wechatHelp.js 核心变更

#### 1. login 会话目录备份/还原（修复免登问题）

**根因**：每次登录生成不同 `device_id`（写入 global_config），会话存储在 `all_users/login/{wxid}/`。切换时只还原 global_config，login 目录残留所有历史会话，导致 device_id 不匹配。

**修复**：
```js
// saveWxData — 新增 login 目录备份
const loginSrcDir = path.join(loginPath, wxid);
const loginBackupDir = path.join(wxidPath, "login_backup");
this.#copyDirSync(loginSrcDir, loginBackupDir);

// startWx — 新增 login 目录还原
const loginBackupDir = path.join(itemData.path, "login_backup");
fs.rmSync(loginDir, { recursive: true, force: true });  // 清空旧会话
fs.mkdirSync(loginDir, { recursive: true });
this.#copyDirSync(loginBackupDir, path.join(loginDir, itemData.id));  // 只还原目标账号
```

#### 2. copyFileSync 兼容性修复（修复 UNKNOWN 错误）

**根因**：Windows 上 `fs.rmSync` 删除文件后，NTFS 文件系统未完全释放句柄，紧接着 `fs.copyFileSync` 写入同路径偶发 `UNKNOWN: unknown error`。

**修复**：
```js
// safeRemove — 删除后轮询确认文件消失
async function safeRemove(filePath) {
    fs.rmSync(filePath, { force: true });
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (!fs.existsSync(filePath)) break;
    }
}

// retryCopyFileSync — copyFileSync 失败自动重试
function retryCopyFileSync(src, dest, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try { fs.copyFileSync(src, dest); return; }
        catch (e) {
            if (i === retries - 1) throw e;
            const start = Date.now();
            while (Date.now() - start < 300) {}  // 同步等待
        }
    }
}
```

#### 3. 递归目录复制

```js
#copyDirSync(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) this.#copyDirSync(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
    }
}
```

## 六、技术细节

### 6.1 docview 模式 vs list 模式

| | list 模式 | docview 模式 |
|---|---|---|
| UI | uTools 原生列表 | 自定义 HTML |
| 交互 | enter/search/select 回调 | onclick → API 调用 |
| 样式 | 无法自定义 | 完全可控（CSS） |
| 复杂度 | 低（纯文字） | 中（需写 HTML/CSS） |
| 本次选择 | ❌ 旧版 | ✅ 新版 |

### 6.2 启动防并发

全局 `busy` 标记：
- 启动中：所有「🚀 启动」按钮显示 spinner + disabled
- 「新建多开」按钮同步 disabled
- 启动完成后自动恢复，刷新在线状态

### 6.3 账号排序持久化

排序数组存储在 `dbDevice`（key: `accountSortOrder`）：
- 新增账号：push 到末尾
- 删除账号：从数组中移除
- 上移/下移：swap 操作
- 渲染时按排序数组重排账号列表

### 6.4 数据迁移兼容

- `plugin_save_config/{wxid}/` 目录结构不变
- `global_config` + `global_config.crc` 格式不变
- 新增 `login_backup/` 子目录（旧版保存的账号无此目录，切换时跳过 login 还原）
- dbDevice key 不变，完全兼容旧版数据

## 七、搜索关键词

| 关键词 | 效果 |
|--------|------|
| 微信多开 | 打开仪表盘 |
| wxdk | 打开仪表盘 |
| 多开 | 打开仪表盘 |
| wechat | 打开仪表盘 |

## 八、兼容性

- **平台**：仅 Windows
- **微信版本**：仅 4.0+
- **uTools 版本**：需支持 `preload.js` 的版本（1.x / 2.x）
- **electron.remote**：路径选择使用 `electron.remote.dialog`，uTools 3.x 已移除 remote，后续需适配

## 九、变更日志

### v3.0 — 仪表盘重构 (2026-04-21)
- **UI**：list 模式 → docview 模式，单页仪表盘
- **交互**：删除确认弹窗，启动直接启动无需确认
- **Bug**：修复 copyFileSync UNKNOWN 错误
- **Bug**：修复切换账号需重新扫码问题（login 目录备份/还原）
- **代码**：preload.js 重写为 API 桥接层，index.html 全新 UI

### v2.0 — 统一界面 (2026-04-21)
- 6 个 feature → 2 个 feature
- list 模式统一入口 + Tab 切换
- 修复 isAccountLoggedIn 路径不一致
- 新增排序、批量启动

### v1.0 — 初始版本
- 6 个分散入口
- 基础多开功能
