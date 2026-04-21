const fs = require("fs");
const pr = require("child_process");
const iconv = require("iconv-lite");
const path = require("node:path");
const {findLatestFile, findLatestFileAll, findDirName} = require("./file");
const {releaseMutex, downloadHandle, killWeixinProcess, isWeixinRunning, HANDLE_EXE_PATH} = require("./kill");
const {GoConfigError} = require("./error");

class WechatHelp {
    constructor() {
        this.wechatDocumentPath = null;
    }

    /**
     * 获取微信文档路径
     * @returns {Promise<string>}
     */
    async #getWechatDocumentPath() {
        let wechatDocumentPath = this.wechatDocumentPath;
        if (wechatDocumentPath && fs.existsSync(wechatDocumentPath)){
            return wechatDocumentPath;
        }

        // 1. 尝试从数据库中获取记录的微信文档目录路径
        wechatDocumentPath = window.dbDevice.getItem("wechatFilePath");
        if (wechatDocumentPath && fs.existsSync(wechatDocumentPath)){
            this.wechatDocumentPath = wechatDocumentPath;
            return wechatDocumentPath;
        }

        // 2. 尝试获取默认微信文档目录路径
        let documents = window.utools.getPath('documents');
        wechatDocumentPath = path.join(documents, "xwechat_files");
        logger.info("尝试默认路径", wechatDocumentPath);
        if (fs.existsSync(wechatDocumentPath)){
            this.wechatDocumentPath = wechatDocumentPath;
            return wechatDocumentPath;
        }

        // 3. 尝试从注册表中获取微信文档目录路径
        wechatDocumentPath = await this.#getRegWechatFilePath();
        logger.info("注册表路径", wechatDocumentPath);
        if (wechatDocumentPath && fs.existsSync(wechatDocumentPath)){
            this.wechatDocumentPath = wechatDocumentPath;
            return wechatDocumentPath;
        }

