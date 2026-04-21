const fs = require('fs');
const pr = require('child_process');
const iconv = require('iconv-lite');
const path = require('node:path');
const { findLatestFile, findLatestFileAll, findDirName } = require('./file');
const { releaseMutex, releaseFileLock } = require('./kill');
const { GoConfigError } = require('./error');

class WechatHelp {
    constructor() {
        this.wechatDocumentPath = null;
    }

    /**
     * 获取微信文档路径（多级回退）
     */
    async #getWechatDocumentPath() {
        // 1. 内存缓存
        if (this.wechatDocumentPath && fs.existsSync(this.wechatDocumentPath)) {
            return this.wechatDocumentPath;
        }

        // 2. 数据库存储
        let wechatDocumentPath = window.dbDevice.getItem('wechatFilePath');
        if (wechatDocumentPath && fs.existsSync(wechatDocumentPath)) {
            this.wechatDocumentPath = wechatDocumentPath;
            return wechatDocumentPath;
        }

        // 3. 默认路径
        const documents = window.utools.getPath('documents');
        wechatDocumentPath = path.join(documents, 'xwechat_files');
        logger.info('尝试默认路径', wechatDocumentPath);

        if (!fs.existsSync(wechatDocumentPath)) {
            // 4. 注册表
            wechatDocumentPath = await this.#getRegWechatFilePath();
            logger.info('尝试注册表路径', wechatDocumentPath);
        }

        if (!wechatDocumentPath || !fs.existsSync(wechatDocumentPath)) {
            throw new GoConfigError('微信文档路径不存在，请先设置');
        }

