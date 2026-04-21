# 微信多开 Plus — v2.0 重构方案

## 一、背景

旧版存在以下问题：
- **6 个分散入口**：配置、快速启动、多开列表、确认登录、删除列表、拖拽路径，需要记不同关键词
- **操作割裂**：每次使用需要在多个界面间来回切换
- **代码维护困难**：6 个 feature 各自独立，`buildWechatList` 逻辑重复，错误处理各写各的
- **多个 bug**：`isAccountLoggedIn` 路径拼接不一致、删除无二次确认、配置中心无状态检测

## 二、重构目标

1. **统一界面**：一个入口，一个界面，完成所有操作
2. **简化交互**：点击账号卡片即可切换账号，无需记忆关键词
3. **保留全部功能**：配置、多开、保存、删除、路径设置（弹窗选择 + 拖拽双通道）
4. **代码架构优化**：清晰分层，统一路由，消除重复逻辑

## 三、界面设计

### 3.1 主界面（我的账号 Tab）

```
┌─────────────────────────────────────────┐
│  🟢 微信多开 Plus                    v2.0 │
├─────────────────────────────────────────┤
│  [ 我的账号 ]    [ 配置中心 ]             │
├─────────────────────────────────────────┤
│                                          │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│  │  ➕   │ │  💾   │ │  🔄   │ │  ⚙️   │   │
│  │新建多开│ │保存当前│ │刷新状态│ │ 设置 │   │
│  └──────┘ └──────┘ └──────┘ └──────┘   │
│                                          │
│  已保存账号                        2 个   │
│  ┌──────────────────────────────────┐   │
│  │ 👤 wxid_8jyu15zfwqs422  🟢在线   │   │ ← 点击 → 切换登录
│  │    wxid_8jyu15zfwqs422           │   │
│  ├──────────────────────────────────┤   │
│  │ 👤 wxid_ug1753bc46ta21  ⚪离线   │   │ ← 点击 → 切换登录
│  │    wxid_ug1753bc46ta21           │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

**快捷操作栏：**

| 按钮 | 功能 | 对应旧版 |
|------|------|----------|
| ➕ 新建多开 | 删除 config，启动新微信，登录后需保存 | `wechat_start` |
| 💾 保存当前 | 保存当前已登录的微信账号信息 | `wechat_save` / `wxok` |
| 🔄 刷新状态 | 重新检测所有账号的在线状态 | —（新增） |
| ⚙️ 设置 | 切换到配置中心 Tab | `config` |

**账号卡片交互：**

| 操作 | 效果 |
|------|------|
| 点击 | 切换登录该账号（kill 旧进程 → 替换 config → 启动） |

### 3.2 配置中心 Tab

```
┌─────────────────────────────────────────┐
│  [ 我的账号 ]    [ 配置中心 ]             │
├─────────────────────────────────────────┤
│                                          │
│  首次使用请完成以下配置：                  │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │ 📥 ① 下载 handle.exe              │   │
│  │    用于释放文件锁和互斥体           │   │
│  │    状态：[ 已安装 ✓ ]  /  [下载]   │   │
│  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │ 📂 ② 设置微信文档路径              │   │
│  │    当前：E:\...\xwechat_files     │   │
│  │    [ 选择文件夹 ] 或 拖拽到搜索框   │   │
│  │    获取方式：微信→账号与存储→      │   │
│  │    存储位置→更改→复制路径         │   │
│  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │ ℹ️  使用须知                       │   │
│  │    • 仅支持微信 4.0+              │   │
│  │    • 低版本请搜索 blowsnow 旧插件  │   │
│  └──────────────────────────────────┘   │
│                                          │
│  ✅ 所有配置完成！可以开始使用了           │
│                                          │
│  ← 返回我的账号                           │
└─────────────────────────────────────────┘
```

- 配置项实时显示状态（✅ 已安装 / 未安装，✅ 已设置 / 未设置）
- 全部配置完成后底部显示绿色提示
- 路径设置支持两种方式：点击按钮弹原生文件夹选择器 / 拖拽文件夹到搜索框
- 底部「返回我的账号」切回主界面

## 四、用户操作流程

### 首次使用
```
搜索"微信多开" → 配置中心 Tab → 下载 handle → 设路径 → 切到"我的账号" → 新建多开 → 扫码 → 保存
```

### 日常使用（最短路径）
```
搜索"微信多开" → 点击账号卡片 → 自动切换登录 ✅
```

### 保存新账号
```
"我的账号"Tab → 新建多开 → 扫码登录 → 点击"保存当前" → 出现在列表中
```

### 路径设置（双通道）
```
方式1：配置中心 → 点击"选择文件夹" → 弹窗选择 → 保存
方式2：拖拽 xwechat_files 文件夹到 uTools 搜索框 → 自动保存
```

## 五、代码结构

### 5.1 目录结构
```
multiple-wechat-plus/
├── src/
│   ├── plugin.json          # 2 个 feature
│   ├── preload.js           # 统一路由 + 操作处理
│   ├── index.html           # 空（uTools list 模式不需要 HTML）
│   ├── logo.png / logo1.png # 图标
│   ├── package.json         # 依赖
│   ├── readme.md            # 使用说明
│   └── lib/
│       ├── wechatHelp.js    # 微信操作核心（已修复 bug）
│       ├── kill.js          # 进程管理（不变）
│       ├── file.js          # 文件工具（不变）
│       ├── error.js         # 自定义错误（不变）
│       ├── logger.js        # 日志（不变）
│       └── utoolsHelp.js    # uTools 存储封装（不变）
├── test/
│   ├── test_wechat.js
│   └── test_kill.js
└── DESIGN.md                # 本文档
```

### 5.2 plugin.json

**旧版：6 个 feature**
```json
"features": [
  { "code": "config" },
  { "code": "wechat_start" },
  { "code": "wechat_list" },
  { "code": "wechat_delete_list" },
  { "code": "wechat_save" },
  { "code": "wechat_file_path" }
]
```

**新版：2 个 feature**
```json
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
```

- `wechat_plus`：搜索触发，主界面入口
- `wechat_file_path`：拖拽文件夹触发，仅支持拖拽，不在搜索列表显示

### 5.3 preload.js 架构

**旧版：6 个 exports 各自独立**
```js
window.exports = {
  "wechat_list":        { mode: "list",  args: { enter, search, select } },
  "wechat_start":       { mode: "none",  args: { enter } },
  "wechat_save":        { mode: "none",  args: { enter } },
  "wechat_delete_list": { mode: "list",  args: { enter, search, select } },
  "wechat_file_path":   { mode: "none",  args: { enter } },
  "config":             { mode: "list",  args: { enter, select } },
}
// 问题：buildWechatList 写了2遍，错误处理各自重复
```

**新版：1 个统一路由 + 1 个辅助出口**
```js
window.exports = {
  "wechat_plus": {
    mode: "list",
    args: {
      enter:  (action, callbackSetList) => { /* 检测配置 + 加载账号 + 渲染 */ },
      search: (action, searchWord, callbackSetList) => { /* 按 state 过滤 */ },
      select: (action, itemData, callbackSetList) => {
        // 按 itemData.type 路由：
        //   "account"   → handleSwitchAccount()  切换登录
        //   "new"       → handleNewWx()           新建多开
        //   "save"      → handleSaveWx()          保存当前
        //   "refresh"   → 刷新账号列表（重新检测在线状态）
        //   "config"    → 切换到配置中心 Tab
        //   "back"      → 返回我的账号 Tab
        //   "download"  → handleDownloadHandle()  下载 handle.exe
        //   "setpath"   → handleSetPath()         弹窗选文件夹
        //   "info"      → 无操作（使用须知）
        //   "ready"     → 无操作（配置完成提示）
        //   "delete"    → handleDeleteAccount()   删除账号（二次确认）
      }
    }
  },
  "wechat_file_path": {
    mode: "none",
    args: {
      enter: ({code, type, payload}) => {
        // 拖拽文件夹触发 → 调 wechatHelp.saveWechatFilePath()
        // 与配置中心"选择文件夹"走同一个保存逻辑
      }
    }
  }
}
```

**Tab 切换原理：** 利用 uTools list 模式的 `callbackSetList`，在 `select` 回调中调用即可替换列表内容而不关闭插件。通过全局状态 `window._wechatPlusData.state`（`'main'` / `'config'`）跟踪当前所在 Tab。

**首次使用引导：** 如果 `getLocalWechatAccountList()` 抛出 `GoConfigError`（路径未配置），自动跳转到配置中心 Tab。

### 5.4 wechatHelp.js 变更

**修复 Bug：`isAccountLoggedIn` 路径不一致**

旧版两处用不同逻辑拼接路径，导致 `saveWxData` 返回的 `isLogin` 可能永远为 `false`：

```js
// 旧版 getLocalWechatAccountList（第 219 行）
isLogin: this.isAccountLoggedIn(wxidRealPath)  // ✅ 用 findDirName 查找