        throw new GoConfigError("微信文档路径不存在，请在配置中心设置");
    }

    /**
     * 保存微信文档路径
     * @param {string} tmpWechatDocumentPath
     */
    saveWechatFilePath(tmpWechatDocumentPath){
        let dataPath = path.join(tmpWechatDocumentPath, "all_users", "config", "global_config");
        if (!fs.existsSync(dataPath)){
            throw new Error("微信文档路径不正确，未找到 all_users/config/global_config");
        }

        this.wechatDocumentPath = tmpWechatDocumentPath;
        window.dbDevice.setItem("wechatFilePath", tmpWechatDocumentPath);
    }

    /**
     * 检查配置是否就绪
     * @returns {{ ready: boolean, handleInstalled: boolean, pathSet: boolean }}
     */
    getConfigStatus(){
        const handleInstalled = fs.existsSync(HANDLE_EXE_PATH);
        let pathSet = false;
        try {
            const savedPath = window.dbDevice.getItem("wechatFilePath");
            if (savedPath && fs.existsSync(savedPath)){
                const dataPath = path.join(savedPath, "all_users", "config", "global_config");
                pathSet = fs.existsSync(dataPath);
            }
        } catch(e) {}
        return {
            ready: handleInstalled && pathSet,
            handleInstalled,
            pathSet
        };
    }

    /**
     * 从注册表中获取微信文档路径
     * @returns {Promise<string|null>}
     */
    #getRegWechatFilePath(){
        const CODE_PAGE = {
            '936': 'gbk',
            '65001': 'utf-8'
        };

        return new Promise((resolve, reject) => {
            pr.exec('chcp', function (chcpErr, _stdout, _stderr){
                if (chcpErr) {
                    return reject(chcpErr);
                }
                const page = _stdout.replace(/[^0-9]/ig, "");
                let _encoding = CODE_PAGE[page];

                pr.exec("REG QUERY HKEY_CURRENT_USER\\Software\\Tencent\\WeChat /v FileSavePath",{ encoding: 'buffer'}, function(error, stdout, stderr){
                    if (error) {
                        return reject(error);
                    }
                    let data;
                    if (_encoding === 'utf8'){
                        data = stdout.toString();
                    }else{
                        data = iconv.decode(stdout, "gbk").toString();
                    }
                    logger.info("getRegWechatFilePath", data);
                    let matches = data.match(/[a-zA-Z]*?:.*/);
                    if (matches) return resolve(matches[0]);
                    resolve(null);
                });
            });
        });
    }

    /**
     * 从注册表中获取微信EXE路径
     * @returns {Promise<string|null>}
     */
    #getRegWechatExeFilePath(){
        const CODE_PAGE = {
            '936': 'gbk',
            '65001': 'utf-8'
        };

        return new Promise((resolve, reject) => {
            pr.exec('chcp', function (chcpErr, _stdout, _stderr){
                if (chcpErr) {
                    return reject(chcpErr);
                }
                const page = _stdout.replace(/[^0-9]/ig, "");
                let _encoding = CODE_PAGE[page];

                pr.exec("REG QUERY HKEY_CURRENT_USER\\Software\\Tencent\\Weixin /v InstallPath",{ encoding: 'buffer'}, function(error, stdout, stderr){
                    if (error) {
                        return reject(error);
                    }
                    let data;
                    if (_encoding === 'utf8'){
                        data = stdout.toString();
                    }else{
                        data = iconv.decode(stdout, "gbk").toString();
                    }
                    logger.info("getRegWechatExeFilePath", data);
                    let matches = data.match(/[a-zA-Z]*?:.*/);
                    if (matches) return resolve(matches[0]);
                    resolve(null);
                });
            });
        });
    }

    /**
     * 获取已保存的微信账号列表
     * @returns {Promise<Array>}
     */
    async getLocalWechatAccountList() {
        let wechatFilePath = await this.#getWechatDocumentPath();
        let configDirPath = path.join(wechatFilePath, "all_users", "plugin_save_config");
        let wxList = [];

        if (!fs.existsSync(configDirPath)){
            return wxList;
        }
        let paths = fs.readdirSync(configDirPath);

        logger.info("扫到本地记录的文件列表", paths);

        for (const dir of paths) {
            const wxidPath = path.join(configDirPath, dir);
            const wxidStats = fs.statSync(wxidPath);
            if (!wxidStats.isDirectory()) continue;
            const wxid = path.basename(wxidPath);

            const wxidRealPath = findDirName(wechatFilePath, wxid);

            logger.info("保存wxidRealPath", wxidRealPath, path.join(wxidPath, "logo.png"));

            wxList.push({
                id: wxid,
                logo: path.join(wxidPath, "logo.png"),
                name: wxid,
                path: wxidPath,
                accountPath: wxidRealPath,
                isLogin: wxidRealPath ? this.isAccountLoggedIn(wxidRealPath) : false
            });
        }
        return wxList;
    }

    /**
     * 执行 Shell 命令
     * @param {string} cmd
     * @returns {Promise<string>}
     */
    async execShell(cmd){
        return new Promise((resolve, reject) => {
            pr.exec(cmd, { encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    logger.error("执行命令失败", { cmd, error });
                    reject(error);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    /**
     * 启动/切换微信账号
     * @param {object|null} itemData - 账号数据，null 表示新建多开
     * @returns {Promise<void>}
     */
    async startWx(itemData=null) {
        let wechatFilePath = await this.#getWechatDocumentPath();

        // 如果微信正在运行，先终止它
        if (await isWeixinRunning()) {
            logger.info('检测到微信正在运行，先终止进程');
            await killWeixinProcess();
            await new Promise(r => setTimeout(r, 1000));
        }

        if (itemData){
            // 切换到指定账号
            if (!fs.existsSync(itemData.path)){
                throw new Error("微信账号信息不存在");
            }

            const configPath = path.join(wechatFilePath, "all_users", "config", "global_config");
            const crcPath = path.join(wechatFilePath, "all_users", "config", "global_config.crc");

            try {
                fs.rmSync(configPath, { force: true });
                fs.rmSync(crcPath, { force: true });
                fs.copyFileSync(path.join(itemData.path, "global_config"), configPath);
                fs.copyFileSync(path.join(itemData.path, "global_config.crc"), crcPath);
            } catch (e) {
                logger.error("复制 global_config 失败", e?.message);
                throw new Error("无法替换 global_config 文件: " + e.message);
            }
        }else{
            // 新建多开：删除配置让微信以新身份启动
            fs.rmSync(path.join(wechatFilePath, "all_users", "config", "global_config"), { force: true });
            fs.rmSync(path.join(wechatFilePath, "all_users", "config", "global_config.crc"), { force: true });
        }

        logger.info("startWx");

        // 杀掉互斥进程
        await releaseMutex().catch(e => {
            logger.error("杀进程锁失败", { message: e?.message, stack: e?.stack });
        });

        // 获取微信进程路径
        let binPath = await this.#getRegWechatExeFilePath();
        if (!binPath){
            throw new GoConfigError("获取微信EXE路径失败，请检查微信是否已安装");
        }
        binPath = path.join(binPath, "Weixin.exe");
        logger.info("binPath", binPath);
        if (!fs.existsSync(binPath)){
            throw new GoConfigError("微信EXE不存在: " + binPath);
        }

        // 启动微信
        window.utools.shellOpenPath(binPath);
    }

    /**
     * 删除已保存的账号
     * @param {object} itemData
     */
    deleteWechat(itemData) {
        if (!fs.existsSync(itemData.path)){
            throw new Error("微信账号信息不存在");
        }
        fs.rmSync(itemData.path, {recursive: true, force: true});
    }

    /**
     * 保存当前登录的微信数据
     * @returns {Promise<object>}
     */
    async saveWxData(){
        let wechatFilePath = await this.#getWechatDocumentPath();

        // 查找 login 目录下的 key_info.db 文件最后更新时间
        let loginPath = path.join(wechatFilePath, "all_users", "login");
        if (!fs.existsSync(loginPath)){
            throw new Error("微信登录目录不存在，请检查是否已登录/微信文档路径有误");
        }

        const latestPath = findLatestFile(loginPath, "key_info.db-shm");
        if (!latestPath){
            throw new Error("微信登录目录下没有 key_info.db 文件");
        }

        let wxid = path.basename(latestPath);
        if (!wxid){
            throw new Error("获取微信用户数据失败");
        }

        // 备份登录配置
        const wxidPath = path.join(wechatFilePath, "all_users", "plugin_save_config", wxid);
        if (!fs.existsSync(wxidPath)){
            fs.mkdirSync(wxidPath, {recursive: true});
        }

        fs.copyFileSync(
            path.join(wechatFilePath, "all_users", "config", "global_config"),
            path.join(wxidPath, "global_config")
        );
        fs.copyFileSync(
            path.join(wechatFilePath, "all_users", "config", "global_config.crc"),
            path.join(wxidPath, "global_config.crc")
        );

        const lastImgPath = findLatestFileAll(path.join(wechatFilePath, "all_users", "head_imgs", "0"));
        if (lastImgPath){
            fs.copyFileSync(lastImgPath, path.join(wxidPath, "logo.png"));
        }

        // 查找真实的账号目录路径（用于在线状态检测）
        const accountRealPath = findDirName(wechatFilePath, wxid);

        let wxData = {
            id: wxid,
            logo: path.join(wxidPath, "logo.png"),
            name: wxid,
            path: wxidPath,
            accountPath: accountRealPath,
            isLogin: accountRealPath ? this.isAccountLoggedIn(accountRealPath) : false
        };

        // 记录本次登录的微信账号信息
        window.dbDevice.setItem("wx_" + wxData.id, JSON.stringify(wxData));

        return wxData;
    }

    /**
     * 检测账号是否在线
     * @param {string} accountPath - 账号真实目录路径
     * @returns {boolean}
     */
    isAccountLoggedIn(accountPath){
        if (!accountPath) return false;

        const msgFolder = path.join(accountPath, 'db_storage', 'message');
        logger.info(`检查在线状态: ${msgFolder}`);
        if (!fs.existsSync(msgFolder)) {
            logger.info(`目录不存在，跳过`);
            return false;
        }

        let shmCount = 0;
        let walCount = 0;

        try {
            const files = fs.readdirSync(msgFolder);
            for (const file of files) {
                if (file.endsWith('.db-shm')) {
                    shmCount++;
                } else if (file.endsWith('.db-wal')) {
                    walCount++;
                }

                if (shmCount >= 4 && walCount >= 4) {
                    return true;
                }
            }
        } catch(e) {
            logger.error("检测在线状态失败", e);
        }

        return false;
    }
}

let wechatHelp = new WechatHelp();

module.exports = {
    wechatHelp,
};