        this.wechatDocumentPath = wechatDocumentPath;
        return wechatDocumentPath;
    }

    /**
     * 保存并校验微信文档路径
     */
    saveWechatFilePath(tmpWechatDocumentPath) {
        const dataPath = path.join(tmpWechatDocumentPath, 'all_users', 'config', 'global_config');
        if (!fs.existsSync(dataPath)) {
            throw new Error('微信文档路径不正确：缺少 all_users/config/global_config');
        }
        this.wechatDocumentPath = tmpWechatDocumentPath;
        window.dbDevice.setItem('wechatFilePath', tmpWechatDocumentPath);
    }

    /**
     * 从注册表获取微信文档路径
     */
    #getRegWechatFilePath() {
        return this.#queryRegistry(
            'HKEY_CURRENT_USER\\Software\\Tencent\\WeChat /v FileSavePath'
        );
    }

    /**
     * 从注册表获取微信 EXE 路径
     */
    #getRegWechatExeFilePath() {
        return this.#queryRegistry(
            'HKEY_CURRENT_USER\\Software\\Tencent\\Weixin /v InstallPath'
        );
    }

    /**
     * 统一注册表查询（自动处理编码）
     */
    #queryRegistry(regQuery) {
        const CODE_PAGE = { '936': 'gbk', '65001': 'utf-8' };

        return new Promise((resolve, reject) => {
            pr.exec('chcp', (_err, _stdout) => {
                if (_err) return reject(_err);

                const page = _stdout.replace(/[^0-9]/g, '');
                const encoding = CODE_PAGE[page] || 'gbk';

                pr.exec(`REG QUERY ${regQuery}`, { encoding: 'buffer' }, (error, stdout) => {
                    if (error) return reject(error);

                    const data = encoding === 'utf8'
                        ? stdout.toString()
                        : iconv.decode(stdout, 'gbk').toString();

                    logger.info('注册表查询', regQuery, data);
                    const matches = data.match(/[a-zA-Z]*?:.*/);
                    resolve(matches ? matches[0] : null);
                });
            });
        });
    }

    /**
     * 获取本地已保存的微信账号列表
     */
    async getLocalWechatAccountList() {
        const wechatFilePath = await this.#getWechatDocumentPath();
        const configDirPath = path.join(wechatFilePath, 'all_users', 'plugin_save_config');
        const wxList = [];

        if (!fs.existsSync(configDirPath)) {
            return wxList;
        }

        const entries = fs.readdirSync(configDirPath);
        logger.info('扫描到本地记录', entries);

        for (const entry of entries) {
            const wxidPath = path.join(configDirPath, entry);
            const stats = fs.statSync(wxidPath);
            if (!stats.isDirectory()) continue;

            const wxid = entry;
            const wxidRealPath = findDirName(wechatFilePath, wxid);
            const logoPath = path.join(wxidPath, 'logo.png');

            logger.info('保存账号', { wxidRealPath, logoPath });

            wxList.push({
                id: wxid,
                logo: logoPath,
                name: wxid,
                path: wxidPath,
                accountPath: wxidRealPath,
                isLogin: wxidRealPath ? this.isAccountLoggedIn(wxidRealPath) : false,
            });
        }
        return wxList;
    }

    /**
     * 执行 shell 命令
     */
    execShell(cmd) {
        return new Promise((resolve, reject) => {
            pr.exec(cmd, { encoding: 'utf8' }, (error, stdout) => {
                if (error) {
                    logger.error('执行命令失败', { cmd, error: error.message });
                    return reject(error);
                }
                resolve(stdout.trim());
            });
        });
    }

    /**
     * 启动微信（支持指定账号或新建多开）
     */
    async startWx(itemData = null) {
        const wechatFilePath = await this.#getWechatDocumentPath();

        if (itemData) {
            if (!fs.existsSync(itemData.path)) {
                throw new Error('微信账号信息不存在');
            }

            const configPath = path.join(wechatFilePath, 'all_users', 'config', 'global_config');
            const crcPath = configPath + '.crc';

            // 释放文件锁（不杀进程，只释放 handle）
            let lockReleased = false;
            try {
                await releaseFileLock(configPath);
                lockReleased = true;
                logger.info('成功释放 global_config 文件锁');
            } catch (e) {
                logger.warn('releaseFileLock 失败，尝试 rename 策略', e?.message);
            }

            try {
                await releaseFileLock(crcPath);
            } catch (e) {
                logger.warn('释放 global_config.crc 锁失败', e?.message);
            }

            // 策略1：直接替换（文件锁已释放时）
            if (lockReleased) {
                try {
                    fs.rmSync(configPath, { force: true });
                    fs.rmSync(crcPath, { force: true });
                    fs.copyFileSync(path.join(itemData.path, 'global_config'), configPath);
                    fs.copyFileSync(path.join(itemData.path, 'global_config.crc'), crcPath);
                } catch (e) {
                    logger.error('直接复制失败，尝试 rename 策略', e?.message);
                    lockReleased = false;
                }
            }

            // 策略2：rename 旧文件再复制（Windows 允许 rename 被锁文件）
            if (!lockReleased) {
                try {
                    if (fs.existsSync(configPath)) {
                        fs.renameSync(configPath, configPath + '.bak');
                    }
                    if (fs.existsSync(crcPath)) {
                        fs.renameSync(crcPath, crcPath + '.bak');
                    }
                    fs.copyFileSync(path.join(itemData.path, 'global_config'), configPath);
                    fs.copyFileSync(path.join(itemData.path, 'global_config.crc'), crcPath);
                } catch (e) {
                    logger.error('rename 策略也失败', e?.message);
                    throw new Error('无法替换配置文件，请手动关闭微信后重试: ' + e.message);
                }
            }
        } else {
            // 新建多开：清除配置
            const configPath = path.join(wechatFilePath, 'all_users', 'config', 'global_config');
            fs.rmSync(configPath, { force: true });
            fs.rmSync(configPath + '.crc', { force: true });
        }

        // 释放互斥锁
        try {
            await releaseMutex();
        } catch (e) {
            logger.error('释放互斥锁失败', e?.message);
        }

        // 获取微信 EXE 路径
        let binPath = await this.#getRegWechatExeFilePath();
        binPath = path.join(binPath, 'Weixin.exe');
        logger.info('微信路径', binPath);

        if (!binPath || !fs.existsSync(binPath)) {
            throw new Error('获取微信EXE路径失败，请确认微信已安装');
        }

        window.utools.shellOpenPath(binPath);
        utools.showNotification('登录完成后点击「保存当前登录」');
    }

    /**
     * 删除已保存的账号
     */
    deleteWechat(itemData) {
        if (!fs.existsSync(itemData.path)) {
            throw new Error('微信账号信息不存在');
        }
        fs.rmSync(itemData.path, { recursive: true, force: true });
    }

    /**
     * 保存当前登录的微信数据
     */
    async saveWxData() {
        const wechatFilePath = await this.#getWechatDocumentPath();

        const loginPath = path.join(wechatFilePath, 'all_users', 'login');
        if (!fs.existsSync(loginPath)) {
            throw new Error('微信登录目录不存在，请检查是否已登录');
        }

        const latestPath = findLatestFile(loginPath, 'key_info.db-shm');
        if (!latestPath) {
            throw new Error('未找到 key_info.db 文件，可能未登录微信');
        }

        const wxid = path.basename(latestPath);
        if (!wxid) {
            throw new Error('获取微信用户数据失败');
        }

        // 备份配置
        const wxidPath = path.join(wechatFilePath, 'all_users', 'plugin_save_config', wxid);
        if (!fs.existsSync(wxidPath)) {
            fs.mkdirSync(wxidPath, { recursive: true });
        }

        const configSrc = path.join(wechatFilePath, 'all_users', 'config', 'global_config');
        const crcSrc = configSrc + '.crc';
        if (!fs.existsSync(configSrc)) {
            throw new Error('global_config 文件不存在');
        }

        fs.copyFileSync(configSrc, path.join(wxidPath, 'global_config'));
        fs.copyFileSync(crcSrc, path.join(wxidPath, 'global_config.crc'));

        // 复制最新头像
        const headImgDir = path.join(wechatFilePath, 'all_users', 'head_imgs', '0');
        if (fs.existsSync(headImgDir)) {
            const lastImgPath = findLatestFileAll(headImgDir);
            if (lastImgPath) {
                fs.copyFileSync(lastImgPath, path.join(wxidPath, 'logo.png'));
            }
        }

        const wxData = {
            id: wxid,
            logo: path.join(wxidPath, 'logo.png'),
            name: wxid,
            path: wxidPath,
            isLogin: this.isAccountLoggedIn(path.join(wechatFilePath, wxid)),
        };

        window.dbDevice.setItem('wx_' + wxData.id, JSON.stringify(wxData));
        return wxData;
    }

    /**
     * 检查账号是否在线（通过消息数据库文件判断）
     */
    isAccountLoggedIn(accountPath) {
        const msgFolder = path.join(accountPath, 'db_storage', 'message');
        logger.info('检查登录状态', msgFolder);

        if (!fs.existsSync(msgFolder)) {
            return false;
        }

        let shmCount = 0;
        let walCount = 0;
        const files = fs.readdirSync(msgFolder);

        for (const file of files) {
            if (file.endsWith('.db-shm')) shmCount++;
            else if (file.endsWith('.db-wal')) walCount++;

            if (shmCount >= 4 && walCount >= 4) {
                return true;
            }
        }
        return false;
    }
}

const wechatHelp = new WechatHelp();
module.exports = { wechatHelp };