// 旧版 saveWxData（第 273 行）
isLogin: this.isAccountLoggedIn(path.join(wechatFilePath, wxid))  // ❌ 直接拼接
```

新版两处统一使用 `findDirName` 查找真实目录路径，并增加 null 保护：
```js
// 新版两处统一
const accountRealPath = findDirName(wechatFilePath, wxid);
isLogin: accountRealPath ? this.isAccountLoggedIn(accountRealPath) : false
```

**新增方法：`getConfigStatus()`**

```js
getConfigStatus() {
  return {
    ready: handleInstalled && pathSet,
    handleInstalled: fs.existsSync(HANDLE_EXE_PATH),
    pathSet: /* 路径已设置且有效 */
  }
}
```

供配置中心 Tab 实时显示状态。

**修复 Bug：`#getWechatDocumentPath` 未处理 null**

旧版从数据库取出值后直接传给 `fs.existsSync`，如果值为 `null` 会异常。新版增加 `&& fs.existsSync()` 双重检查。

## 六、搜索关键词映射

| 关键词 | 效果 |
|--------|------|
| 微信多开 | 打开主界面 |
| wxdk | 打开主界面 |
| 多开 | 打开主界面 |
| wechat | 打开主界面 |

旧版的 `快速启动登录`、`wxok`、`多开确认`、`删除多开列表`、`微信多开配置` 等关键词不再需要，操作全部在主界面完成。

