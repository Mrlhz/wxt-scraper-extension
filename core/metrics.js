/**
 * 📊 纯 JS 性能大盘与重试日志盘点中心
 */
class MetricsTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.totalRequested = 0;
    this.successCount = 0;
    this.skippedCount = 0;
    this.tokenRefreshed = 0;
    this.cdnSwitched = 0;
    this.failedLogs = new Map(); // filename => { itemId, timestamp, retryAttempts, errors, finalStatus }
  }

  logError(filename, itemId, errorMsg) {
    if (!this.failedLogs.has(filename)) {
      this.failedLogs.set(filename, {
        itemId,
        timestamp: new Date().toLocaleString(),
        retryAttempts: 0,
        errors: [],
        finalStatus: '🔴 正在重试自愈中...'
      });
    }
    const log = this.failedLogs.get(filename);
    log.retryAttempts++;
    log.errors.push(`[第 ${log.retryAttempts} 次尝试失败]: ${errorMsg}`);
  }

  markSuccess(filename) {
    this.successCount++;
    if (this.failedLogs.has(filename)) {
      this.failedLogs.get(filename).finalStatus = '🟢 历经坎坷，最终自愈成功';
    }
  }

  markFinalFailure(filename) {
    if (this.failedLogs.has(filename)) {
      this.failedLogs.get(filename).finalStatus = '🔴 彻底阵亡（所有重试及线上Token均已耗尽）';
    }
  }

  getReport() {
    const logsObject = {};
    this.failedLogs.forEach((value, key) => { logsObject[key] = value; });
    
    return {
      summary: {
        totalRequested: this.totalRequested,
        successCount: this.successCount,
        skippedCount: this.skippedCount,
        tokenRefreshed: this.tokenRefreshed,
        cdnSwitched: this.cdnSwitched
      },
      logs: logsObject
    };
  }
}

export const metrics = new MetricsTracker();
