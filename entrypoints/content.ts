export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    console.log('Hello content.');
    // 1. 使用原生纯净的 Web API 注入编译后的 main-world.js
    try {
      const script = document.createElement('script');
      // 完美配合 WXT 的运行时环境获取绝对路径
      script.src = browser.runtime.getURL('/main-world.js');
      
      script.onload = function () {
        this.remove(); // 注入并运行成功后，立刻从 DOM 树中移除脚本标签，保持干净
      };
      
      (document.head || document.documentElement).appendChild(script);
      console.log('✅ [Content Script] 成功发起 main-world.js 注入');
    } catch (err) {
      console.error('❌ [Content Script] 发起注入失败:', err);
    }
  },
});
