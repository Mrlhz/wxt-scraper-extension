/**
 * 🧹 工业级文件名/路径强力清洗器
 * @param {string} str - 待清洗的原始文本
 * @param {string} [dotReplaceWith=''] - 末尾点号替换符，默认直接剔除
 * @param {string} [invalidReplaceWith='_'] - 系统违禁符替换符
 * @returns {string} 清洗后的安全文本（最大255字符）
 */
export function cleanString(str, dotReplaceWith = '', invalidReplaceWith = '_') {
  if (!str) return '';
  return str
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, invalidReplaceWith)
    .replace(/^\s+|\s+$/g, '')
    .replace(/\.+$/g, dotReplaceWith)
    .replace(/^\s+|\s+$/g, '')
    .substring(0, 255);
}

/**
 * 💡 工具方法：安全且纯净地提取 url 中的文件名
 * @param {string} urlStr - 原始 url 字符串
 * @param {string} defaultName - 兜底文件名
 * @returns {string} 提取出的文件名
 */
export function extractFileName(urlStr, defaultName = 'download') {
  if (typeof urlStr !== 'string') return defaultName;

  // 1. 快速去除空白，规范化
  const trimmed = urlStr.trim();
  if (!trimmed) return defaultName;

  try {
    // 2. 修复对 '//example.com' 或无协议域名的解析漏洞
    const hasProtocol = /^[a-z0-9]+:/i.test(trimmed) || trimmed.startsWith('//');
    const urlObj = new URL(hasProtocol ? trimmed : `https://${trimmed}`);

    // 3. 提取路径名并解码中文/特殊字符
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();

    if (!filename) return defaultName;

    return decodeURIComponent(filename);
  } catch {
    // 4. 降级方案：纯文本切分
    const pathPart = trimmed.split(/[?#]/)[0]; // 同时去掉 ? 和 #
    const filename = pathPart.split('/').pop();

    if (!filename) return defaultName;

    try {
      return decodeURIComponent(filename);
    } catch {
      return filename; // 解码失败直接返回原片段
    }
  }
}

export function cleanRawAweme(raw) {
  const type = raw?.type;
  const isVideo = type === 'video';
  const tag_list = raw?.tag_list?.map(v => v.name) || [];
  const streamNode = raw?.video?.media?.stream;
  const videoUrls = isVideo ? extractVideoUrls(streamNode) : [];
  const image_list = raw?.image_list || [];
  const images = image_list.map(v => v.url_default);
  const urlList = isVideo ? videoUrls : images;
  return {
    platform: 'xiaohongshu',
    item_id: raw.note_id,
    type,
    create_time: raw.time || raw.last_update_time,
    title: raw.title,
    desc: raw.desc || '',
    user: raw.user || { user_id: 'unknown', nickname: '未知作者' },
    // 封装备用 CDN 弹夹
    downloadUrl: urlList[0],
    downloadUrls: urlList,
    images,
    tag_list,
    ip_location: raw?.ip_location || '',
  }
}


/**
 * 👑 从小红书/抖音的原生 stream 节点中提取去重、排序后的备用视频 CDN 弹夹
 * @param {Object} stream 接口返回的原始流节点 (raw.video.media.stream)
 * @returns {String[]} 去重且按画质降序排列的视频链接数组（第一项为最佳推荐直链）
 */
export function extractVideoUrls(stream) {
  if (!stream) return [];

  const videoUrlsSet = new Set();
  
  // 1. 定义希望遍历的编解码器/流类型
  // 💡 如果希望下载的文件 100% 能在任何设备、剪辑软件中直接双击播放，建议把 'h264' 放在最前面
  const codecs = ['EF5', 'h264', 'h265', 'EF4', 'EF6', 'EF7'];

  codecs.forEach(codec => {
    const qualityList = stream[codec]; // 这是一个清晰度数组（例如：1080p、720p 各种档位）
    
    if (Array.isArray(qualityList) && qualityList.length > 0) {
      // ⚡️ 进阶策略：小红书的数组里，高清不一定在第一项。
      // 通过内置的 width 或 bitrate 字段进行降序排序，确保弹夹的前几发子弹永远是【最高清】的。
      const sortedQualityList = [...qualityList].sort((a, b) => {
        const bitrateA = Number(a?.bitrate || a?.video_bitrate || 0);
        const bitrateB = Number(b?.bitrate || b?.video_bitrate || 0);
        return bitrateB - bitrateA; // 码率高的排前面
      });

      // 2. 优先将所有清晰度档位的【主 URL】压入弹夹
      sortedQualityList.forEach((quality) => {
        if (quality?.master_url) {
          videoUrlsSet.add(quality.master_url.trim());
        }
      });

      // 3. 其次将所有清晰度档位的【备用 CDN URL】完整展开并压入弹夹
      sortedQualityList.forEach((quality) => {
        if (Array.isArray(quality?.backup_urls)) {
          quality.backup_urls.forEach((url) => {
            if (url) videoUrlsSet.add(url.trim());
          });
        }
      });
    }
  });

  // 4. 将 Set 转换为最终的去重弹夹数组，并过滤掉空值
  return Array.from(videoUrlsSet).filter(Boolean);
}
