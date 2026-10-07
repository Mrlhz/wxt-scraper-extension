在 Dexie.js 中，要删除数据或整张表，取决于具体需求（按主键删除、按条件批量删除、清空表，或者删除整张表）。
针对 download_registry 表（联合主键为 [item_id+type+index]），以下是几种常见的删除操作方法：

### 1. 按主键删除单条数据

由于主键是联合主键 [item_id+type+index]，删除时需要传入一个包含这三个属性的数组。

```js
// 假设要删除 item_id 为 '123'，type 为 'image'，index 为 1 的数据
db.download_registry.delete(['123', 'image', 1])
  .then(() => {
    console.log("单条数据删除成功");
  })
  .catch(err => {
    console.error("删除失败:", err);
  });
```

### 2. 按条件批量删除 (利用索引)
如果想利用创建的单字段索引（如 item_id 或 status）来批量删除关联的数据，可以使用 where 结合 delete()。
### 示例 A：按 item_id 一键删除关联的几十张图片/视频
```js

// 删除该视频 ID 下的所有下载记录
db.download_registry.where('item_id').equals('123').delete()
  .then(deleteCount => {
    console.log(`成功删除了 ${deleteCount} 条关联记录`);
  });
```
### 示例 B：删除所有状态为 'failed' 的记录

```js
db.download_registry.where('status').equals('failed').delete()
  .then(deleteCount => {
    console.log(`清除了 ${deleteCount} 条失败的记录`);
  });
```

### 3. 清空整张表的数据 (保留表结构)
如果只想清空 download_registry 表里的所有内容，但不想删除这张表本身：

```js
db.download_registry.clear()
  .then(() => {
    console.log("表数据已完全清空");
  });
```
### 4. 彻底删除整张表或数据库

* 删除整个数据库（包含所有表和数据）：

```js
db.delete().then(() => {
  console.log("数据库删除成功");
});
```
* 动态删除单张表：Dexie 不支持直接调用 db.download_registry.deleteTable() 这样的方法。如果想在升级时移除这张表，需要在定义版本时在 stores 中将其设为 null：

```js
// 在新版本中删除该表
db.version(2).stores({
  download_registry: null
});
```
