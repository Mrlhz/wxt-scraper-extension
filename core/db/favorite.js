import { db } from '../index.js'; // 引入dexie 实例

/**
 * 切换媒体作品（视频/图集）的收藏状态
 * @param {object} aweme 作品
 * @returns {Promise<number>} 返回更新后的状态：1 为已收藏，0 为未收藏
 */
export async function toggleMediaFavorite(aweme) {
  return await db.transaction('rw', db.captured_resources, async () => {
    // 1. 获取当前数据
    const { platform, item_id } = aweme;
    const item = await db.captured_resources.get([platform, item_id]);
    if (!item) throw new Error(`作品 ${item_id} 不存在`);

    // 2. 取反状态 (如果是 undefined 或 0，则变为 1；如果是 1，则变为 0)
    const newStatus = item.is_favorite === 1 ? 0 : 1;

    // 3. 更新数据库
    await db.captured_resources.update([platform, item_id], { is_favorite: newStatus });
    return newStatus;
  });
}

/**
 * 切换博主/作者的收藏状态
 * @param {object} author 作者
 * @returns {Promise<number>} 返回更新后的状态：1 为已收藏，0 为未收藏
 */
export async function toggleAuthorFavorite(author) {
  const { platform, user_id } = author;
  return await db.transaction('rw', db.source_entities, async () => {
    // 1. 获取当前数据
    const author = await db.source_entities.get([platform, user_id]);
    if (!author) {
      throw new Error(`作者 ${user_id} 不存在`);
    }

    // 2. 取反状态
    const newStatus = author.is_favorite === 1 ? 0 : 1;

    // 3. 更新数据库
    await db.source_entities.update([platform, user_id], { is_favorite: newStatus });
    return newStatus;
  });
}

/**
 * 获取所有收藏的媒体作品列表（基于新增的索引）
 */
export async function getFavoriteMediaList() {
  return await db.captured_resources
    .where('is_favorite')
    .equals(1)
    .toArray();
}


/**
 * 批量设置媒体作品（视频/图集）的收藏状态
 * @param {string[]} awemeIds 作品ID数组
 * @param {boolean} isFavorite true 为收藏(1)，false 为取消收藏(0)
 * @returns {Promise<number>} 返回成功更新的记录条数
 */
export async function bulkSetMediaFavorite(awemeIds, isFavorite) {
  if (!awemeIds || awemeIds.length === 0) return 0;
  
  const statusValue = isFavorite ? 1 : 0;
  
  // 构造 bulkUpdate 所需的更新映射对象数组
  const updates = awemeIds.map(id => ({
    key: id,
    changes: { is_favorite: statusValue }
  }));

  // 使用事务确保操作的原子性
  return await db.transaction('rw', db.captured_resources, async () => {
    return await db.captured_resources.bulkUpdate(updates);
  });
}

/**
 * 批量设置博主/作者的收藏状态
 * @param {string[]} authorIds 作者ID数组
 * @param {boolean} isFavorite true 为收藏(1)，false 为取消收藏(0)
 * @returns {Promise<number>} 返回成功更新的记录条数
 */
export async function bulkSetAuthorFavorite(authorIds, isFavorite) {
  if (!authorIds || authorIds.length === 0) return 0;
  
  const statusValue = isFavorite ? 1 : 0;
  
  const updates = authorIds.map(id => ({
    key: id,
    changes: { is_favorite: statusValue }
  }));

  return await db.transaction('rw', db.source_entities, async () => {
    return await db.source_entities.bulkUpdate(updates);
  });
}
