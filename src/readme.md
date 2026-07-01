# 微信多开 Plus

一个 uTools 插件，用于在 Windows 上实现微信多开、账号管理、防撤回等功能。

## 功能特性

### 微信多开
- 一键启动多个微信实例，互不干扰
- 免登录启动已保存的账号（需按保存顺序）
- 通过杀掉 `_WeChat_App_Instance_Identity_Mutex_Name` 互斥句柄实现

### 账号管理
- 保存登录的微信账号配置
- 自定义昵称和头像
- 拖拽排序、搜索、删除
- 在线状态检测

### 防撤回
- 支持 WeChat 4.0+ 版本（Weixin.dll）
- 静态 DLL 二进制补丁，参考 [RevokeMsgPatcher](https://github.com/huiyadanli/RevokeMsgPatcher)
- 自动备份原 DLL，支持一键恢复
- Program Files 目录写入时自动请求管理员权限
- 状态检测、版本信息显示

## 使用方法

### 首次配置
1. 下载 handle.exe（插件内自动下载）
2. 设置微信文档路径（`xwechat_files` 目录）
3. 启用防撤回（可选）

### 多开操作
- **新建多开**：启动一个新的微信登录窗口
- **保存当前登录**：登录完成后保存账号配置
- **启动**：免登录启动已保存的账号
- **编辑昵称**：点击账号名称编辑，Enter 保存，Escape 取消
- **自定义头像**：点击头像上传，hover 时点击 ✕ 恢复默认

### 防撤回操作
- 点击「防撤回」卡片查看状态
- 启用前需关闭微信（DLL 被占用会失败）
- Program Files 目录会弹 UAC，点击「是」即可
- 支持 WeChat 4.0.0.0 ~ 最新版本

## 技术原理

### 多开原理
通过 `handle.exe` 释放微信进程的互斥锁和文件锁，配合配置文件切换（config-swapping）实现多开。

**已知限制**：只能按保存顺序启动账号实现免登，任意顺序启动会跳到扫码界面。要实现任意顺序多开需要 DLL patching 方案。

### 防撤回原理
对 `Weixin.dll` 进行二进制补丁，修改撤回消息处理逻辑：
- 使用 Boyer-Moore 算法搜索字节模式
- 支持 `0x3F` 通配符（Search 匹配任意字节，Replace 保留原字节）
- 签名数据兼容 RevokeMsgPatcher 的 JSON 格式

**签名维护**：补丁签名在 `src/lib/patches/` 下按版本范围分文件夹，新增版本只需从 RevokeMsgPatcher 的 patch.json 复制对应条目即可，零代码改动。

## 项目结构

```
src/
├── index.html              # 前端 UI
├── preload.js              # 主窗口预加载
├── dashboard-preload.js    # 子窗口预加载
├── plugin.json             # uTools 插件配置
└── lib/
    ├── shared.js           # 共享工具（dbDevice、路径管理）
    ├── wechatService.js    # 微信多开核心业务
    ├── nickname.js         # 昵称提取与头像管理
    ├── kill.js             # handle.exe 下载与句柄释放
    ├── file.js             # 文件查找工具
    ├── logger.js           # 日志系统
    ├── error.js            # 错误处理
    ├── antiRevoke.js       # 防撤回业务逻辑
    ├── patcher.js          # DLL 补丁引擎
    ├── patchDb.js          # 补丁数据库代理
    └── patches/            # 补丁签名库
        ├── index.js        # 签名加载器
        ├── 4.0.0/patch.json
        ├── 4.0.3/patch.json
        ├── 4.1.0/patch.json
        ├── 4.1.6/patch.json
        ├── 4.1.7/patch.json
        ├── 4.1.7.1/patch.json
        └── 4.1.9/patch.json
```

## 使用平台
- Windows（win32）
- uTools 客户端

## 致谢
- [RevokeMsgPatcher](https://github.com/huiyadanli/RevokeMsgPatcher) — 防撤回签名库
- [SuperWeChatPC](https://github.com/anhkgg/SuperWeChatPC) — 互斥句柄释放方案
- [multiple_wechat](https://github.com/utools-blowsnow/multiple_wechat) — 原始多开项目
