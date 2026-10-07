import { db } from './index.js';

/**
 * 👑 核心：安全的批量持久化入库函数（全面自愈增量保护+高性能优化+防状态覆盖+历史曾用名追踪版）
 * @param {Array<Object>} items - 采集到的抖音原始数据数组
 */
export async function saveCapturedItemsToDB(items) {
  if (!items || items.length === 0) return 0;
  
  const now = Date.now();
  
  // 1. 构造视频流水数据 (captured_resources)
  const mediaRecords = items.map(item => {
    // 🔔 防御性控制：确保单条数据里一定有核心标志
    const platform = item.platform || 'unknown';
    const item_id = String(item.item_id || item.aweme_id || '');
    
    return {
      platform, 
      item_id, // 对应复合主键 [platform+item_id] 主键
      user_id: item.user?.user_id || 'unknown',
      nickname: item.user?.nickname || '未知作者', 
      title: item.title || '',
      desc: item.desc || '',
      type: item.type || 'video', // 'video' | 'note' | 'image' | 'article'
      // 💡 优化：使用原生的 structuredClone 代替 JSON 序列化，防止 BigInt 导致崩溃
      raw_data: structuredClone(item),
      status: 'pushed',
      create_time: item.create_time || now,
      scraped_at: now
    };
  }).filter(m => m.item_id); // 🛡️ 过滤掉没有 ID 的脏数据，防止引发 DataError

  // 2. 从本次采集到的数据中，提炼作者档案
  const authorMap = new Map();
  items.forEach(item => {
    const platform = item.platform || 'unknown';
    const userId = item.user?.user_id || 'unknown'; 
    
    if (userId !== 'unknown') {
      const authorUniqueKey = `${platform}_${userId}`; 
      authorMap.set(authorUniqueKey, {
        platform,                           
        user_id: String(userId), // 对应复合主键 [platform+user_id] 主键
        xsec_token: item.user?.xsec_token || '',  // 尝试捕获原始接口返回的 xsec_token
        nickname: item.user?.nickname || '未知作者'
      });
    }
  });

  try {
    // 3. 开启高性能读写事务
    await db.transaction('rw', [db.captured_resources, db.source_entities], async () => {
      
      // ==========================================
      // 【诊断核心 A】资源流水表核心安检与合并
      // ==========================================
      const mediaKeys = mediaRecords.map(m => [m.platform, m.item_id]);
      const existingMedias = await db.captured_resources.bulkGet(mediaKeys);
      
      // 转为 Map 方便高效比对（用 'platform_itemid' 作为联合字符串当 Key）
      const existingMediasMap = new Map(
        existingMedias.filter(m => m).map(m => [`${m.platform}_${m.item_id}`, m])
      );

      // 差异化合并视频流水数据
      const finalMediaPuts = mediaRecords.map(newRecord => {
        // 使用相同的联合字符串 Key 去匹配老数据
        const oldRecord = existingMediasMap.get(`${newRecord.platform}_${newRecord.item_id}`);

        // 如果本地老数据已经是 completed 或 downloading 状态，继承其状态与物理路径
        if (oldRecord && ['completed', 'downloading'].includes(oldRecord.status)) {
          return {
            ...newRecord,
            status: oldRecord.status,
            is_favorite: oldRecord.is_favorite ?? 0, // 继承用户收藏状态
            download_path: oldRecord.download_path || [] // 继承已存的下载路径
          };
        }
        return newRecord;
      });

      // 🚨【强力断言】：物理写入资源表前，逐条验证主键完整性
      finalMediaPuts.forEach((data, i) => {
        if (!data.platform || !data.item_id || data.platform === 'undefined' || data.item_id === 'undefined') {
          console.log(`❌ [安检报警] 资源流水表第 ${i} 条数据不符合复合主键规范 [platform+item_id]，引发报错的数据体为:`, data);
          throw new Error(`[DexieDB 前置拦截] 捕获到资源流水表主键异常，拒绝写入，防止底层报错崩溃！`);
        }
      });

      // 执行资源表写入
      await db.captured_resources.bulkPut(finalMediaPuts);
      
      // 作者档案合并写入
      // ==========================================
      // 【诊断核心 B】作者档案表核心安检与合并
      // ==========================================
      if (authorMap.size > 0) {
        const authorRecords = Array.from(authorMap.values());
        
        const authorKeys = authorRecords.map(a => [a.platform, a.user_id]);
        const existingProfiles = await db.source_entities.bulkGet(authorKeys);
        
        const existingProfilesMap = new Map(
          existingProfiles.filter(p => p).map(p => [`${p.platform}_${p.user_id}`, p])
        );

        const authorPutsToExecute = [];

        for (const freshAuthor of authorRecords) {
          const profileKey = `${freshAuthor.platform}_${freshAuthor.user_id}`;
          const existingProfile = existingProfilesMap.get(profileKey);
          
          if (existingProfile) {
            // 通过独立方法计算最新的历史曾用名数组
            const updatedHistoryNames = typeof computeAuthorHistoryNames === 'function'
              ? computeAuthorHistoryNames(existingProfile, freshAuthor.nickname)
              : [];

            // 场景 A：如果该作者已存在，合并非破坏性增量补丁
            authorPutsToExecute.push({
              ...existingProfile, 
              platform: freshAuthor.platform,   
              user_id: freshAuthor.user_id,     
              xsec_token: existingProfile.xsec_token || freshAuthor.xsec_token || '',
              nickname: freshAuthor.nickname,
              avatar: freshAuthor.avatar || existingProfile.avatar || '',
              history_names: updatedHistoryNames,  // 写入自愈后的历史名字数组
              last_grab_time: now                  // 刷新活跃时间
            });
          } else {
            // 场景 B：如果是新发现的未知作者，进行全量初始化
            authorPutsToExecute.push({
              platform: freshAuthor.platform,
              user_id: freshAuthor.user_id,
              xsec_token: freshAuthor.xsec_token || '',
              nickname: freshAuthor.nickname,
              avatar: freshAuthor.avatar || '',
              sync_status: 'active',
              tags: [],                            // 初始化为空数组
              history_names: [],                   // 新作者历史姓名初始化为空数组
              last_grab_time: now
            });
          }
        }

        // 🚨【强力断言】：物理写入作者表前，逐条验证主键完整性
        authorPutsToExecute.forEach((data, i) => {
          if (!data.platform || !data.user_id || data.platform === 'undefined' || data.user_id === 'undefined') {
            console.log(`❌ [安检报警] 作者档案表第 ${i} 条数据不符合复合主键规范 [platform+user_id]，引发报错的数据体为:`, data);
            throw new Error(`[DexieDB 前置拦截] 捕获到作者档案表主键异常，拒绝写入，防止底层报错崩溃！`);
          }
        });

        if (authorPutsToExecute.length > 0) {
          await db.source_entities.bulkPut(authorPutsToExecute);
        }
      }
    });

    // console.log(`[DexieDB] 安全增量入库完成。`);
    console.log(`[DexieDB] 安全入库成功：自愈保护并写入 ${mediaRecords.length} 条作品，安全合并 ${authorMap.size} 位作者档案。`);
    return mediaRecords.length;
  } catch (error) {
    console.log('[DexieDB] 最终拦截 - 批量增量入库发生致命异常:', error);
    throw error;
  }
}

/**
 * 👑 独立自愈工具：计算博主昵称变更并维护历史曾用名数组
 * @param {Object} existingProfile - 数据库中现有的作者档案
 * @param {string} freshNickname - 本次抓取到的最新作者昵称
 * @returns {Array<string>} 更新后的历史曾用名数组
 */
function computeAuthorHistoryNames(existingProfile, freshNickname) {
  // 1. 初始化或获取现有的历史名字数组
  const historyNames = Array.isArray(existingProfile?.history_names)
    ? [...existingProfile.history_names] 
    : [];

  const oldNickname = existingProfile?.nickname;

  // 2. 如果存在旧昵称，且旧昵称与最新昵称不一致，同时最新昵称不是非正常兜底词
  if (
    oldNickname &&
    oldNickname !== freshNickname &&
    oldNickname !== '未知作者' &&
    freshNickname !== '未知作者'
  ) {
    // 3. 将旧昵称推入历史数组，并通过 Set 保证数组内的名字唯一
    if (!historyNames.includes(oldNickname)) {
      historyNames.push(oldNickname);
    }
  }

  return historyNames;
}
