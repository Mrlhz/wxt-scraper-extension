/**
 * 👑 Core Core SDK 统一出口
 */
export { cleanString } from './cleaner.js';
export { generateMediaTasks } from './namer.js';
export { metrics } from './metrics.js';
export { db } from './db/index.js';

// 将所有的核心逻辑包装成统一的集成控制器，交给各框架的 background 驱动
import { DownloadPersister } from './DownloadPersister.js';
import { DownloadRecoveryScheduler } from './ErrorRecoveryStrategy.js';
import { generateMediaTasks } from './namer.js';
import { metrics } from './metrics.js';
import { createDownloadTask } from './downloads/index.js';
import { downloadsLocation, exts } from './globalConfig.js';
import { classifyFilesExistence } from './db/check.js';

export class GrabberCoreEngine {
  constructor(downloadQueueInstance, serverUrl = 'http://localhost:8080/pathExists') {
    this.queue = downloadQueueInstance; // 外部传入之前编写的带自愈的异步并发队列
    this.serverUrl = serverUrl;
    this.downloadRegistry = new Map(); // filename => 'downloading'

    // 初始化解耦的子模块
    this.persister = new DownloadPersister();
    this.recoveryScheduler = new DownloadRecoveryScheduler(this);
  }

  /**
   * 宿主实体硬盘 O(1) 批量深度送检
   */
  async filterExistingFilesByServer(taskList) {
    if (taskList.length === 0) return [];
    try {
      const payload = taskList.map(t => ({
        filename: t.filename,
        downloadsLocation: downloadsLocation,
        exts
      }));

      const res = await fetch(this.serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        const missingFiles = new Set((data.result || []).map(r => r.filename));
        return taskList.filter(t => missingFiles.has(t.filename));
      }
    } catch {
      console.warn('[CoreEngine] 本地检测 Node 服务未启动，自动降级跳过硬盘校验。');
    }
    return taskList;
  }

  /**
   * 核心调度一键批量消费入口
   */
  async executeBatchDownload(items, options) {
    let rawTasks = [];
    let initialSkipped = 0;

    for (const item of items) {
      const tasks = generateMediaTasks(item, options);
      for (const task of tasks) {
        // 第一层与第二层：内存与 Chrome 运行时历史记录去重
        if (this.downloadRegistry.get(task.filename) === 'downloading') {
          initialSkipped++;
          continue;
        }
        rawTasks.push(task);
      }
    }

    metrics.totalRequested += (rawTasks.length + initialSkipped);

    // 第三层：联动策略模式的 server.js 批量物理送检
    // const finalTasks = await this.filterExistingFilesByServer(rawTasks);
    const { exists, notExists } = await classifyFilesExistence(rawTasks);
    // const finalTasks = notExists;
    const finalTasks = await this.filterExistingFilesByServer(notExists);
    console.log(notExists, finalTasks);
    const serverSkipped = rawTasks.length - finalTasks.length;
    
    metrics.skippedCount += (initialSkipped + serverSkipped);

    // 压入重试内核消费
    finalTasks.forEach(task => {
      this.dispatchTask(task);
    });
    console.log(`[CoreEngine] 压入下载队列:`, finalTasks);

    // 2. 🛠️ 精准找出被跳过的任务（改用 filename 作为唯一 Key，修复原有关联 Bug）
    const finalTaskFiles = new Set(finalTasks.map(t => t.filename));
    const skippedTasks = rawTasks.filter(t => !finalTaskFiles.has(t.filename));

    // 3. 🛠️ 优雅调用封装方法，不阻塞主线程异步执行
    this.persister.batchCompleteSkippedTasks(skippedTasks);

    return {
      skipped: initialSkipped + serverSkipped,
      pushed: finalTasks.length
    };
  }

