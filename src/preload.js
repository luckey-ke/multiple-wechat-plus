require('./lib/utoolsHelp');

const { wechatHelp } = require('./lib/wechatHelp');
const { downloadHandle, HANDLE_EXE_PATH } = require('./lib/kill');
const { GoConfigError } = require('./lib/error');
const fs = require('fs');
const path = require('path');

// ========== RPC 函数：供 index.html 调用 ==========

/**
 * 获取配置状态（handle.exe + 微信路径）
 */
window.getConfigStatus = async () => {
  const handleExists = fs.existsSync(HANDLE_EXE_PATH);
  let handleDate = null;
  if (handleExists) {
    const stat = fs.statSync(HANDLE_EXE_PATH);
    handleDate = new Date(stat.mtimeMs).toISOString().slice(0, 10);
  }

  let filePath = window.dbDevice.getItem('wechatFilePath');
  const defaultPath = path.join(utools.getPath('documents'), 'xwechat_files');
  if (!filePath || !fs.existsSync(filePath)) {
    filePath = fs.existsSync(defaultPath) ? defaultPath : null;
  }

  return {
    handle: { installed: handleExists, date: handleDate, path: HANDLE_EXE_PATH },
    wechatPath: filePath
  };
};

/**
 * 下载 handle.exe
 */
window.rpcDownloadHandle = async () => {
  await downloadHandle();
  return { success: true };
};

/**
 * 获取微信账号列表
 */
window.getWechatList = async () => {
  try {
    return await wechatHelp.getLocalWechatAccountList();
  } catch (e) {
    if (e instanceof GoConfigError) {
      throw new Error('请先完成配置: ' + e.message);
    }
    throw e;
  }
};

/**
 * 启动微信（指定账号或新建多开）
 */
window.startWechat = async (itemData) => {
  try {
    await wechatHelp.startWx(itemData);
  } catch (e) {
    if (e instanceof GoConfigError) {
      throw new Error('请先完成配置: ' + e.message);
    }
    throw e;
  }
};

/**
 * 保存当前登录的微信
 */
window.saveWechat = async () => {
  try {
    return await wechatHelp.saveWxData();
  } catch (e) {
    if (e instanceof GoConfigError) {
      throw new Error('请先完成配置: ' + e.message);
    }
    throw e;
  }
};

/**
 * 删除微信账号
 */
window.deleteWechat = (itemData) => {
  wechatHelp.deleteWechat(itemData);
};

/**
 * 保存微信文档路径
 */
window.saveFilePath = (p) => {
  wechatHelp.saveWechatFilePath(p);
};

/**
 * 用系统文件管理器打开文件夹
 */
window.openFolder = (folderPath) => {
  utools.shellOpenPath(folderPath);
};

/**
 * 获取账号排序
 */
window.getAccountOrder = () => {
  return window.dbDevice.getItem('accountOrder') || [];
};

/**
 * 保存账号排序
 */
window.saveAccountOrder = (order) => {
  window.dbDevice.setItem('accountOrder', order);
};

// ========== uTools 入口 ==========

window.exports = {
  // 主仪表盘入口（所有触发词统一指向这里）
  dashboard: {
    mode: 'docs',
    args: {
      enter: () => {
        // docs 模式自动加载 index.html
      }
    }
  },

  // 文件夹拖入设置路径（uTools files 类型必须独立，无法合并）
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
      }
    }
  }
};
