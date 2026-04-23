# 微信多开助手 (win-weChat-exe)

基于 Electron 的微信多开免登录工具，从 uTools 插件改造为独立 Windows 桌面应用。

## 原理

通过释放微信的互斥锁 (`XWeChat_App_Instance_Identity_Mutex_Name`) 实现多开，利用 `handle.exe` 管理进程句柄。

## 开发

```bash
# 安装依赖
npm install

# 启动开发模式
npm start

# 打包为 Windows EXE（需要在 Windows 环境执行）
npm run build
```

## 打包

```bash
# 完整安装包（NSIS）
npm run build

# 便携版（免安装）
npm run build:dir
```

输出目录：`dist/`

## 项目结构

```
├── main.js           # Electron 主进程（核心逻辑）
├── preload.js        # 预加载脚本（contextBridge API）
├── src/
│   ├── index.html    # 渲染进程 UI
│   └── logo.png      # 应用图标
├── build/
│   └── icon.png      # 应用图标 256x256（electron-builder 自动转 .ico）
└── package.json
```

## 依赖

- **handle.exe** — Sysinternals Handle，首次使用时自动下载
- **微信** — 需已安装 Windows 版微信

## 注意事项

- 仅支持 Windows（依赖注册表、PowerShell、handle.exe）
- 打包需在 Windows 环境执行 `npm run build`
- `build/icon.png` 已提供，如需自定义可替换同名文件

## 致谢

原始项目：[utools-blowsnow/multiple_wechat](https://github.com/utools-blowsnow/multiple_wechat)

## License

MIT
