
/**
 * 将 Promise 包装为 Go 语言风格的双返回值数组
 * @param {Promise} promise 
 * @returns {Promise<[Error, any]>} [err, data] 如果成功 err 为 null，如果失败 data 为 undefined
 */
export function to(promise) {
  return promise
    .then(data => [null, data])
    .catch(err => [err, undefined]);
}

// // 2. 执行队列推送
// const [pushErr, res] = await to(
//   this.queue.push(queueTaskRunner, { timeout: 0, priority: taskOptions.priority })
// );

// // 3. 处理核心错误（如果失败，直接进入错误决策器）
// if (pushErr) {
//   await this.handleTaskFailure(taskOptions, attempt, pushErr);
//   return;
// }

export class AsyncProfiler {
  /**
   * @param {string} name - 分析器名称/标签
   * @param {number} slowThreshold - 慢调用阈值（毫秒），默认 50ms
   */
  constructor(name = 'FunctionProfiler', slowThreshold = 50) {
    this.name = name;
    this.slowThreshold = slowThreshold;
    this.totalCount = 0;
    this.totalTime = 0;
    this.slowCalls = [];
  }

  /**
   * 核心包装方法：使用 Proxy 代理原函数
   * @param {Function} targetFn - 需要被分析的原函数
   * @returns {Function} 包装后的新函数
   */
  wrap(targetFn) {
    const self = this;
    return new Proxy(targetFn, {
      async apply(target, thisArg, argumentsList) {
        self.totalCount++;
        const start = performance.now();

        try {
          // 执行原函数（兼容异步和同步）
          return await Reflect.apply(target, thisArg, argumentsList);
        } finally {
          const end = performance.now();
          const duration = end - start;
          self.totalTime += duration;

          // 捕获慢调用
          if (duration > self.slowThreshold) {
            self.slowCalls.push({
              '耗时 (ms)': parseFloat(duration.toFixed(2)),
              '调用参数': argumentsList.length === 1 ? argumentsList[0] : argumentsList,
              '时间戳': new Date().toLocaleTimeString()
            });
          }
        }
      }
    });
  }

  /**
   * 打印当前统计报告到 Chrome DevTools
   */
  printReport() {
    const avgTime = this.totalCount > 0 ? (this.totalTime / this.totalCount).toFixed(2) : 0;
    
    console.group(`📊 [%c${this.name}%c] 性能统计报告`, 'color: #1a73e8; font-weight: bold;', 'color: inherit;');
    console.log(`总调用次数: %c${this.totalCount}`, 'font-weight: bold;');
    console.log(`平均运行时间: %c${avgTime} ms`, 'color: #1a73e8; font-weight: bold;');
    console.log(`慢调用总数 (> ${this.slowThreshold}ms): %c${this.slowCalls.length}`, this.slowCalls.length > 0 ? 'color: #ea4335; font-weight: bold;' : 'color: #34a853;');
    
    if (this.slowCalls.length > 0) {
      console.log('👇 慢调用详情列表:');
      console.table(this.slowCalls);
    }
    console.groupEnd();
  }

  /**
   * 重置所有统计数据
   */
  reset() {
    this.totalCount = 0;
    this.totalTime = 0;
    this.slowCalls = [];
    console.log(`🔄 [${this.name}] 统计数据已重置`);
  }
}
