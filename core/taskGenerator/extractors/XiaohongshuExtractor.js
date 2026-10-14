// core/taskGenerator/extractors/XiaohongshuExtractor.js

import { BaseExtractor } from './BaseExtractor';
import { cleanString } from '@/core/cleaner.js';

export class XiaohongshuExtractor extends BaseExtractor {
  constructor(platform) {
    super(platform);
  }

  generate(rawData) {
    const rawItemId = rawData.item_id || rawData.aweme_id || rawData.id;
    const item_id = rawItemId ? String(rawItemId) : '';

    if (!item_id || item_id === 'undefined') {
      console.warn('[XiaohongshuExtractor] 拦截到一条没有有效 ID 的媒体任务:', rawData);
      return [];
    }

    const { type, user, desc, title } = rawData;
    const safeNickname = cleanString(user?.nickname || rawData.user?.nickname) || '未知作者';
    const safeDesc = cleanString(title || desc) || '';
    const uid = user?.user_id;
    
    const basePath = uid ? `${this.platform}/${uid}/` : `${this.platform}/${safeNickname}/`;
    const ctx = { item_id, safeDesc, basePath };

    if (type === 'video') {
      return this._extractVideoTasks(rawData, ctx);
    } 
    
    if (['normal', 'note', 'image'].includes(type)) {
      return this._extractImageTasks(rawData, ctx);
    }

    return [];
  }

  _extractVideoTasks(rawData, ctx) {
    const rawUrls = [rawData.downloadUrl, ...(rawData.downloadUrls || [])];
    const validVideoUrls = this.filterUrls(rawUrls);
    if (validVideoUrls.length === 0) return [];

    return [{
      item_id: ctx.item_id,
      platform: this.platform,
      type: 'video',
      fileIndex: 0,
      index: 0,
      urlCandidates: validVideoUrls,
      currentUrlIndex: 0,
      filename: `${ctx.basePath}${ctx.safeDesc}${this.getSeparator(ctx.safeDesc)}${ctx.item_id}.mp4`,
      currentFilenameIndex: 0,
      filenames: [`${ctx.basePath}${ctx.item_id}.mp4`],
      conflictAction: 'overwrite',
      priority: 1
    }];
  }

  _extractImageTasks(rawData, ctx) {
    if (!rawData.images?.length) return [];
    
    const tasks = [];
    rawData.images.forEach((image, index) => {
      const rawImgUrls = typeof image === 'string'
        ? [image]
        : [image.url, ...(image.downloadUrls || []), ...(image.url_list || [])];
      
      const validImgUrls = this.filterUrls(rawImgUrls);
      if (validImgUrls.length === 0) return;

      const extension = this.getImgExtension(validImgUrls[0]);
      const standardFilename = `${ctx.basePath}${ctx.safeDesc}${this.getSeparator(ctx.safeDesc)}${ctx.item_id}-${index + 1}.${extension}`;

      tasks.push({
        item_id: ctx.item_id,
        platform: this.platform,
        type: 'image',
        fileIndex: index,
        index: index,
        urlCandidates: validImgUrls,
        currentUrlIndex: 0,
        filename: standardFilename,
        currentFilenameIndex: 0,
        filenames: [`${ctx.basePath}${ctx.item_id}-${index + 1}.${extension}`],
        conflictAction: 'uniquify',
        priority: 0
      });
    });
    return tasks;
  }
}
