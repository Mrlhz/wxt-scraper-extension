import { db } from './index.js';

/**
 * 批量检测文件，并分类返回已存在和未存在的数据
 * @param {Array<{item_id: string, type: string, fileIndex: number}>} files - 需要检测的文件列表
 * @returns {Promise<{exists: Array, notExists: Array}>} - 分类后的对象结果
 */
export async function classifyFilesExistence(files) {
  // 初始化返回值结构
  const result = { exists: [], notExists: [] };

  try {
    if (!files || files.length === 0) {
      return result;
    }

    // 1. 构建 bulkGet 所需的联合主键数组
    const keys = files.map(f => [f.item_id, f.type, f.fileIndex]);

    // 2. 一次性批量查询数据库
    const records = await db.download_registry.bulkGet(keys);

    // 3. 根据查询结果，将原始文件对象分流到对应的数组中
    files.forEach((file, idx) => {
      const record = records[idx];
      const isCompleted = !!(record && record.status === 'completed');

      if (isCompleted) {
        result.exists.push(file);
      } else {
        result.notExists.push(file);
      }
    });

    return result;

  } catch (error) {
    console.warn("分类检测文件是否存在时出错:", error);
    // 出错时，安全起见将所有文件视为“未存在”，防止阻断后续的正常业务逻辑
    return { exists: [], notExists: [...files] };
  }
}
