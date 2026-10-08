// actions
export const MEDIA_DETAIL_DATA = 'MEDIA_DETAIL_DATA';
export const COLLECT_AND_SAVE_DATA = 'COLLECT_AND_SAVE_DATA';
export const QUEUE_CANCEL_ALL = 'QUEUE_CANCEL_ALL';
export const OPEN_DASHBOARD_TAB = 'OPEN_DASHBOARD_TAB';
export const MEDIA_HELPER_CAPTURED = 'MEDIA_HELPER_CAPTURED';
export const DOWNLOAD_MEDIA_BATCH = 'DOWNLOAD_MEDIA_BATCH';
// metrics
export const PRINT_METRICS_REPORT = 'PRINT_METRICS_REPORT';

// 平台
export const PLATFORMS = {
  XHS: 'xhs',
  DOUYIN: 'douyin',
  BLOG: 'blog'
};

export const commands = {
  ALT_1: 'ALT_1',
  ALT_2: 'ALT_2',
  ALT_8: 'ALT_8'
};

export const DETAIL = 'api/sns/web/v1/feed';
export const POST = 'api/sns/web/v1/post';
export const HISTORY = 'api/sns/web/v1/history';

export const TARGET_URLS = [DETAIL, POST, HISTORY];

// 存储设置的键名
export const globalSettingsKey = '__settings__';

export const downloadsLocation = [
  'D:\\Downloads'             // 系统默认下载目录
];

export const exts = ['.mp4', '.webp', '.jpeg', '.jpg', '.mp3', '.m4a'];
