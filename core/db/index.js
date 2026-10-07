// 统一的跨平台 Dexie.js 数据库模块
import Dexie from 'dexie';

// 1. 数据库升级为通用多平台名字
export const db = new Dexie('UniversalGrabberDB');

// 2. 跨平台高度索引化的通用表结构
db.version(3).stores({
  // captured_resources: 统一的跨平台多媒体资源池，存放视频、图片、文章等
  // id: 复合主键 [platform+item_id] 彻底杜绝跨平台主键冲突！
  // platform: 显式建立单字段索引，方便前端按平台切标签页
  captured_resources: [
    '[platform+item_id]',      // 👑 复合主键：平台+单平台内唯一ID
    'platform',                // 单字段索引：'douyin' | 'xhs' | 'blog'
    'item_id',                 // 单字段索引：单平台内唯一ID
    'type',                    // 单字段索引：'video' | 'image' | 'article'
    'status',                  // 单字段索引：'pushed' | 'completed' | 'failed'
    'user_id',                 // 单字段索引
    'create_time',             // 单字段索引
    'scraped_at',              // 单字段索引
    'download_path',           // 单字段索引
    'is_favorite',             // 新增：收藏字段索引（1 表示收藏，0 表示未收藏）
    '[platform+status]',       // 新增复合索引：快速筛选某平台下排队中的任务
    '[platform+create_time]',  // 新增复合索引：按平台+时间线清理缓存
    
    // 专门应对路径 B 各类组合的高性能复合索引
    '[platform+type+is_favorite+scraped_at]',  // 对应：平台 + 类型 + 收藏 + 抓取时间
    '[platform+type+scraped_at]',              // 对应：平台 + 类型 + 抓取时间
    '[platform+is_favorite+scraped_at]',       // 对应：平台 + 收藏 + 抓取时间
    '[platform+scraped_at]',                   // 对应：平台 + 抓取时间（最基础的平台滚动）
    
    // 保留老版本索引（兼容历史逻辑或路径 A）
    '[is_favorite+scraped_at]',
    '[type+is_favorite+scraped_at]',  // 新增复合索引：类型 + 收藏 + 抓取时间倒序（用于收藏夹筛选）
    '[type+scraped_at]',              // 🚀 新增复合索引：用于类型过滤 + 抓取时间倒序（核心！）
    '[type+create_time]',             // 复合索引：按类型+时间筛选/排序
    '[user_id+create_time]',          // 新增复合索引：按作者+时间筛选/排序
    '[status+create_time]',           // 新增复合索引：按状态+时间筛选/排序（用于下载队列排序）
    '[scraped_at+item_id]',           // 🚀 新增：专门应对“什么都不选”时的极致丝滑倒序滚动索引
  ].join(', '),

  // 统一的跨平台源实体（创作者/账号/专栏）档案中心
  // source_entities: 统一的跨平台作者信息池，存放作者ID、昵称、标签、元信息等
  // id: 复合主键 [platform+user_id] 彻底杜绝跨平台主键冲突！
  // platform: 显式建立单字段索引，方便前端按平台切标签页
  source_entities: [
    '[platform+user_id]',           // 👑 复合主键：平台+作者ID
    'platform',
    'user_id',                      // 单字段索引
    'sync_status',                  // 状态索引：'active' | 'paused'
    'tags',                         // 单字段索引
    'last_grab_time',               // 时间索引：用于轮询调度
    'is_favorite',                  // 收藏字段索引（1 表示收藏，0 表示未收藏）
    '[sync_status+last_grab_time]',                             // 🚀 核心新增复合索引：用于状态筛选 + 时间范围/时间排序
    '[is_favorite+last_grab_time]',                             // 🚀 核心新增复合索引：用于收藏筛选 + 时间排序
    '[sync_status+is_favorite+last_grab_time]',                 // 🚀 如果存在三个条件联合查询（按需，通常前两个足够）
  ].join(', '),
  // 
  download_registry: [
    '[item_id+type+index]',     // 联合主键：视频ID + 类型 + 序号
    'item_id',                  // 单字段索引：方便按视频 ID 一键反查关联的几十张图片/视频路径
    'download_id',              // 索引：通过 Chrome 下载 ID 反查
    'filename',                 // 索引：纯文件名（如: XXXXX_7499801003446029626-1.webp）
    'status'                    // 索引
  ].join(', ')
});

// 检测环境并挂载到全局，方便控制台调试
if (typeof window !== 'undefined') {
  window.db = db; // 适用于 Popup、Sidepanel、Options 页面
  window.Dexie = Dexie; // 方便在控制台直接使用 Dexie API
} else if (typeof self !== 'undefined') {
  self.db = db;   // 适用于 Background Service Worker
  self.Dexie = Dexie; // 方便在控制台直接使用 Dexie API
}

/**
 * 🛠️ 配合 CoreEngine 引擎的辅助函数
 */
