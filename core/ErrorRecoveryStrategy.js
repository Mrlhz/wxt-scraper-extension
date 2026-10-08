import { metrics } from './metrics.js';

/**
 * 错误恢复策略调度器
 */
/**
 * 错误恢复自愈策略调度器（策略模式：将硬编码的重试决策树抽离）
 */
export class DownloadRecoveryScheduler {
  constructor(engine) {
    this.engine = engine;
  }

  async handleFailure(error, taskOptions, attempt) {
    const { filename, aweme_id, type, urlCandidates, currentUrlIndex, currentFilenameIndex, filenames } = taskOptions;
    
    metrics.logError(filename, aweme_id, error.message);

    // 路径 O：用户主动取消，直接熔断
    if (error.message?.includes('cancelled')) {
      return;
    }

    if (error.message?.includes('Invalid filename') && filenames?.[currentFilenameIndex]) {
      const filename = filenames[currentFilenameIndex];
      const index = currentFilenameIndex + 1;
      return this.engine.dispatchTask({ ...taskOptions, filename, currentFilenameIndex: index }, attempt + 1);
    }

    // 路径 A：换备用 CDN 弹夹
    if (currentUrlIndex + 1 < urlCandidates.length) {
      metrics.cdnSwitched++;
      return this.engine.dispatchTask({ ...taskOptions, currentUrlIndex: currentUrlIndex + 1 }, 1);
    } 

    // 路径 B：触网进行 Token 刷新熔断自愈
    if (type === 'video' && !taskOptions.hasTriedOnlineRefresh) {
      return this.engine.dispatchTask({
        ...taskOptions,
        currentUrlIndex: 0,
        isUrgentRefresh: true,
        hasTriedOnlineRefresh: true
      }, 1);
    } 

    // 路径 C：挂起 5 秒硬重试
    if (attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return this.engine.dispatchTask(taskOptions, attempt + 1);
    }

    // 路径 D：彻底终结，登记负面流水
    metrics.markFinalFailure(filename);
    await this.engine.persister.saveStatus(taskOptions, 'failed');
  }
}