## 七、兼容性

- **平台**：仅 Windows（与现有版本一致）
- **微信版本**：仅 4.0+（与现有版本一致）
- **uTools 版本**：需要支持 `preload.js` 的版本（1.x / 2.x）
  - ⚠️ `dialog.showOpenDialog` 使用 `electron.remote`，uTools 3.x 已移除 remote，需适配
- **数据迁移**：`plugin_save_config` 目录结构不变，旧版保存的账号数据完全兼容
- **dbDevice 存储**：key 不变（`wechatFilePath_设备ID`、`wx_wxid_xxx_设备ID`）

## 八、迭代计划

### Phase 1：统一界面（✅ 本次完成）
- [x] 新建 plugin.json（2 个 feature）
- [x] 重写 preload.js（统一路由）
- [x] 修复 wechatHelp.js bug（路径不一致、null 处理）
- [x] 新增 getConfigStatus() 方法
- [x] 删除操作加二次确认
- [x] 保留所有 lib/ 核心逻辑
- [x] 更新 readme.md
- [ ] 测试：首次配置、新建多开、切换登录、保存、删除

### Phase 2：体验优化（后续）
- [ ] 账号自定义头像/昵称
- [ ] 拖拽排序
- [ ] `fileToBase64` 改为 Promise.all 并行加载
- [ ] uTools 3.x 兼容（替换 `electron.remote`）
- [ ] 开机自启选项

### Phase 3：高级功能（后续）
- [ ] 批量启动（一键打开全部账号）
- [ ] 登录状态持久化检测
- [ ] 自动保存提醒
