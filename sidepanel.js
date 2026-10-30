/**
 * AI 对话侧栏页面脚本。
 * 只负责 iframe 加载、站点切换、加载失败回退和主题同步，不读取 iframe 内部内容。
 */
const SITE_KEY = 'ocAiSite';
const THEME_KEY = 'ocGlmTheme';
const LOAD_TIMEOUT = 12000;
const LOG_PREFIX = '[OC Prompt Nav]';

const THEME_VARS = {
  bg: '--glm-bg',
  text: '--glm-text',
  muted: '--glm-muted',
  border: '--glm-border',
  hover: '--glm-hover',
};

const panel = document.getElementById('panel');
const frame = document.getElementById('glm-frame');
const loading = document.getElementById('loading');
const fallback = document.getElementById('fallback');
const siteTitle = document.getElementById('site-title');
const fallbackTitle = document.getElementById('fallback-title');
const loadingLabel = document.getElementById('loading-label');
const reloadButton = document.getElementById('reload');
const openTabButton = document.getElementById('open-tab');
const retryButton = document.getElementById('retry');
const fallbackOpenButton = document.getElementById('fallback-open');

let loadTimer = 0;
let loadToken = 0;
let currentSite = null;

/** 返回所有已配置的 AI 站点。 */
function getSites() {
  return globalThis.OC_AI_SITES || [];
}

/** 返回兜底站点，避免共享配置异常时侧栏完全空白。 */
function getFallbackSite() {
  return (
    getSites()[0] || {
      id: 'glm',
      name: '智谱清言',
      url: 'https://chatglm.cn/',
      logo: '',
    }
  );
}

/** 按 id 解析站点，找不到时使用默认站点。 */
function resolveSite(siteId) {
  const sites = getSites();
  return (
    sites.find((site) => site.id === siteId) ||
    sites.find((site) => site.id === globalThis.OC_AI_SITE_FALLBACK) ||
    getFallbackSite()
  );
}

/** 更新顶栏、fallback 文案和按钮标题。 */
function updateSiteChrome() {
  if (!currentSite) return;

  siteTitle.textContent = currentSite.name;
  fallbackTitle.textContent = `${currentSite.name} 暂时没有加载出来`;
  const gap = /^[A-Za-z0-9]/.test(currentSite.name) ? ' ' : '';
  loadingLabel.textContent = `正在加载${gap}${currentSite.name}…`;
  document.title = currentSite.name;
  frame.title = currentSite.name;

  reloadButton.title = `刷新${currentSite.name}`;
  reloadButton.setAttribute('aria-label', `刷新${currentSite.name}`);
  openTabButton.title = `在标签页打开${currentSite.name}`;
  openTabButton.setAttribute('aria-label', `在标签页打开${currentSite.name}`);
}

/** 应用 OpenCode 页面传来的主题变量。 */
function applyTheme(theme) {
  if (!theme || typeof theme !== 'object') return;
  for (const [key, cssVar] of Object.entries(THEME_VARS)) {
    const value = theme[key];
    if (typeof value === 'string' && value.trim()) {
      document.documentElement.style.setProperty(cssVar, value.trim());
    }
  }
}

/** 从 session storage 读取最近一次主题。 */
async function loadTheme() {
  try {
    const data = await chrome.storage.session.get(THEME_KEY);
    applyTheme(data?.[THEME_KEY]);
  } catch (error) {
    console.warn(LOG_PREFIX, '读取侧栏主题失败', error);
  }
}

/** 从 local storage 读取上次选择的站点。 */
async function loadSelectedSiteId() {
  try {
    const data = await chrome.storage.local.get(SITE_KEY);
    return data?.[SITE_KEY] || globalThis.OC_AI_SITE_FALLBACK;
  } catch (error) {
    console.warn(LOG_PREFIX, '读取 AI 站点失败', error);
    return globalThis.OC_AI_SITE_FALLBACK;
  }
}

/** 显示加载态并隐藏回退卡片。 */
function showLoading() {
  panel.dataset.ready = 'false';
  loading.hidden = false;
  fallback.hidden = true;
}

/** 标记加载完成。 */
function markReady() {
  panel.dataset.ready = 'true';
  fallback.hidden = true;
  window.clearTimeout(loadTimer);
  loadTimer = 0;
}

/** 显示加载失败回退卡片。 */
function showFallback() {
  fallback.hidden = false;
}

/** 重新加载当前 AI 站点。 */
function loadSite() {
  if (!currentSite) return;

  const token = ++loadToken;
  window.clearTimeout(loadTimer);
  loadTimer = 0;
  showLoading();

  // 先切到 about:blank，确保再次设置相同 URL 也会重新加载
  frame.src = 'about:blank';
  window.setTimeout(() => {
    if (token !== loadToken) return;
    frame.src = currentSite.url;
    loadTimer = window.setTimeout(() => {
      loadTimer = 0;
      if (token !== loadToken) return;
      if (panel.dataset.ready !== 'true') showFallback();
    }, LOAD_TIMEOUT);
  }, 30);
}

/** 切换站点；只有站点变化时才重新加载 iframe。 */
function applySite(siteId) {
  const next = resolveSite(siteId);
  const changed = currentSite?.id !== next.id;
  currentSite = next;
  updateSiteChrome();
  if (changed) loadSite();
}

/** 在普通标签页打开当前 AI 站点。 */
function openInTab() {
  const url = currentSite?.url || getFallbackSite().url;
  try {
    chrome.tabs.create({ url, active: true });
  } catch (error) {
    console.warn(LOG_PREFIX, '在标签页打开 AI 站点失败', error);
    window.open(url, '_blank', 'noopener');
  }
}

frame.addEventListener('load', () => {
  if (!frame.src || frame.src === 'about:blank') return;
  if (!currentSite || frame.src !== currentSite.url) return;
  markReady();
});

reloadButton.addEventListener('click', loadSite);
retryButton.addEventListener('click', loadSite);
openTabButton.addEventListener('click', openInTab);
fallbackOpenButton.addEventListener('click', openInTab);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SITE_KEY]) {
    const next = changes[SITE_KEY].newValue;
    if (next && next !== currentSite?.id) applySite(next);
  }
  if (area === 'session' && changes[THEME_KEY]) {
    applyTheme(changes[THEME_KEY].newValue);
  }
});

async function init() {
  await loadTheme();
  const siteId = await loadSelectedSiteId();
  applySite(siteId);
}

void init();
