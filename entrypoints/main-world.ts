// entrypoints/main-world.ts
import { MEDIA_DETAIL_DATA, TARGET_URLS, DETAIL, POST, HISTORY } from '@/core/globalConfig.js';

export default defineUnlistedScript(() => {
  const TARGET_URLS_MAP = {
    [DETAIL]: (result) => {
      const raw = result?.data?.items || result || {};
      return Array.isArray(raw) ? raw : [raw];
    },
    [POST]: (result) => result.aweme_list || [],
    [HISTORY]: (result) => result.aweme_list || [],
  };

  console.log("🚀 全能拦截脚本（XHR + Fetch 备份）已就绪...");

  function processData(type, json) {
    const stringifiedPayload = JSON.stringify(json);
    window.postMessage({ action: MEDIA_DETAIL_DATA, payload: stringifiedPayload }, '*');
  }

  // ==========================================
  // 1. XMLHttpRequest 拦截
  // ==========================================
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;

  XHR.open = function (method, url) {
    this._targetUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XHR.send = function (postData) {
    const xhrInstance = this;
    xhrInstance.addEventListener('readystatechange', function () {
      if (xhrInstance.readyState === 4) {
        const currentUrl = xhrInstance._targetUrl || "";
        const targetUrl = TARGET_URLS.find(endpoint => currentUrl.includes(endpoint));
        // console.log("🔍 [InjectCore] XHR 拦截到请求:", currentUrl, "匹配目标:", targetUrl || "无");
        if (targetUrl) {
          try {
            let res = xhrInstance.response;
            if (!res) return;

            let parsedJson = null;
            if (typeof res === 'object' && !(res instanceof ArrayBuffer)) {
              parsedJson = res;
            } else {
              if (res instanceof ArrayBuffer) {
                res = new TextDecoder('utf-8').decode(res);
              }
              parsedJson = JSON.parse(res);
            }

            const handler = TARGET_URLS_MAP[targetUrl];
            if (handler) {
              const result = handler(parsedJson);
              console.log("📬 [InjectCore] XHR 拦截到目标数据:", { targetUrl, url: currentUrl, result });
              processData(targetUrl, { targetUrl, url: currentUrl, result });
            }
          } catch (e) {
            console.warn("❌ [InjectCore] XHR 拦截层解析失败:", e);
          }
        }
      }
    });
    return originalSend.apply(this, arguments);
  };

  // ==========================================
  // 2. Fetch API 完整拦截
  // ==========================================
  const { fetch: originalFetch } = window;
  window.fetch = async (...args) => {
    const url = args[0] instanceof URL ? args[0].href : (typeof args[0] === 'string' ? args[0] : '');
    const response = await originalFetch(...args);
    
    const targetUrl = TARGET_URLS.find(endpoint => url.includes(endpoint));
    if (targetUrl) {
      try {
        const clone = response.clone();
        clone.json().then(data => {
          const handler = TARGET_URLS_MAP[targetUrl];
          const result = handler ? handler(data) : data;
          processData(targetUrl, { targetUrl, url, result });
        }).catch(err => console.error("❌ Fetch 读取 JSON 失败:", err));
      } catch (e) {
        console.error("❌ Fetch 复制流失败:", e);
      }
    }
    return response;
  };
});
