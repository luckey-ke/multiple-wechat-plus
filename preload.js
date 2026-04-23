/**
 * preload.js — 预加载脚本
 * 通过 contextBridge 向渲染进程暴露安全的 API
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // 配置状态
    getConfigStatus: () => ipcRenderer.invoke('getConfigStatus'),

    // 账号列表
    getWechatList: () => ipcRenderer.invoke('getWechatList'),

    // 设置微信文档路径
    setWechatFilePath: (dirPath) => ipcRenderer.invoke('setWechatFilePath', dirPath),

    // 选择文件夹对话框
    selectDirectory: () => ipcRenderer.invoke('selectDirectory'),

    // 下载 handle.exe
    downloadHandle: () => ipcRenderer.invoke('downloadHandle'),

    // 启动微信
    startWechat: (itemData) => ipcRenderer.invoke('startWechat', itemData),

    // 保存当前登录
    saveWechat: () => ipcRenderer.invoke('saveWechat'),

    // 删除账号
    deleteWechat: (itemData) => ipcRenderer.invoke('deleteWechat', itemData),

    // 排序
    getAccountOrder: () => ipcRenderer.invoke('getAccountOrder'),
    saveAccountOrder: (order) => ipcRenderer.invoke('saveAccountOrder', order),

    // 打开文件夹
    openFolder: (p) => ipcRenderer.invoke('openFolder', p),
});