  /**
   * 带动态临门一脚 Token 换新、防双击排队的底层分发引擎
   */
  async dispatchTask(taskOptions, attempt = 1) {
    const { filename, platform, item_id, type, urlCandidates, currentUrlIndex } = taskOptions;
    const currentActiveUrl = urlCandidates[currentUrlIndex];

    try {
      this.downloadRegistry.set(filename, 'downloading');
      await this.persister.saveStatus(taskOptions, 'downloading');

      // 符合 AsyncQueue 标准的任务执行函数封装
      const queueTaskRunner = async (context) => {
        return this._runTaskWithLastMomentCheck(taskOptions, attempt, context);
      };

      // 塞入外部注入的 AsyncQueue 队列中消费
      const res = await this.queue.push(queueTaskRunner, { timeout: 0, priority: taskOptions.priority });
      // console.log(`[CoreEngine] 下载任务完成: item_id=${item_id}, filename=${filename}, result=`, res);
      if (res?.status === 'skipped_at_last_moment') {
        return;
      }
      metrics.markSuccess(filename);

      // 使用 Promise.all 提升 DexieDB 双写性能
      await Promise.all([
        this.persister.updateItemCompleted(platform, item_id, filename),
        this.persister.saveStatus(taskOptions, 'completed', { downloadId: res?.downloadId })
      ]);
    } catch (pushErr) {
      console.warn('[dispatchTask] 分发错误', pushErr, `item_id=${item_id}, filename=${filename},`, attempt);
      // 将复杂的 A/B/C/D 路径彻底委托给错误自愈策略类
      await this.recoveryScheduler.handleFailure(pushErr, taskOptions, attempt);
    } finally {
      this.downloadRegistry.delete(filename);
    }
  }

    /**
   * 内部私有方法：处理出库前最后一毫秒的物理检查与防盗链劫持换新
   * @private
   */
  async _runTaskWithLastMomentCheck(taskOptions, attempt, context) {
    const { filename, item_id, type, urlCandidates, currentUrlIndex, fileIndex, index } = taskOptions;
    let targetUrl = urlCandidates[currentUrlIndex];
    
    // 临门一脚：出库发起 Chrome 下载的最后一毫秒再次检查磁盘（兼容传入整个候选数组）
    const isExist = await checkFileExists(item_id, type, index || fileIndex);
    if (isExist) {
      metrics.skippedCount++;
      return { status: 'skipped_at_last_moment' };
    }

    // 绑定 AsyncQueue 的下载任务函数
    const realDownloadRunner = createDownloadTask({
      url: targetUrl,
      filename: filename,
      conflictAction: taskOptions.conflictAction
    });
  
    return realDownloadRunner(context);
  }
}

/**
 * 检测文件是否已存在于下载注册表中
 * @param {string} itemId - 视频 ID
 * @param {string} type - 类型 (如 'image', 'video')
 * @param {number} index - 序号
 * @returns {Promise<boolean>} - 存在返回 true，不存在返回 false
 */
async function checkFileExists(itemId, type, index) {
  try {
    // 传入联合主键数组，顺序必须与定义一致：[item_id+type+index]
    const record = await db.download_registry.get([itemId, type, index]);
    
    // 如果 record.status 值为completed，说明已存在，返回 true；否则返回 false
    return record && record.status === 'completed';
  } catch (error) {
    console.warn("检测文件是否存在时出错:", error);
    return false;
  }
}

// 调用示例：
// const isExists = await checkFileExists('7499801003446029626', 'image', 1);
// if (isExists) {
//   console.log('文件已存在，跳过下载');
// } else {
//   console.log('文件不存在，开始下载');
// }

/**
 * 检测文件是否已存在（对象传参版）
 * @param {Object} params
 * @param {string} params.itemId
 * @param {string} params.type
 * @param {number} params.index
 * @returns {Promise<boolean>}
 */
async function hasDownloaded({ itemId, type, index }) {
  // 内部严格按照 [item_id, type, index] 顺序组装数组
  const record = await db.download_registry.get([itemId, type, index]);
  return record !== undefined;
}

// 调用示例（不用担心字段顺序传错）：
// const exist = await hasDownloaded({ type: 'image', index: 1, itemId: '7499801003446029626' });
