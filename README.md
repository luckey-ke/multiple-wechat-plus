# 微信多开助手

基于 Tauri v2 + Rust 的微信多开免登录工具，从 uTools 插件改造为独立 Windows 桌面应用。

> 体积对比：Electron 版 ~80MB → Tauri 版 ~5MB

## 原理

通过释放微信的互斥锁 (`XWeChat_App_Instance_Identity_Mutex_Name`) 实现多开，利用 `handle.exe` 管理进程句柄，替换 `global_config` 配置文件切换账号。

## 功能

- ➕ **新建多开** — 启动新微信实例，支持免登切换
- 💾 **保存当前登录** — 保存已登录账号的配置和头像
- 🔄 **快速切换** — 一键切换已保存的账号，无需重复登录
- 📋 **账号管理** — 排序、搜索、删除已保存的账号
- 📦 **自动下载 handle.exe** — 首次使用自动从 Sysinternals 下载

## 开发

### 环境要求

- [Rust](https://rustup.rs/)（MSVC 工具链）
- [Node.js](https://nodejs.org/) >= 18
- Windows 10/11

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/luckey-ke/multiple-wechat-plus.git
cd multiple-wechat-plus

# 切换到 Tauri 分支
git checkout tauri-migration

# 安装依赖
npm install

# 开发模式（热重载）
npm run tauri:dev

# 打包为 Windows EXE
npm run tauri:build
```

输出目录：`src-tauri/target/release/` 和 `src-tauri/target/release/bundle/`

### 打包产物

| 类型 | 路径 | 说明 |
|------|------|------|
| NSIS 安装包 | `bundle/nsis/微信多开助手_1.0.0_x64-setup.exe` | 完整安装包 |
| 便携版 | `bundle/portable/微信多开助手_1.0.0_x64.exe` | 免安装，直接运行 |

## 项目结构

```
├── src-tauri/                ← Tauri 后端（Rust）
│   ├── Cargo.toml            # Rust 依赖
│   ├── tauri.conf.json       # Tauri 配置
│   ├── build.rs              # 构建脚本
│   ├── icons/
│   │   └── icon.png          # 应用图标
│   └── src/
│       ├── main.rs           # 入口
│       └── lib.rs            # 核心逻辑（Tauri commands）
├── src/
│   └── index.html            # 前端 UI
├── build/
│   ├── icon.png              # 源图标
│   └── icon.svg
├── package.json
├── main.js                   # [旧] Electron 主进程
├── preload.js                # [旧] Electron 预加载脚本
└── README.md
```

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | [Tauri v2](https://tauri.app/) | 轻量级桌面应用框架 |
| 后端 | Rust | 文件操作、注册表查询、进程管理 |
| 前端 | Vanilla HTML/CSS/JS | 无框架依赖，单文件 |
| HTTP | reqwest | 下载 handle.exe |
| ZIP | zip | 解压 Handle.zip |
| 注册表 | winreg | 查询微信安装路径 |
| 对话框 | tauri-plugin-dialog | 选择文件夹 |

## 分支说明

| 分支 | 说明 |
|------|------|
| `main` | 原始 uTools 插件版 |
| `win-weChat-exe` | Electron 独立应用版 |
| `tauri-migration` | **Tauri v2 版（推荐）** |

## 依赖

- **handle.exe** — [Sysinternals Handle](https://learn.microsoft.com/en-us/sysinternals/downloads/handle)，首次使用时自动下载
- **微信** — 需已安装 Windows 版微信

## 注意事项

- 仅支持 Windows（依赖注册表、handle.exe、微信进程管理）
- 打包需在 Windows 环境执行 `npm run tauri:build`
- 首次运行需要下载 handle.exe（约 1MB），需联网

## 致谢

原始项目：[utools-blowsnow/multiple_wechat](https://github.com/utools-blowsnow/multiple_wechat)

## License

MIT
