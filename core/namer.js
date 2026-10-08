// namer.js / taskGenerator.js

import { cleanString, extractFileName } from './cleaner.js';

/**
 * 📂 统一多媒体任务归一化生成器
 * @param {Object} aweme - 原始抓取的媒体对象
 * @param {Object} options - 外部控制配置项
 * @param {boolean} [options.downloadAudio=false] - 是否同步提取原声BGM
 * @returns {Array<Object>} 经过规范化封装的标准下载任务弹夹数组
 */
/**
 * 📂 统一多媒体任务归一化生成器 (已全面对齐 [platform+item_id] 复合主键架构)
 * @param {Object} aweme - 原始抓取的媒体对象（支持上游混入的 platform 属性）
 * @param {Object} options - 外部控制配置项
 * @param {boolean} [options.downloadAudio=true] - 是否同步提取原声BGM
 * @returns {Array<Object>} 经过规范化封装的标准下载任务弹夹数组
 */
export function generateMediaTasks(aweme = {}, options = { downloadAudio: true }) {
  // 1. 👑 核心主键与平台字段归一化对齐
  const platform = aweme.platform || 'unknown';
  // 兼容不同平台的 ID 命名，强转为 String 并统一称为 item_id
  const rawItemId = aweme.item_id || aweme.aweme_id || aweme.id;
  const item_id = rawItemId ? String(rawItemId) : '';

  // 🛡️ 防御机制：如果没有核心主键，直接拦截返回空队列，防止引发后续系统的 DataError 崩溃
  if (!item_id || item_id === 'undefined') {
    console.warn('[TaskGenerator] 拦截到一条没有有效 ID 的媒体任务请求:', aweme);
    return [];
  }

  const { type, user, desc, title } = aweme;
  
  // 兼容不同的用户 ID 和昵称命名结构
  const safeNickname = cleanString(user?.nickname || aweme.user?.nickname) || '未知作者';
  const safeDesc = cleanString(title || desc) || '';
  const uid = user?.user_id;
  
  const getSeparator = v => v ? '_' : '';
  // 统一分流文件夹路径：加入 platform 目录作顶层隔离，彻底防重名冲突
  const basePath = uid ? `${platform}/${uid}/` : `${platform}/${safeNickname}/`;

  const tasks = [];

  // 2. 📹 处理视频任务流
  if (type === 'video') {
    const rawUrls = [
      aweme.downloadUrl,
      ...(aweme.downloadUrls || [])
    ];
    const validVideoUrls = [...new Set(rawUrls.filter(Boolean))];

    if (validVideoUrls.length > 0) {
      // 完美的解耦文件名
      const standardFilename = `${basePath}${safeDesc}${getSeparator(safeDesc)}${item_id}.mp4`;

      tasks.push({
        item_id,                // 🔄 字段对齐：由 aweme_id 修改为标准 item_id
        platform,               // 👑 必须显式携带平台属性！
        type: 'video',
        fileIndex: 0,
        index: 0,               // 🔄 字段对齐：由 fileIndex 修改为标准的 index，完美对齐批量登记表
        urlCandidates: validVideoUrls,
        currentUrlIndex: 0,
        filename: standardFilename,
        currentFilenameIndex: 0,
        filenames: [`${basePath}${item_id}.mp4`],
        conflictAction: 'overwrite',
        priority: 1
      });
    }
  }

  // 3. 📷 处理图文笔记任务流
  // 兼容类型为 'note' 或 'image'，且包含图片数组的场景
  if ((['normal', 'note', 'image'] ).includes(type) && aweme.images?.length > 0) {
    aweme.images.forEach((image, index) => {
      // 兼容图片数组是纯字符串数组，或者是包含 url/url_list 的对象数组
      const rawImgUrls = typeof image === 'string'
        ? [image]
        : [image.url, ...(image.downloadUrls || []), ...(image.url_list || [])];
      
      const validImgUrls = [...new Set(rawImgUrls.filter(Boolean))];

      if (validImgUrls.length > 0) {
        // 利用第一个有效链接快速提取扩展名
        const extMatch = validImgUrls[0].match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)(\?|\$)/i);
        const extension = extMatch ? extMatch[1].toLowerCase() : 'webp';
        
        const standardFilename = `${basePath}${safeDesc}${getSeparator(safeDesc)}${item_id}-${index + 1}.${extension}`;

        tasks.push({
          item_id,              // 🔄 字段对齐：由 aweme_id 修改为标准 item_id
          platform,             // 👑 必须显式携带平台属性！
          type: 'image',
          fileIndex: index,
          index: index,         // 🔄 字段对齐：由 fileIndex 修改为标准的 index
          urlCandidates: validImgUrls,
          currentUrlIndex: 0,
          filename: standardFilename,
          currentFilenameIndex: 0,
          filenames: [`${basePath}${item_id}-${index + 1}.${extension}`],
          conflictAction: 'uniquify',
          priority: 0
        });
      }
    });
  }

  return tasks;
}
