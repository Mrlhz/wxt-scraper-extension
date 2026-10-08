import {
  updateItemStatus,
  registerDownloadItem,
  bulkGetRegistryStatusByFiles,
  bulkRegisterDownloadItems,
  bulkUpdateItemStatus,
  batchGetStatuses
} from './db/index.js';
   
/**
 * 数据持久化与日志隔离层（解耦数据库操作，便于测试时进行 Mock）
 */
export class DownloadPersister {
  async saveStatus(task, status, extra = {}) {
    const { platform, item_id, type, fileIndex, filename } = task;
    try {
      const result = await registerDownloadItem({
        platform,
        item_id,
        type,
        index: fileIndex,
        filename,
        status,
        ...extra
      });
      // console.log(`[DexieDB] 状态[${status}]登记成功: item_id=${item_id}, filename=${filename}`);
      return result;
    } catch (err) {
      console.warn(`[DexieDB] 状态[${status}]登记失败: item_id=${item_id}, error=${err.message}`);
    }
  }

  async updateItemCompleted(platform, item_id, filename) {
    try {
      const result = await updateItemStatus(platform, item_id, 'completed', { download_path: filename });
      return result;
    } catch (err) {
      console.warn(`[DexieDB] 更新下载状态失败: item_id=${item_id}, error=${err.message}`);
    }
  }
  /**
   * 针对跳过任务的批量持久化（基于 Dexie 事务 + 双表独立去重 + 精准统计版）
   * @param {Array} skippedTasks 被跳过的任务数组
   * @returns {Promise<{success: boolean, stats: {total: number, registryWritten: number, mediaPoolUpdated: number}}>}
   */
  async batchCompleteSkippedTasks(skippedTasks) {
    const summary = {
      success: false,
      stats: {
        total: skippedTasks ? skippedTasks.length : 0,
        registryWritten: 0,   // 注册表实际写入数
        mediaPoolUpdated: 0    // 主表实际更新数
      }
    };

    if (!skippedTasks || skippedTasks.length === 0) {
      summary.success = true;
      return summary;
    }

    try {
      const filenames = skippedTasks.map(t => t.filename);
      const items = skippedTasks;

      // 1. 开启读写事务（锁定主表和注册表）
      await db.transaction('rw', [db.download_registry, db.captured_resources], async () => {
        
        // 2. 事务内并行批量查询两张表
        const [existingRecords, { results: mediaRecords }] = await Promise.all([
          bulkGetRegistryStatusByFiles(filenames),
          batchGetStatuses(items)
        ]);
        
        // --- 逻辑 A：处理 download_registry 过滤 ---
        // 找出注册表中已经是 completed 的文件
        const completedFiles = new Set(
          existingRecords
            .filter(r => r.status === 'completed')
            .map(r => r.filename)
        );
        // 过滤出：注册表中【还不是 completed】的任务，需要写入注册表
        const trulyNeedUpdateTasks = skippedTasks.filter(t => !completedFiles.has(t.filename));

        // --- 逻辑 B：处理 captured_resources 过滤 ---
        // 找出主表中【状态不为 completed】的记录（核心诉求：查出不为 completed 然后改成 completed）
        const mediaNotCompletedRecords = mediaRecords.filter(r => r.status !== 'completed');
        const mediaNotCompletedIds = new Set(mediaNotCompletedRecords.map(r => r.item_id));
        
        // 过滤出：主表中【还不是 completed】的任务，需要更新主表
        const trulyNeedUpdateMediaTasks = skippedTasks.filter(t => mediaNotCompletedIds.has(t.item_id));


        // 3. 独立组装两张表的更新队列（实现互不干扰、按需更新）
        // 准备 A 表 (download_registry) 的写入数据
        const registryUpdates = trulyNeedUpdateTasks.map(task => ({
          ...task,
          status: 'completed',
          downloadId: ''
        }));

        // 准备 B 表 (captured_resources) 的状态修正数据
        const itemStatusUpdates = trulyNeedUpdateTasks.map(task => ({
          platform: task.platform,
          item_id: task.item_id,
          status: 'completed',
          download_path: task.filename
        }));

        // 核心融合：将主表中状态不为 completed 的任务也同步塞入主表更新队列（去重合并）
        if (trulyNeedUpdateMediaTasks.length > 0) {
          const existingIdsInQueue = new Set(itemStatusUpdates.map(item => item.item_id));

          trulyNeedUpdateMediaTasks.forEach(task => {
            if (!existingIdsInQueue.has(task.item_id)) {
              itemStatusUpdates.push({
                platform: task.platform,
                item_id: task.item_id,
                status: 'completed',
                download_path: task.filename
              });
            }
          });
        }

        // 赋值精确的统计数据
        summary.stats.registryWritten = registryUpdates.length;
        summary.stats.mediaPoolUpdated = itemStatusUpdates.length;

        // 如果两张表都没有实质性修改，直接优雅退出事务
        if (registryUpdates.length === 0 && itemStatusUpdates.length === 0) {
          return;
        }

        console.log(`[DexieDB] [事务中] 开始同步：Registry 待写入 ${registryUpdates.length} 条，MediaPool 待更新 ${itemStatusUpdates.length} 条...`);

        // 4. 动态构建并行执行的 Promise 桶（完美支持单独一张表需要更新的场景）
        const promises = [];
        
        if (registryUpdates.length > 0) {
          promises.push(bulkRegisterDownloadItems(registryUpdates));
        }
        
        if (itemStatusUpdates.length > 0) {
          promises.push(bulkUpdateItemStatus(itemStatusUpdates));
        }

        // 两张表的批量操作在同一个事务生命周期内并行提交
        const results = await Promise.all(promises);
        console.log(`[DexieDB] [事务中] 批量操作完成: Registry 写入 ${results[0] || 0} 条, MediaPool 更新 ${results[1] || 0} 条`, results);
      });

      // 事务无错提交
      summary.success = true;
      console.log(`[DexieDB] ⚡ 事务同步成功！`, summary.stats);
      return summary;

    } catch (err) {
      console.warn('[DexieDB] ❌ 事务执行失败，数据已完全回滚，错误原因:', err);
      summary.success = false;
      return summary;
    }
  }
}
