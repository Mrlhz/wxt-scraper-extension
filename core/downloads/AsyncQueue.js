/**
 * 适合 Chrome 插件环境的轻量级事件触发器
 */
export class EventEmitter {
  constructor() {
    this._events = new Map();
  }

  on(event, listener) {
    if (!this._events.has(event)) {
      this._events.set(event, []);
    }
    this._events.get(event).push(listener);
    return this;
  }

  off(event, listener) {
    const listeners = this._events.get(event);
    if (!listeners) return this;
    this._events.set(event, listeners.filter(l => l !== listener));
    return this;
  }

  once(event, listener) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  _emit(event, ...args) {
    const listeners = this._events.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(...args);
      } catch (e) {
        console.error(`[EventEmitter] 监听器报错 (${event}):`, e);
      }
    }
  }
}

/**
 * 继承 EventEmitter 的异步并发队列
 */
export class AsyncQueue extends EventEmitter {
  constructor(options = {}) {
    // 必须调用父类构造函数
    super();

    // 最大并发数, 默认并发数为 2
    const rawConcurrency = options.concurrency;
    this.concurrency = (Number.isInteger(rawConcurrency) && rawConcurrency > 0) 
      ? rawConcurrency 
      : 2;
    this.queue = [];                             // 任务队列       
    this.activeCount = 0;                        // 当前正在执行的任务数
    this.isPaused = false;                       // 暂停状态标识                 
    this.activeTasks = new Map();
    this._taskIdCounter = 0;

    // 兼容你旧版的 options.onStatusChange 回调
    if (typeof options.onStatusChange === 'function') {
      this.on('statusChange', options.onStatusChange);
    }
  }

  /**
   * 获取当前队列总数（排队中 + 正在执行）
   */
  get totalCount() {
    return this.queue.length + this.activeTasks.size;
  }

  /**
   * 仿 p-queue 生命周期 1：
   * 当队列中【所有排队任务都被释放并执行完毕】且【正在执行的任务数为 0】时触发的 Promise
   */
  onIdle() {
    if (this.activeCount === 0 && this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => this.once('idle', resolve));
  }

  /**
   * 仿 p-queue 生命周期 2：
   * 当【等待运行的任务队列清空】时触发的 Promise（此时可能还有任务在 active 执行中）
   */
  onEmpty() {
    if (this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => this.once('empty', resolve));
  }

  _notify() {
    const status = {
      activeCount: this.activeCount,
      waitingCount: this.queue.length,
      totalCount: this.totalCount,
      isPaused: this.isPaused
    };
    
    // 触发标准的全局状态事件
    this._emit('statusChange', status);
    this._emit('next', status);

    // 检查是否满足 empty 状态条件（排队队列清空）
    if (this.queue.length === 0) {
      this._emit('empty', status);
    }

    // 检查是否满足 idle 状态条件（完全空闲）
    if (this.activeCount === 0 && this.queue.length === 0) {
      this._emit('idle', status);
    }
  }

  /**
   * 推入新任务到队列中
   */
  push(task, options = {}) {
    const { priority = 0, timeout = 0 } = options;
    return new Promise((resolve, reject) => {
      const item = { task, priority, timeout, resolve, reject };
      
      // 二分法插入排序
      let low = 0;
      let high = this.queue.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (this.queue[mid].priority >= priority) low = mid + 1;
        else high = mid;
      }
      this.queue.splice(low, 0, item);

      this._emit('add');
      this._notify();
      this._next();
    });
  }

  /**
   * 核心调度器
   */
  _next() {
    // ✨ 只有在未暂停且有空闲并发位时才执行任务
    while (!this.isPaused && this.activeCount < this.concurrency && this.queue.length > 0) {
      this.activeCount++;
      const { task, timeout, resolve, reject } = this.queue.shift();

      const controller = new AbortController();
      const { signal } = controller;
      const currentTaskId = ++this._taskIdCounter;

      const taskContext = { signal, controller, onQueuePause: () => {}, onQueueResume: () => {} };
      this.activeTasks.set(currentTaskId, taskContext);
      
      this._emit('active');
      this._notify();

      let timer = null;
      let isSettled = false;

      const safeResolve = (value) => {
        if (isSettled) return;
        isSettled = true;
        if (timer) { clearTimeout(timer); timer = null; }
        resolve(value);
      };
      const safeReject = (err) => {
        if (isSettled) return;
        isSettled = true;
        if (timer) { clearTimeout(timer); timer = null; }
        reject(err);
      };

      const abortHandler = () => { safeReject(new Error('Task was cancelled by user')) };
      signal.addEventListener('abort', abortHandler);

      Promise.resolve()
        .then(() => task(taskContext))
        .then(safeResolve)
        .catch(safeReject)
        .finally(() => {
          if (timer) { clearTimeout(timer); timer = null; }
          signal.removeEventListener('abort', abortHandler);

          taskContext.onQueuePause = null;
          taskContext.onQueueResume = null;

          // ✨ 如果当前任务不在映射表中（说明是被 cancelAll 强杀的）
          // 我们直接跳过计数器的扣减，因为 cancelAll 已经整体重置了计数器，不要重复扣减。
          if (!this.activeTasks.has(currentTaskId)) {
            return;
          }

          this.activeTasks.delete(currentTaskId);
          this.activeCount = Math.max(0, this.activeCount - 1);
          
          this._emit('completed');
          this._notify();
          this._next(); // 驱动下一个任务
        });

      // 超时熔断控制
      if (timeout > 0) {
        timer = setTimeout(() => {
          if (isSettled) return;
          signal.removeEventListener('abort', abortHandler);
          safeReject(new Error(`Task rejected: Timeout after ${timeout}ms`));
          controller.abort();
        }, timeout);
      }
    }
  }

  /**
   * 清空队列并强杀所有执行中任务
   */
  cancelAll() {
    // 1. 清空并拒绝所有排队任务
    while (this.queue.length > 0) {
      const { reject } = this.queue.shift();
      reject(new Error('Queue cleared: Task cancelled before running'));
    }

    // 2. 强杀所有运行中的 Chrome 下载
    this.activeTasks.forEach(taskContext => {
      try {
        taskContext.controller.abort();
      } catch (e) {}
    });

    // 3. 强制重置核心计数器，确保并发池干净
    this.activeTasks.clear();
    this.activeCount = 0;

    this._emit('clear');
    // 4. 同步UI状态
    this._notify();
    
    console.log('🛑 队列已安全清空，并发计数器重置');
  }

  pause() { 
    if (this.isPaused) return;
    this.isPaused = true; 
    this.activeTasks.forEach(t => t.onQueuePause());
    this._emit('pause');
    this._notify(); 
  }
  
  resume() { 
    if (!this.isPaused) return; 
    this.isPaused = false; 
    this.activeTasks.forEach(t => t.onQueueResume());
    this._emit('resume');
    this._notify(); 
    this._next(); 
  }

  setConcurrency(newConcurrency) {
    if (typeof newConcurrency !== 'number' || newConcurrency <= 0) {
      console.warn('Concurrency must be a positive integer');
      return;
    }
    if (newConcurrency === this.concurrency) return; // 无变化
    this.concurrency = newConcurrency;
    if (!this.isPaused) {
      this._notify();
      this._next(); // 调整并发数后尝试执行更多任务
    }
  }
}
