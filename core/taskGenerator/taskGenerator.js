// taskGenerator.js
import { XiaohongshuStrategy } from '@/core/taskGenerator/strategies/XiaohongshuStrategy';

// 动态策略注册表
const strategyRegistry = {
  'xhs': new XiaohongshuStrategy('xhs'),
  'xiaohongshu': new XiaohongshuStrategy('xiaohongshu'),
};

/**
 * 📂 统一多媒体任务归一化生成器入口
 */
export function generateMediaTasks(rawData = {}, options = { downloadAudio: true }) {
  // 识别平台类型：如果数据本身有 platform 字段就用它的，没有的话可以根据数据特征默认识别
  let platformKey = String(rawData.platform || '').toLowerCase();
  
  if (!platformKey) {
    // 智能兜底判断：根据抖音特有的属性识别
    platformKey = (rawData.aweme_id || rawData.author) ? 'douyin' : 'xhs';
  }

  const strategy = strategyRegistry[platformKey];

  if (!strategy) {
    console.warn(`[TaskGenerator] 暂不支持的平台类型: ${platformKey}`);
    return [];
  }

  // 委托给对应平台的策略类实例去执行，完美兼容 options 传递
  return strategy.generate(rawData, options);
}
