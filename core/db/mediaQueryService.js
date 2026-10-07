import Dexie from 'dexie';
import { db } from './index.js'; // db 实例

/**
 * 核心查询引擎：负责从通用多平台 IndexedDB 检索原始切片数据与总数
 * @param {Object} filters - 过滤条件 { platform, keyword, type, is_favorite }
 * @param {Object} pagination - 分页条件 { page, limit }
 * @returns {Promise<{ items: Array, total: number, metrics: Object }>}
 */
export const executeMediaPoolQuery = async (filters, pagination) => {
  const metrics = {
    totalCountTime: 0,
    dataFetchTime: 0,
    memorySearchTime: 0,
    strategy: ''
  };

  // 1. 基础参数与新字段适配提取
  const targetPlatform = filters.platform || 'xiaohongshu'; // 必须传入当前切签的平台
  const query = filters.keyword ? filters.keyword.trim() : '';
  const startOffset = (pagination.page - 1) * pagination.limit;
  const hasFavFilter = filters.is_favorite === 0 || filters.is_favorite === 1;
  const favVal = filters.is_favorite;
  const typeVal = filters.type;

  // 健壮性防错
  if (!targetPlatform) {
    return { items: [], total: 0, metrics: { ...metrics, strategy: 'Empty_Platform_Fallback' } };
  }

  // ==========================================
  // 路径 A：存在关键字模糊搜索
  // ==========================================
  if (query) {
    const tSearchStart = performance.now();

    // 1. 特快通道：纯数字/字母组合的唯一 ID
    if (/^[a-zA-Z0-9_\-]+$/.test(query)) {
      metrics.strategy = 'Universal_ID_Index_Hit';
      
      const [directItem, userItems] = await Promise.all([
        db.captured_resources.get([targetPlatform, query]),
        db.captured_resources.where('user_id').equals(query).toArray()
      ]);

      const itemMap = new Map();
      if (directItem) itemMap.set(directItem.item_id, directItem);
      
      if (userItems.length > 0) {
        userItems
          .filter(item => item.platform === targetPlatform)
          .forEach(item => itemMap.set(item.item_id, item));
      }
      
      let matchedItems = Array.from(itemMap.values());

      // 附加过滤：类型与收藏
      if (typeVal || hasFavFilter) {
        matchedItems = matchedItems.filter(item => {
          const matchType = !typeVal || item.type === typeVal;
          const matchFav = !hasFavFilter || item.is_favorite === favVal;
          return matchType && matchFav;
        });
      }

      // 如果精确定位到了数据，直接在内存中完成排序与分页并返回
      if (matchedItems.length > 0) {
        // 如果需要按抓取时间倒序，可以在这里加一个轻量级的内存排序
        matchedItems.sort((a, b) => (b.scraped_at || 0) - (a.scraped_at || 0));
        const currentPageItems = matchedItems.slice(startOffset, startOffset + pagination.limit);
        metrics.memorySearchTime = performance.now() - tSearchStart;
        
        return {
          items: currentPageItems,
          total: matchedItems.length,
          metrics
        };
      }
    }

    // 2. 常规模糊搜索：利用 V2 全新平台前缀复合索引，极大缩减初始扫描量
    metrics.strategy = 'Universal_Scan_With_V2_Platform_Index';
    let queryCollection;
    
    // 💡 优化：模糊搜索的起始游标也利用 v2 索引锁定平台，速度提升数倍
    if (typeVal && hasFavFilter) {
      queryCollection = db.captured_resources.where('[platform+type+is_favorite+scraped_at]')
        .between([targetPlatform, typeVal, favVal, Dexie.minKey], [targetPlatform, typeVal, favVal, Dexie.maxKey]);
    } else if (typeVal) {
      queryCollection = db.captured_resources.where('[platform+type+scraped_at]')
        .between([targetPlatform, typeVal, Dexie.minKey], [targetPlatform, typeVal, Dexie.maxKey]);
    } else if (hasFavFilter) {
      queryCollection = db.captured_resources.where('[platform+is_favorite+scraped_at]')
        .between([targetPlatform, favVal, Dexie.minKey], [targetPlatform, favVal, Dexie.maxKey]);
    } else {
      queryCollection = db.captured_resources.where('[platform+scraped_at]')
        .between([targetPlatform, Dexie.minKey], [targetPlatform, Dexie.maxKey]);
    }

    const queryLower = query.toLowerCase();
    let matchedItems = [];
    let scannedCount = 0;

    // 安全阀：至多扫描单平台前 5000 条最近数据
    await queryCollection.reverse().until(() => scannedCount > 5000).each(item => {
      scannedCount++;
      const matchDesc = (item.desc || item.title || '').toLowerCase().includes(queryLower);
      const matchAuthor = (item.nickname || item.author_name || '').toLowerCase().includes(queryLower);
      const matchId = (item.item_id || '').toLowerCase().includes(queryLower);
      
      if (matchDesc || matchAuthor || matchId) {
        matchedItems.push(item);
      }
    });

    const currentPageItems = matchedItems.slice(startOffset, startOffset + pagination.limit);
    metrics.memorySearchTime = performance.now() - tSearchStart;

    return {
      items: currentPageItems,
      total: matchedItems.length,
      metrics
    };
  }

  // ==========================================
  // 路径 B：无关键字的常规列表（🔥 V2 纯索引驱动/完美分页）
  // ==========================================
  let queryBuilder;

  // 依据筛选组合，精准匹配 V2 引入的、包含 platform 前缀的高级复合索引
  if (typeVal && hasFavFilter) {
    metrics.strategy = 'Index_Compound_Platform_Type_Fav_ScrapedAt';
    // 场景 1：同时筛选了 类型 + 收藏
    queryBuilder = db.captured_resources.where('[platform+type+is_favorite+scraped_at]')
      .between([targetPlatform, typeVal, favVal, Dexie.minKey], [targetPlatform, typeVal, favVal, Dexie.maxKey]);
  } else if (typeVal) {
    metrics.strategy = 'Index_Compound_Platform_Type_ScrapedAt';
    // 场景 2：只筛选了 类型
    queryBuilder = db.captured_resources.where('[platform+type+scraped_at]')
      .between([targetPlatform, typeVal, Dexie.minKey], [targetPlatform, typeVal, Dexie.maxKey]);
  } else if (hasFavFilter) {
    metrics.strategy = 'Index_Compound_Platform_Fav_ScrapedAt';
    // 场景 3：只筛选了 收藏
    queryBuilder = db.captured_resources.where('[platform+is_favorite+scraped_at]')
      .between([targetPlatform, favVal, Dexie.minKey], [targetPlatform, favVal, Dexie.maxKey]);
  } else {
    metrics.strategy = 'Index_Compound_Platform_ScrapedAt';
    queryBuilder = db.captured_resources.where('[platform+scraped_at]')
      .between([targetPlatform, Dexie.minKey], [targetPlatform, Dexie.maxKey]);
  }

  // 统一翻转游标实现按抓取时间降序（scraped_at 都在复合索引的倒数第二位/末位，天然支持高效排序）
  queryBuilder = queryBuilder.reverse();

  // 测速点 1：计算总条数
  // 💡 极其丝滑：因为 queryBuilder 已经在底层限定了当前平台和所有筛选条件，
  // 可以直接执行快速计数，不再需要复杂的 clone 判定，且结果 100% 准确
  const tCountStart = performance.now();
  const totalCount = await queryBuilder.clone().count();
  metrics.totalCountTime = performance.now() - tCountStart;

  // 测速点 2：纯索引驱动的分页数据读取
  // 💡 彻底修复：此时底层的集合中只有当前平台、满足收藏/类型状态的数据，
  // 这里的 offset(X).limit(Y) 是绝对精准和安全的，绝对不会再出现空白页！
  const tFetchStart = performance.now();
  const currentPageItems = await queryBuilder
    .offset(startOffset)
    .limit(pagination.limit)
    .toArray();
  metrics.dataFetchTime = performance.now() - tFetchStart;

  return {
    items: currentPageItems,
    total: totalCount,
    metrics
  };
};
