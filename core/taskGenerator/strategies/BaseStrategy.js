// core/taskGenerator/strategies/BaseStrategy.js

export class BaseStrategy {
  constructor(platform) {
    this.platform = platform; // 平台标识 (如 'xhs', 'douyin')
  }

  // 统一去重过滤工具方法
  filterUrls(urls) {
    return [...new Set((urls || []).filter(Boolean))];
  }

  // 统一提取图片扩展名方法
  getImgExtension(url) {
    if (!url) return 'webp';
    const extMatch = url.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff)(\?|\$)/i);
    return extMatch ? extMatch[1].toLowerCase() : 'webp';
  }

  // 统一的连接符判断
  getSeparator(v, separator = '_') {
    return v ? separator : '';
  }
}