export async function updateItemStatus(platform, itemId, status, extraData = {}) {
  if (!platform || !itemId) {
    console.log(`[DexieDB] updateItemStatus: 缺少 platform 或 itemId，无法更新状态`);
    return;
  }
  // 👑 必须传入包含 platform 和 itemId 的数组来定位唯一记录
  return db.captured_resources.update([platform, String(itemId)], {
    status,
    ...extraData
  });
}


/**
 * 📝 下载后/下载中登记
 */
export async function registerDownloadItem({
  platform = 'unknown', // 传入平台以作隔离
  item_id,
  type = 'video',
  index = 0,
  download_id,
  filename,
  local_path = '',
  status = 'downloading'
}) {
  if (!item_id) return;
  
  const result = await db.download_registry.put({
    platform,
    item_id: String(item_id),
    type,
    index,
    download_id,
    filename,
    local_path,
    status,
    update_time: Date.now()
  });

  return result;
}

/**
 * 🔍 批量获取指定文件的当前登记状态（完美命中 filename 索引）
 * @param {Array<string>} filenames 文件名数组
 */
export async function bulkGetRegistryStatusByFiles(filenames) {
  if (!filenames || filenames.length === 0) return [];
  // 命中 'filename' 索引，百万级数据下依然是毫秒级响应
  return await db.download_registry
    .where('filename')
    .anyOf(filenames)
    .toArray();
}

/**
 * 🚀 批量下载后/下载中登记（高性能批量 put 写入 download_registry）
 * @param {Array} items 包含各个任务参数的数组
 */
/**
 * 🚀 批量下载后/下载中登记
 * @param {Array} items 包含各个任务参数的数组
 */
export async function bulkRegisterDownloadItems(items) {
  if (!items || items.length === 0) return [];
  
  const now = Date.now();
  const records = items.map(item => ({
    platform: item.platform || 'unknown',
    item_id: String(item.item_id),
    type: item.type || 'video',
    index: item.fileIndex ?? item.index ?? 0,
    download_id: item.downloadId ?? item.download_id ?? '',
    filename: item.filename,
    local_path: item.local_path || '',
    status: item.status || 'downloading',
    update_time: now
  })).filter(r => r.item_id); // 🛡️ 防御过滤

  // 使用 Dexie 官方 bulkPut，合并为一个原子事务
  return await db.download_registry.bulkPut(records);
}

/**
 * 🚀 批量更新作品状态主表（对应 captured_resources 表）
 * @param {Array} updates 包含 { item_id, status, download_path } 的数组
 */
/**
 * 🚀 批量更新作品状态主表（对应 captured_resources 表）
 * @param {Array} updates 包含 { platform, item_id, status, download_path } 的数组
 */
export async function bulkUpdateItemStatus(updates) {
  if (!updates || updates.length === 0) return;

  return await db.transaction('rw', db.captured_resources, async () => {
    const promises = updates.map(item => {
      const platform = item.platform || 'unknown';
      const itemId = String(item.item_id);

      // 👑 复合主键更新：update([platform, item_id], { ... })
      return db.captured_resources.update([platform, itemId], {
        status: item.status,
        download_path: item.download_path,
        // 这里可以加上更新时间字段
        scraped_at: Date.now() 
      }).catch(err => {
        console.warn(`[DexieDB] 事务内单条更新 captured_resources 失败: platform=${platform}, item_id=${itemId}`, err);
      });
    });
    
    await Promise.all(promises);
  });
}

/**
 * 根据视频 ID 列表批量获取对应的状态
 * @param awemeIds 视频 ID 数组
 * @returns 返回一个键值对对象，Key 为 item_id，Value 为 status
 */
/**
 * 根据作品列表批量获取对应的状态
 * @param {Array<{platform: string, item_id: string}>} items 带有平台和ID的对象数组
 * @returns 返回一个键值对对象，Key 为 platform_itemid，Value 为 status
 */
export async function batchGetStatuses(items = []) {
  if (!items || items.length === 0) return { statusMap: {}, count: 0, results: [] };

  // 1. 构造复合主键的二维查询数组 [[platform1, item_id1], [platform2, item_id2]]
  const compositeKeys = items.map(item => [
    item.platform || 'unknown', 
    String(item.item_id || item.aweme_id || '')
  ]).filter(key => key[1]); // 过滤没有 ID 的项

  // 2. 利用复合主键的 bulkGet 批量闪电获取，性能直接拉满
  const records = await db.captured_resources.bulkGet(compositeKeys);
  
  // 过滤掉库里不存在的 undefined 记录
  const validRecords = records.filter(r => r);

  // 3. 将结果组装为键值对联合 Map 结构，Key 采用 'platform_itemid'
  const statusMap = {};
  validRecords.forEach(item => {
    if (item.platform && item.item_id && item.status) {
      statusMap[`${item.platform}_${item.item_id}`] = item.status;
    }
  });

  return { 
    statusMap, 
    count: validRecords.length, 
    results: validRecords 
  };
}
