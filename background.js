/**
 * OpenCode 提问导航扩展的后台服务。
 * 负责配置浏览器侧栏，并处理 AI 站点入口打开侧栏的请求。
 */
importScripts('ai-sites.js');

const THEME_KEY = 'ocGlmTheme';
const SITE_KEY = 'ocAiSite';
const LOG_PREFIX = '[OC Prompt Nav]';

/** 返回合法的站点 id，未指定时使用默认站点。 */
function resolveSiteId(siteId) {
  const sites = globalThis.OC_AI_SITES || [];
  const found = sites.find((site) => site.id === siteId);
  if (found) return found.id;
  return globalThis.OC_AI_SITE_FALLBACK || sites[0]?.id || 'glm';
}

/** 配置侧栏：点击扩展工具栏图标时直接打开侧栏。 */
async function configureSidePanel() {
  try {
    await chrome.sidePanel.setOptions({
      path: 'sidepanel.html',
      enabled: true,
    });
  } catch (error) {
    console.warn(LOG_PREFIX, '配置侧栏页面失败', error);
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn(LOG_PREFIX, '配置工具栏图标行为失败', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel();
});

/** 保存 OpenCode 页面传来的主题变量，供侧栏的加载态和回退卡片使用。 */
function saveTheme(theme) {
  if (!theme || typeof theme !== 'object') return;
  chrome.storage.session
    .set({ [THEME_KEY]: theme })
    .catch((error) => console.warn(LOG_PREFIX, '保存侧栏主题失败', error));
}

/** 保存当前选择的 AI 站点，侧栏会监听变化并切换 iframe。 */
function saveSite(siteId) {
  chrome.storage.local
    .set({ [SITE_KEY]: siteId })
    .catch((error) => console.warn(LOG_PREFIX, '保存 AI 站点失败', error));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'open-ai-panel') return;

  const windowId = sender.tab?.windowId;
  if (typeof windowId !== 'number') {
    sendResponse({ ok: false, error: 'NO_WINDOW_ID' });
    return;
  }

  const siteId = resolveSiteId(message.siteId);

  // 先同步调用 open()，避免异步等待导致用户手势失效
  chrome.sidePanel
    .open({ windowId })
    .then(() => {
      saveSite(siteId);
      saveTheme(message.theme);
      sendResponse({ ok: true, siteId });
    })
    .catch((error) => {
      console.warn(LOG_PREFIX, '打开 AI 对话侧栏失败', error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });

  return true;
});
