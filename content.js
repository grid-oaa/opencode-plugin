(() => {
  'use strict';

  // 防止扩展重复注入时出现两个导航栏
  if (globalThis.__ocPromptNavLoaded) return;
  globalThis.__ocPromptNavLoaded = true;

  const HOST_ID = 'oc-prompt-nav-host';
  const SESSION_RE = /^\/server\/[^/]+\/session\/([^/?#]+)/;
  const MESSAGE_HASH_RE = /^#message-(.+)$/;
  const PAGE_SIZE = 200;
  const TAIL_SIZE = 10;
  const POLL_INTERVAL = 10000;
  const ROUTE_INTERVAL = 500;
  const TAIL_DEBOUNCE = 500;
  const HTTP_TIMEOUT = 15000;
  const JUMP_LOAD_TIMEOUT = 10000;
  const JUMP_SEARCH_TIMEOUT = 6000;
  const LOG_PREFIX = '[OC Prompt Nav]';

  const CSS = `
    :host {
      position: fixed;
      inset: 0;
      z-index: 40;
      display: block;
      pointer-events: none;
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    .rail {
      position: fixed;
      right: 12px;
      top: 50%;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0;
      width: 58px;
      max-height: 70vh;
      padding: 4px 0;
      overflow-x: hidden;
      overflow-y: auto;
      pointer-events: auto;
      scrollbar-width: none;
      outline: none;
      transform: translateY(-50%);
      z-index: 3;
      animation: oc-pn-rail-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    @keyframes oc-pn-rail-in {
      from {
        opacity: 0;
        transform: translate(6px, -50%);
      }
      to {
        opacity: 1;
        transform: translate(0, -50%);
      }
    }

    .rail::-webkit-scrollbar {
      display: none;
    }

    .rail[hidden] {
      display: none;
    }

    .rail:focus-visible {
      border-radius: 6px;
      outline: 2px solid var(--v2-border-border-focus, #3b82f6);
      outline-offset: 4px;
    }

    .item {
      all: unset;
      position: relative;
      display: block;
      flex: 0 0 auto;
      width: 58px;
      height: 18px;
      cursor: pointer;
    }

    .item::before {
      content: '';
      position: absolute;
      top: 50%;
      right: 6px;
      width: 18px;
      height: 3px;
      border-radius: 2px;
      background: rgba(128, 128, 128, 0.22);
      background: color-mix(in srgb, var(--v2-text-text-base, #111) 18%, transparent);
      transform: translateY(-50%);
      transition:
        right 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        width 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        background-color 140ms ease,
        opacity 140ms ease;
    }

    .item:hover::before,
    .item:focus-visible::before {
      width: 26px;
      background: rgba(128, 128, 128, 0.45);
      background: color-mix(in srgb, var(--v2-text-text-base, #111) 42%, transparent);
    }

    .item[data-active='true']::before {
      right: 0;
      width: 32px;
      height: 3px;
      background: var(--v2-text-text-base, #111);
    }

    .item[data-active='true']:hover::before {
      right: 0;
      width: 32px;
      background: var(--v2-text-text-base, #111);
    }

    .item[data-jumping='true']::before {
      right: 0;
      width: 32px;
      background: var(--v2-text-text-base, #111);
      animation: oc-pn-jump-pulse 800ms ease-in-out infinite;
    }

    @keyframes oc-pn-jump-pulse {
      0%,
      100% {
        opacity: 0.3;
      }
      50% {
        opacity: 1;
      }
    }

    .item:active::before {
      opacity: 0.6;
      transition-duration: 80ms;
    }

    .item:focus-visible::before {
      box-shadow:
        0 0 0 2px var(--v2-background-bg-base, #fff),
        0 0 0 3px var(--v2-border-border-focus, #3b82f6);
    }

    .preview {
      position: fixed;
      right: 52px;
      width: min(420px, calc(100vw - 120px));
      padding: 14px 16px;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-strong, rgba(128, 128, 128, 0.25)) 14%,
          transparent
        );
      border-radius: 16px;
      background: var(--v2-background-bg-layer-01, #fff);
      box-shadow: var(--v2-elevation-floating, 0 10px 30px rgba(0, 0, 0, 0.14));
      color: var(--v2-text-text-base, #111);
      font: 13px/1.55 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      pointer-events: none;
      z-index: 4;
      opacity: 0;
      visibility: hidden;
      transform: translateY(-2px) scale(0.99);
      transform-origin: right center;
      transition:
        top 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
        opacity 140ms ease,
        transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        visibility 0s linear 160ms;
    }

    .preview[data-open='true'] {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
      transition:
        top 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
        opacity 140ms ease,
        transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        visibility 0s;
    }

    .preview .text {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      color: var(--v2-text-text-muted, #666);
      font-size: 13px;
      line-height: 1.6;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      max-width: min(460px, calc(100vw - 48px));
      padding: 8px 14px;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-strong, rgba(128, 128, 128, 0.25)) 18%,
          transparent
        );
      border-radius: 10px;
      background: var(--v2-background-bg-layer-01, #fff);
      box-shadow: var(--v2-elevation-raised, 0 6px 18px rgba(0, 0, 0, 0.12));
      color: var(--v2-text-text-base, #111);
      font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      text-align: center;
      pointer-events: none;
      z-index: 5;
      opacity: 0;
      visibility: hidden;
      transform: translate(-50%, 6px);
      transition:
        opacity 140ms ease,
        transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        visibility 0s linear 160ms;
    }

    .toast[data-open='true'] {
      opacity: 1;
      visibility: visible;
      transform: translate(-50%, 0);
      transition:
        opacity 140ms ease,
        transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        visibility 0s;
    }

    .jump-overlay {
      position: fixed;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: var(--v2-background-bg-base, #fff);
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition:
        opacity 120ms ease,
        visibility 0s linear 120ms;
    }

    .jump-overlay[data-open='true'] {
      opacity: 1;
      visibility: visible;
      transition:
        opacity 120ms ease,
        visibility 0s;
    }

    .jump-status {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--v2-text-text-muted, #666);
      font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    }

    .jump-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid
        color-mix(
          in srgb,
          var(--v2-text-text-muted, #666) 24%,
          transparent
        );
      border-top-color: var(--v2-text-text-muted, #666);
      border-radius: 50%;
      animation: oc-pn-spin 700ms linear infinite;
    }

    @keyframes oc-pn-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .rail,
      .item::before,
      .preview,
      .toast {
        animation: none;
        transition: none;
      }

      .jump-spinner {
        animation-duration: 1400ms;
      }
    }
  `;

  const OPTIMIZE_CSS = `
    .oc-pn-optimize {
      margin-right: 4px;
    }

    .oc-pn-optimize[data-status='loading'] {
      cursor: progress;
    }

    .oc-pn-optimize[data-status='loading']:disabled {
      opacity: 0.75;
    }

    .oc-pn-optimize[data-status='error'] {
      outline: 2px solid #c0392b;
      outline-offset: 2px;
    }

    .oc-pn-optimize-spinner {
      display: block;
      width: 16px;
      height: 16px;
      border: 1.5px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: oc-pn-optimize-spin 0.8s linear infinite;
    }

    @keyframes oc-pn-optimize-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .oc-pn-optimize-spinner {
        animation-duration: 1.6s;
      }
    }
  `;

  const OPTIMIZE_ICONS = {
    idle: `<svg data-slot="icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    loading: `<span class="oc-pn-optimize-spinner" aria-hidden="true"></span>`,
    optimized: `<svg data-slot="icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 14 4 9l5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    error: `<svg data-slot="icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  };

  const OPTIMIZE_INSTRUCTION = [
    'You are a prompt editor for the next user message.',
    'Rewrite the text inside <draft> so it is clear, specific, and logically structured.',
    'You may reorganize sentences and use short paragraphs or lists only to organize the existing content.',
    'Work only from the draft. Do not answer the draft, and do not add requirements, facts, steps, or context that are not present in the draft.',
    'Keep every placeholder matching [[OC_MENTION_N]] exactly as-is, exactly once, and in a natural position.',
    'Do not wrap placeholders in quotes, backticks, or code blocks.',
    'Do not call any tools.',
    'Output only the rewritten prompt; no explanations or prefixes.',
  ].join('\n');
  const OPTIMIZE_TIMEOUT = 60000;

  const state = {
    sessionID: null,
    items: [],
    itemIDs: new Set(),
    activeID: null,
    host: null,
    shadow: null,
    rail: null,
    preview: null,
    previewText: null,
    buttons: new Map(),
    scroller: null,
    observedScroller: null,
    observer: null,
    routeTimer: 0,
    pollTimer: 0,
    tailTimer: 0,
    tailAbort: null,
    tailLoading: false,
    loadAbort: null,
    activeFrame: 0,
    previewTimer: 0,
    lastTailError: null,
    selectionLock: null,
    jumpToken: 0,
    jumpingID: null,
    ignoreUserIntent: false,
    toast: null,
    toastTimer: 0,
    jumpOverlay: null,
  };

  function log(...args) {
    console.info(LOG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  /** 判断当前页面是否为 opencode pair 的 Web 界面，避免注入到其他 localhost 页面。 */
  function isOpenCodePage() {
    if (parseSessionID()) return true;
    return !!document.querySelector('script#oc-theme-preload-script, title[data-sm]');
  }

  /** 从地址栏解析当前会话 ID。 */
  function parseSessionID() {
    const match = location.pathname.match(SESSION_RE);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  /** 发送同源 API 请求，失败时抛出带状态码的错误。 */
  async function api(path, signal) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HTTP_TIMEOUT);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const requestURL = new URL(path, location.origin).toString();
      const response = await fetch(requestURL, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });

      if (response.status === 401) throw new Error('UNAUTHORIZED');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('UNAUTHORIZED');
      return await response.json();
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** 发送同源 POST JSON 请求，用于一次性的提示词优化。 */
  async function postJSON(path, body, signal) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), OPTIMIZE_TIMEOUT);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const requestURL = new URL(path, location.origin).toString();
      const response = await fetch(requestURL, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 401) throw new Error('UNAUTHORIZED');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('UNAUTHORIZED');
      return await response.json();
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** 读取会话详情，用于获取 revert.messageID。 */
  async function fetchSessionDetail(sessionID, signal) {
    const json = await api(`/api/session/${encodeURIComponent(sessionID)}`, signal);
    return json?.data ?? null;
  }

  /** 分页读取会话中的全部 user 消息。 */
  async function fetchUserMessages(sessionID, signal) {
    const base = `/api/session/${encodeURIComponent(sessionID)}/message`;
    let url = `${base}?type=user&limit=${PAGE_SIZE}&order=asc`;
    const collected = [];

    for (let page = 0; page < 25; page += 1) {
      const json = await api(url, signal);
      const data = Array.isArray(json?.data) ? json.data : [];
      collected.push(...data);

      const next = json?.cursor?.next;
      if (!next || data.length === 0) break;
      url = `${base}?type=user&limit=${PAGE_SIZE}&cursor=${encodeURIComponent(next)}`;
    }

    const result = [];
    const seen = new Set();
    for (const raw of collected) {
      if (!raw || raw.type !== 'user' || typeof raw.id !== 'string') continue;
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      result.push(raw);
    }
    return result;
  }

  /** 读取最新的一小段 user 消息，用于增量刷新。 */
  async function fetchUserTail(sessionID, signal) {
    const json = await api(
      `/api/session/${encodeURIComponent(sessionID)}/message?type=user&limit=${TAIL_SIZE}&order=desc`,
      signal,
    );
    return Array.isArray(json?.data) ? json.data : [];
  }

  /** 把接口消息转换为导航栏需要的精简结构。 */
  function normalizeMessage(raw) {
    if (!raw || typeof raw.id !== 'string') return null;

    const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
    const displayText =
      typeof metadata.displayText === 'string' && metadata.displayText.trim()
        ? metadata.displayText
        : typeof raw.text === 'string'
          ? raw.text
          : '';

    const files = Array.isArray(raw.files) ? raw.files : [];
    const fileText = files.length
      ? `[附件] ${files
          .map((file) => (file && (file.name || file.filename)) || '文件')
          .join('、')}`
      : '';

    const rawText = displayText.trim() || fileText || '(空消息)';
    const compact = rawText.replace(/\s+/g, ' ').trim() || '(空消息)';
    const preview = compact.length > 140 ? `${compact.slice(0, 140)}…` : compact;

    return {
      id: raw.id,
      display: compact,
      preview,
    };
  }

  /** 按消息 ID 升序排列，与 OpenCode 时间线的顺序保持一致。 */
  function compareItems(left, right) {
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  }

  /** 创建 Shadow DOM 导航界面。 */
  function ensureUI() {
    if (state.host && document.contains(state.host)) return;

    const oldHost = document.getElementById(HOST_ID);
    if (oldHost) oldHost.remove();

    const host = document.createElement('div');
    host.id = HOST_ID;

    const shadow = host.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
    }

    const rail = document.createElement('div');
    rail.className = 'rail';
    rail.hidden = true;
    rail.tabIndex = 0;
    rail.setAttribute('role', 'navigation');
    rail.setAttribute('aria-label', '提问导航：上下方向键选择，回车跳转');
    rail.addEventListener('scroll', hidePreviewSoon, { passive: true });
    rail.addEventListener('keydown', onRailKeyDown);

    const preview = document.createElement('div');
    preview.className = 'preview';
    preview.dataset.open = 'false';
    const previewText = document.createElement('div');
    previewText.className = 'text';
    preview.append(previewText);

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.open = 'false';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const overlay = document.createElement('div');
    overlay.className = 'jump-overlay';
    overlay.dataset.open = 'false';
    const overlayStatus = document.createElement('div');
    overlayStatus.className = 'jump-status';
    const overlaySpinner = document.createElement('span');
    overlaySpinner.className = 'jump-spinner';
    const overlayLabel = document.createElement('span');
    overlayLabel.textContent = '正在定位提问…';
    overlayStatus.append(overlaySpinner, overlayLabel);
    overlay.append(overlayStatus);

    shadow.append(rail, preview, overlay, toast);
    document.body.appendChild(host);

    state.host = host;
    state.shadow = shadow;
    state.rail = rail;
    state.preview = preview;
    state.previewText = previewText;
    state.jumpOverlay = overlay;
    state.toast = toast;

    log('导航界面已创建');
  }

  /** 清空导航栏并隐藏预览。 */
  function resetRail() {
    if (!state.rail) return;
    state.rail.textContent = '';
    state.rail.hidden = true;
    state.buttons.clear();
    hidePreview();
  }

  /** 根据当前消息列表重新渲染 dash rail。 */
  function renderRail() {
    ensureUI();
    if (!state.rail) return;

    hidePreview();
    state.rail.textContent = '';
    state.buttons.clear();
    state.itemIDs = new Set(state.items.map((item) => item.id));

    if (state.items.length === 0) {
      state.rail.hidden = true;
      return;
    }

    const fragment = document.createDocumentFragment();
    state.items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'item';
      button.tabIndex = -1;
      button.dataset.id = item.id;
      button.setAttribute(
        'aria-label',
        `第 ${index + 1} 条提问：${item.display.slice(0, 100)}`,
      );
      button.addEventListener('click', () => jumpTo(item.id));
      button.addEventListener('pointerenter', () => showPreview(item.id, button));
      button.addEventListener('focus', () => showPreview(item.id, button));
      button.addEventListener('pointerleave', hidePreviewSoon);
      button.addEventListener('blur', hidePreviewSoon);
      fragment.appendChild(button);
      state.buttons.set(item.id, button);
    });

    state.rail.appendChild(fragment);
    state.rail.hidden = false;

    if (!state.activeID || !state.buttons.has(state.activeID)) {
      state.activeID = state.items[state.items.length - 1]?.id ?? null;
    }
    setActive(state.activeID, false);

    window.requestAnimationFrame(() => {
      scrollActiveIntoView();
      scheduleActiveUpdate();
    });

    log('导航栏已渲染', { count: state.items.length });
  }

  /** 更新当前高亮的提问，并可选地滚动 rail。 */
  function setActive(id, shouldScroll) {
    if (!id) return;
    const next = state.buttons.get(id);
    if (!next) return;

    if (state.activeID === id && next.dataset.active === 'true') {
      if (shouldScroll) scrollActiveIntoView();
      return;
    }

    const previous = state.buttons.get(state.activeID);
    if (previous) delete previous.dataset.active;

    state.activeID = id;
    next.dataset.active = 'true';

    if (shouldScroll) scrollActiveIntoView();
  }

  /** 确保 active dash 在 rail 的可视区域内。 */
  function scrollActiveIntoView() {
    if (!state.rail || state.rail.hidden) return;
    const button = state.buttons.get(state.activeID);
    if (!button) return;

    const railRect = state.rail.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const margin = 6;

    if (buttonRect.top < railRect.top + margin) {
      state.rail.scrollTop -= railRect.top + margin - buttonRect.top;
    } else if (buttonRect.bottom > railRect.bottom - margin) {
      state.rail.scrollTop += buttonRect.bottom - railRect.bottom + margin;
    }
  }

  /** 鼠标进入横条后延迟展示预览，避免快速划过时闪烁。 */
  function showPreview(id, button) {
    if (!state.preview || !button) return;
    window.clearTimeout(state.previewTimer);

    // 预览已经打开时直接切换内容，保持滑动连续；否则稍作延迟再出现
    const delay = state.preview.dataset.open === 'true' ? 0 : 70;
    state.previewTimer = window.setTimeout(() => openPreview(id, button), delay);
  }

  /** 填充并展示预览卡，内容统一为一段简短摘要。 */
  function openPreview(id, button) {
    if (!state.preview || !button) return;
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) return;

    const item = state.items[index];
    state.previewText.textContent = item.preview;

    const buttonRect = button.getBoundingClientRect();
    const previewHeight = state.preview.offsetHeight;
    const top = Math.max(
      12,
      Math.min(
        window.innerHeight - previewHeight - 12,
        buttonRect.top + buttonRect.height / 2 - previewHeight / 2,
      ),
    );
    state.preview.style.top = `${top}px`;
    state.preview.dataset.open = 'true';
  }

  /** 延迟隐藏预览，避免鼠标短暂移出时闪烁。 */
  function hidePreviewSoon() {
    window.clearTimeout(state.previewTimer);
    state.previewTimer = window.setTimeout(hidePreview, 140);
  }

  /** 隐藏预览卡，保留 DOM 以便淡出过渡。 */
  function hidePreview() {
    window.clearTimeout(state.previewTimer);
    if (state.preview) state.preview.dataset.open = 'false';
  }

  /** 方向键在 rail 内切换提问，回车跳转。 */
  function onRailKeyDown(event) {
    if (!state.items.length) return;

    if (event.key === 'Enter' && event.target === state.rail) {
      event.preventDefault();
      if (state.activeID) jumpTo(state.activeID);
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    state.selectionLock = null;

    const current = state.items.findIndex((item) => item.id === state.activeID);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = Math.max(
      0,
      Math.min(state.items.length - 1, (current < 0 ? 0 : current) + delta),
    );
    const next = state.items[nextIndex];
    if (!next) return;

    setActive(next.id, true);
    const button = state.buttons.get(next.id);
    if (button) {
      button.focus({ preventScroll: true });
      showPreview(next.id, button);
    }
  }

  /** 等待指定毫秒。 */
  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /** 等待虚拟列表完成一次渲染更新；后台标签页 rAF 暂停时用定时器兜底。 */
  function nextFrame() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
      window.setTimeout(finish, 150);
    });
  }

  /** 计算时间线可滚动的最大位置。 */
  function maxScrollTop(scroller) {
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  /** 查找消息对应的已渲染时间线行；压缩摘要行没有 message-<id> 锚点。 */
  function findMessageRow(id) {
    const anchor = document.getElementById(`message-${id}`);
    if (anchor) return anchor;
    // 不能依赖 CSS.escape：OpenCode 页面里的全局 CSS 可能被覆盖
    for (const row of document.querySelectorAll(
      '[data-timeline-row][data-message-id]',
    )) {
      if (row.dataset.messageId === id) return row;
    }
    return null;
  }

  /** 返回提问在 rail 列表中的顺序，找不到时返回 -1。 */
  function findItemIndex(id) {
    return state.items.findIndex((item) => item.id === id);
  }

  /** 返回时间线中已渲染的用户提问顺序。 */
  function renderedUserIndexes(scroller) {
    const indexes = [];
    for (const row of scroller.querySelectorAll(
      '[data-timeline-row="UserMessage"][data-message-id]',
    )) {
      const index = findItemIndex(row.dataset.messageId);
      if (index >= 0) indexes.push(index);
    }
    return indexes;
  }

  /** 派发一次向上滚轮事件，取消 OpenCode 的自动跟随。 */
  function unpinTimeline(scroller) {
    state.ignoreUserIntent = true;
    try {
      scroller.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -120,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    } catch (error) {
      warn('取消时间线自动跟随失败', error);
    } finally {
      state.ignoreUserIntent = false;
    }
  }

  /** 设置正在跳转的横条，显示脉冲反馈。 */
  function setJumping(id) {
    state.jumpingID = id;
    for (const [itemID, button] of state.buttons) {
      if (itemID === id) {
        button.dataset.jumping = 'true';
      } else {
        delete button.dataset.jumping;
      }
    }
  }

  /** 展示短暂的提示信息。 */
  function showToast(text) {
    if (!state.toast) return;
    state.toast.textContent = text;
    state.toast.dataset.open = 'true';
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      state.toastTimer = 0;
      if (state.toast) state.toast.dataset.open = 'false';
    }, 2600);
  }

  /** 隐藏提示信息。 */
  function hideToast() {
    window.clearTimeout(state.toastTimer);
    state.toastTimer = 0;
    if (state.toast) state.toast.dataset.open = 'false';
  }

  /** 读取时间线所在面板的背景色，避免遮罩与主题不一致。 */
  function resolveTimelineBackground(element) {
    let node = element;
    while (node && node !== document.documentElement) {
      const color = window.getComputedStyle(node).backgroundColor;
      if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
        return color;
      }
      node = node.parentElement;
    }
    return window.getComputedStyle(document.body).backgroundColor || '#fff';
  }

  /** 把跳转遮罩定位到时间线视口，保留顶部会话标题。 */
  function positionJumpOverlay(scroller) {
    const overlay = state.jumpOverlay;
    if (!overlay || !scroller) return;

    const rect = scroller.getBoundingClientRect();
    const header = scroller.querySelector('[data-session-title]');
    const headerHeight = header instanceof HTMLElement ? header.offsetHeight : 0;
    overlay.style.left = `${Math.round(rect.left)}px`;
    overlay.style.top = `${Math.round(rect.top + headerHeight)}px`;
    overlay.style.width = `${Math.round(rect.width)}px`;
    overlay.style.height = `${Math.max(0, Math.round(rect.height - headerHeight))}px`;
    overlay.style.background = resolveTimelineBackground(scroller);
  }

  /** 显示跳转遮罩，隐藏中间的滚动和虚拟列表刷新。 */
  function showJumpOverlay(scroller) {
    const overlay = state.jumpOverlay;
    if (!overlay) return;
    positionJumpOverlay(scroller);
    overlay.dataset.open = 'true';
  }

  /** 隐藏跳转遮罩。 */
  function hideJumpOverlay() {
    if (state.jumpOverlay) state.jumpOverlay.dataset.open = 'false';
  }

  /** 滚动到指定位置；如果被自动跟随拉回，则重新取消跟随。 */
  async function scrollTimeline(scroller, top) {
    const next = Math.max(0, Math.min(maxScrollTop(scroller), Math.round(top)));
    scroller.scrollTop = next;
    await nextFrame();
    if (Math.abs(scroller.scrollTop - next) > 4) {
      unpinTimeline(scroller);
      scroller.scrollTop = next;
      await nextFrame();
    }
  }

  /** 在当前位置附近小范围查找目标行。 */
  async function quickSearchMessage(scroller, id, token) {
    let row = findMessageRow(id);
    if (row) return row;

    const step = Math.max(240, Math.round(scroller.clientHeight * 0.75));
    const origin = scroller.scrollTop;
    const seen = new Set();

    for (let i = 0; i < 8; i++) {
      if (token !== state.jumpToken) return null;
      const distance = Math.ceil((i + 1) / 2) * step;
      const top = origin + (i % 2 === 0 ? 1 : -1) * distance;
      const clamped = Math.max(0, Math.min(maxScrollTop(scroller), Math.round(top)));
      if (seen.has(clamped)) continue;
      seen.add(clamped);
      await scrollTimeline(scroller, clamped);
      row = findMessageRow(id);
      if (row) return row;
    }
    return null;
  }

  /** 向上加载更早的历史，直到目标消息渲染或已经到达加载范围。 */
  async function loadUntilMessage(scroller, id, index, token) {
    let row = findMessageRow(id);
    if (row) return { row, earliest: null };

    const startedAt = Date.now();
    let lastHeight = scroller.scrollHeight;
    let lastGrowth = Date.now();
    let earliest = null;

    for (let i = 0; i < 600; i++) {
      if (token !== state.jumpToken) return { row: null, earliest };
      if (Date.now() - startedAt > JUMP_LOAD_TIMEOUT) break;

      // 连续贴住顶部，OpenCode 会在每次加载完成后继续加载上一页
      // 会话输出过程中它可能重新跟随底部，定期再取消一次
      if (i % 12 === 0) unpinTimeline(scroller);
      scroller.scrollTop = 0;
      await delay(40);

      row = findMessageRow(id);
      if (row) return { row, earliest };

      if (i % 4 !== 0) continue;
      const height = scroller.scrollHeight;
      if (height !== lastHeight) {
        lastHeight = height;
        lastGrowth = Date.now();
      }

      const indexes = renderedUserIndexes(scroller);
      if (indexes.length) earliest = Math.min(...indexes);
      if (index >= 0 && earliest !== null && earliest <= index) break;
      if (Date.now() - lastGrowth > 4000 && i > 8) break;
    }

    return { row: findMessageRow(id), earliest };
  }

  /** 按提问在会话中的大致比例估算位置，再向两侧搜索目标行。 */
  async function searchMessageByEstimate(scroller, id, index, earliest, token) {
    let row = findMessageRow(id);
    if (row) return row;

    const total = state.items.length;
    const startIndex = Math.max(0, earliest ?? 0);
    const span = Math.max(1, total - startIndex);
    const ratio =
      index >= 0 && total > 0
        ? Math.max(0, Math.min(1, (index - startIndex + 0.5) / span))
        : 0.5;
    const estimate = Math.round(maxScrollTop(scroller) * ratio);
    const step = Math.max(260, Math.round(scroller.clientHeight * 0.8));
    const seen = new Set();
    const startedAt = Date.now();

    for (let i = 0; i < 160; i++) {
      if (token !== state.jumpToken) return null;
      if (Date.now() - startedAt > JUMP_SEARCH_TIMEOUT) break;

      const distance = Math.ceil(i / 2) * step;
      if (
        i > 0 &&
        estimate - distance < 0 &&
        estimate + distance > maxScrollTop(scroller)
      ) {
        break;
      }

      const top =
        i === 0 ? estimate : estimate + (i % 2 === 1 ? -distance : distance);
      const clamped = Math.max(0, Math.min(maxScrollTop(scroller), Math.round(top)));
      if (seen.has(clamped)) continue;
      seen.add(clamped);

      await scrollTimeline(scroller, clamped);
      row = findMessageRow(id);
      if (row) return row;
    }
    return null;
  }

  /** 判断目标行是否已对齐；已到时间线底部时只要目标可见即可。 */
  function isMessageAligned(scroller, row) {
    const header = scroller.querySelector('[data-session-title]');
    const headerHeight = header instanceof HTMLElement ? header.offsetHeight : 0;
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top = scrollerRect.top + headerHeight;
    if (Math.abs(rowRect.top - top) <= 2) return true;
    if (scroller.scrollTop >= maxScrollTop(scroller) - 1) {
      return rowRect.top >= top - 2 && rowRect.top < scrollerRect.bottom;
    }
    return false;
  }

  /** 精确对齐目标行，扣除顶部 sticky 会话标题的高度。 */
  async function alignMessage(scroller, id, token) {
    for (let i = 0; i < 4; i++) {
      if (token !== state.jumpToken) return false;
      const row = findMessageRow(id);
      if (!row) return false;

      const header = scroller.querySelector('[data-session-title]');
      const headerHeight = header instanceof HTMLElement ? header.offsetHeight : 0;
      const scrollerRect = scroller.getBoundingClientRect();
      const delta =
        row.getBoundingClientRect().top -
        scrollerRect.top +
        scroller.scrollTop -
        headerHeight;

      scroller.scrollTop = Math.max(
        0,
        Math.min(maxScrollTop(scroller), Math.round(delta)),
      );
      await nextFrame();
      await delay(50);

      const nextRow = findMessageRow(id);
      if (!nextRow) return false;
      if (isMessageAligned(scroller, nextRow)) return true;
    }

    const row = findMessageRow(id);
    return row ? isMessageAligned(scroller, row) : false;
  }

  /** 把地址栏同步到目标消息；不派发 popstate，避免 OpenCode 再次接管滚动。 */
  function updateMessageHash(id) {
    const hash = `#message-${id}`;
    if (location.hash === hash) return;
    try {
      history.replaceState(history.state, '', location.pathname + location.search + hash);
    } catch (error) {
      warn('更新地址栏失败', error);
    }
  }

  /** 跳转到指定提问。 */
  async function jumpTo(id) {
    if (!id) return;

    const token = ++state.jumpToken;
    // 锁定用户主动选择，直到用户再次滚动时间线或使用方向键
    state.selectionLock = id;
    setActive(id, true);
    setJumping(id);

    const scroller = ensureScroller();
    if (!scroller) {
      setJumping(null);
      showToast('当前页面没有可跳转的会话时间线');
      return;
    }

    try {
      // 先取消 OpenCode 的自动跟随，否则滚动会被拉回底部
      unpinTimeline(scroller);
      state.selectionLock = id;
      setActive(id, false);
      await nextFrame();
      if (token !== state.jumpToken) return;

      const index = findItemIndex(id);
      let row = findMessageRow(id);
      if (!row) {
        // 目标不可见时后续会搜索或加载历史，用遮罩盖住中间滚动过程
        showJumpOverlay(scroller);
        row = await quickSearchMessage(scroller, id, token);
      }

      let earliest = null;
      if (!row) {
        const loaded = await loadUntilMessage(scroller, id, index, token);
        row = loaded.row;
        earliest = loaded.earliest;
      }

      if (!row) {
        row = await searchMessageByEstimate(scroller, id, index, earliest, token);
      }

      if (token !== state.jumpToken) return;
      if (!row) {
        showToast('该提问不在当前会话时间线中，无法定位');
        warn('跳转失败：时间线中找不到目标消息', id);
        return;
      }

      let aligned = await alignMessage(scroller, id, token);
      if (token !== state.jumpToken) return;

      // 虚拟列表高度变化导致目标行被回收时，重新定位一次
      if (!aligned) {
        row = await searchMessageByEstimate(scroller, id, index, earliest, token);
        if (row) aligned = await alignMessage(scroller, id, token);
        if (token !== state.jumpToken) return;
      }

      updateMessageHash(id);
      if (!aligned) warn('跳转位置未能完全对齐', id);

      // 会话压缩后，触发压缩的提问会被压缩摘要行替代，没有原始 user 消息锚点
      if (!document.getElementById(`message-${id}`)) {
        showToast('该提问位于会话压缩前，已定位到压缩摘要');
      }

      log('跳转到提问完成', {
        id,
        scrollTop: Math.round(scroller.scrollTop),
        aligned,
      });
    } catch (error) {
      if (token === state.jumpToken) {
        warn('跳转提问失败', error);
        showToast('跳转失败，请重试');
      }
    } finally {
      if (token === state.jumpToken) {
        setJumping(null);
        hideJumpOverlay();
      }
    }
  }

  /** 从地址栏 hash 同步 active 状态。 */
  function applyHashActive() {
    const match = location.hash.match(MESSAGE_HASH_RE);
    if (!match) return;
    let id = match[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // 保留原始值
    }
    if (state.buttons.has(id)) setActive(id, true);
  }

  /** 找到包含时间线虚拟内容的滚动容器。 */
  function findScroller() {
    const anchor = document.querySelector('[data-timeline-virtual-content]');
    let element = anchor;
    while (element && element !== document.documentElement) {
      const style = window.getComputedStyle(element);
      if (/(auto|scroll)/.test(style.overflowY)) return element;
      element = element.parentElement;
    }
    return anchor ? anchor.parentElement : null;
  }

  /** 查找并绑定当前会话的滚动容器。 */
  function ensureScroller() {
    let scroller = state.scroller;
    if (!scroller || !document.contains(scroller)) {
      scroller = findScroller();
      state.scroller = scroller;
    }
    if (scroller) bindTimeline(scroller);
    return scroller;
  }

  /** 绑定时间线滚动和 DOM 变化监听。 */
  function bindTimeline(scroller) {
    if (!scroller || state.observedScroller === scroller) return;

    if (state.observedScroller) {
      state.observedScroller.removeEventListener('scroll', onTimelineScroll);
    }

    state.observedScroller = scroller;
    scroller.addEventListener('scroll', onTimelineScroll, { passive: true });
    scroller.addEventListener('wheel', onUserScrollIntent, { passive: true });
    scroller.addEventListener('touchmove', onUserScrollIntent, { passive: true });
    scroller.addEventListener('pointerdown', onUserScrollIntent, { passive: true });

    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver(onTimelineMutation);
    state.observer.observe(scroller, { childList: true, subtree: true });

    log('已绑定会话时间线');
    scheduleActiveUpdate();
  }

  /** 时间线滚动时更新 active 并隐藏预览。 */
  function onTimelineScroll() {
    hidePreviewSoon();
    scheduleActiveUpdate();
  }

  /** 用户主动滚动时间线时解除点击锁定。 */
  function onUserScrollIntent() {
    if (state.ignoreUserIntent) return;
    state.selectionLock = null;
    scheduleActiveUpdate();
  }

  /** 时间线节点变化时检查是否有新的用户提问。 */
  function onTimelineMutation(mutations) {
    let hasNewUserMessage = false;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;

        const direct = node.matches('[data-timeline-row="UserMessage"][data-message-id]')
          ? node
          : null;
        if (direct && !state.itemIDs.has(direct.dataset.messageId)) {
          hasNewUserMessage = true;
          break;
        }

        for (const row of node.querySelectorAll(
          '[data-timeline-row="UserMessage"][data-message-id]',
        )) {
          if (!state.itemIDs.has(row.dataset.messageId)) {
            hasNewUserMessage = true;
            break;
          }
        }

        if (hasNewUserMessage) break;
      }
      if (hasNewUserMessage) break;
    }

    if (hasNewUserMessage) scheduleTailRefresh();
    scheduleActiveUpdate();
  }

  /** 用 requestAnimationFrame 合并滚动事件。 */
  function scheduleActiveUpdate() {
    if (state.activeFrame) return;
    state.activeFrame = window.requestAnimationFrame(() => {
      state.activeFrame = 0;
      updateActiveFromScroll();
    });
  }

  /** 根据视口内已渲染的消息定位当前 active 提问。 */
  function updateActiveFromScroll() {
    const scroller = ensureScroller();
    if (!scroller || state.items.length === 0) return;

    // 用户刚点击过横条时保留其选择，不被滚动位置覆盖
    if (state.selectionLock) {
      if (state.buttons.has(state.selectionLock)) {
        setActive(state.selectionLock, false);
        return;
      }
      state.selectionLock = null;
    }

    // 已经在会话底部时直接选中最后一条，避免视口顶部还是上一轮回复导致选中倒数第二条
    const bottomGap = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    if (bottomGap <= 96) {
      const lastID = state.items[state.items.length - 1]?.id;
      if (lastID) {
        setActive(lastID, true);
        return;
      }
    }

    const rows = scroller.querySelectorAll('[data-message-id]');
    if (rows.length === 0) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const header = scroller.querySelector('[data-session-title]');
    const headerHeight = header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;
    const topLine = scrollerRect.top + headerHeight + 24;

    let anchorID = null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.top <= topLine) {
        anchorID = row.dataset.messageId || anchorID;
      } else {
        break;
      }
    }

    if (!anchorID) anchorID = rows[0]?.dataset.messageId;
    if (!anchorID) return;

    const activeID = findUserIDAtOrBefore(anchorID);
    if (activeID) setActive(activeID, true);
  }

  /** 在 user 消息列表中二分查找最后一个 id 不大于 anchorID 的项。 */
  function findUserIDAtOrBefore(anchorID) {
    let low = 0;
    let high = state.items.length - 1;
    let result = -1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      if (state.items[middle].id <= anchorID) {
        result = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (result >= 0) return state.items[result].id;
    return state.items[0]?.id ?? null;
  }

  const optimizeTasks = new Map();

  /** 获取当前会话对应的优化任务，不存在则创建。 */
  function getOptimizeTask(sessionID) {
    let task = optimizeTasks.get(sessionID);
    if (task) return task;

    task = {
      sessionID,
      status: 'idle',
      editor: null,
      actions: null,
      button: null,
      inputHandler: null,
      original: null,
      resultText: '',
      pendingTimer: 0,
      abort: null,
      writing: false,
      errorText: '',
      errorUntil: 0,
      errorTimer: 0,
    };
    optimizeTasks.set(sessionID, task);
    return task;
  }

  /** 判断元素当前是否可见，用于定位活动的 Composer。 */
  function isOptimizeVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  /** 注入提示词优化按钮的样式。 */
  function ensureOptimizeStyles() {
    const existing = document.getElementById('oc-pn-optimize-style');
    if (existing) {
      existing.textContent = OPTIMIZE_CSS;
      return;
    }
    const style = document.createElement('style');
    style.id = 'oc-pn-optimize-style';
    style.textContent = OPTIMIZE_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /** 找到当前活动的 Composer 操作栏和编辑器。 */
  function findActiveComposer() {
    const actionsList = [
      ...document.querySelectorAll('[data-slot="composer-actions"]'),
    ].filter(isOptimizeVisible);

    for (const actions of actionsList) {
      const form = actions.closest('form[data-component="composer"]');
      const editor = form?.querySelector('[data-component="composer-editor"]');
      if (editor && isOptimizeVisible(editor)) return { actions, editor, form };
    }
    return null;
  }

  /** 把当前会话任务绑定到活动的 Composer，不取消其他 tab 的任务。 */
  function bindOptimizeTask(task, composer) {
    if (task.editor !== composer.editor) {
      if (task.editor && task.inputHandler) {
        task.editor.removeEventListener('input', task.inputHandler);
      }
      task.editor = composer.editor;
      task.inputHandler = () => onOptimizeEditorInput(task);
      composer.editor.addEventListener('input', task.inputHandler);

      // 编辑器被重建时，无法保证原 mention 节点仍然有效，保守放弃撤回状态
      if (task.status === 'optimized') {
        task.status = 'idle';
        task.original = null;
      }
    }

    task.actions = composer.actions;
    ensureOptimizeStyles();

    let button = task.button;
    if (!button || !button.isConnected || button.parentElement !== composer.actions) {
      if (button) button.remove();
      button = createOptimizeButton(task);
      const submit = composer.actions.querySelector('[data-action="composer-submit"]');
      let submitWrapper = submit;
      while (submitWrapper && submitWrapper.parentElement !== composer.actions) {
        submitWrapper = submitWrapper.parentElement;
      }
      composer.actions.insertBefore(button, submitWrapper ?? composer.actions.firstChild);
      task.button = button;
    }

    button.dataset.optimizeSession = task.sessionID;
    if (task.status === 'ready' && task.resultText) schedulePendingApply(task);
    updateOptimizeButton(task);
  }

  /** 创建优化/撤回图标按钮。 */
  function createOptimizeButton(task) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'oc-pn-optimize size-7 rounded-md p-[6px]';
    button.dataset.action = 'composer-optimize';
    button.dataset.component = 'icon-button-v2';
    button.dataset.size = 'normal';
    button.dataset.variant = 'submit';
    button.dataset.status = 'idle';
    button.dataset.icon = 'idle';
    button.dataset.optimizeSession = task.sessionID;
    button.innerHTML = OPTIMIZE_ICONS.idle;

    button.title = '使用当前会话模型快速优化提示词';
    button.setAttribute('aria-label', '快速优化提示词');
    button.addEventListener('click', onOptimizeClick);

    return button;
  }

  /** 返回优化按钮当前不可用的原因。 */
  function optimizeDisabledReason(task) {
    const editor = task.editor;
    if (!editor || !editor.isConnected) return '输入框尚未就绪';
    const text = editor.innerText.trim();
    if (!text) return '输入内容后可优化提示词';
    if (isCommandDraft(text)) return '命令模式下不优化提示词';
    return '暂不可用';
  }

  /** 当前草稿是否满足优化条件。 */
  function canOptimizeDraft(task) {
    if (task.status === 'loading') return false;
    const editor = task.editor;
    if (!editor || !editor.isConnected) return false;
    const text = editor.innerText.trim();
    if (!text) return false;
    if (isCommandDraft(text)) return false;
    return true;
  }

  /** 更新指定任务按钮的图标、禁用状态和提示。 */
  function updateOptimizeButton(task) {
    const button = task.button;
    if (!button || !button.isConnected) return;

    let status = task.status;
    const editor = task.editor;
    if (status === 'optimized' && (!editor || !editor.isConnected || !editor.innerText.trim())) {
      task.status = 'idle';
      task.original = null;
      status = 'idle';
    }

    let disabled = false;
    let title = '使用当前会话模型快速优化提示词';
    let visualStatus = status;

    if (status === 'loading') {
      disabled = true;
      title = '正在快速优化提示词';
    } else if (status === 'ready') {
      disabled = true;
      title = '正在恢复优化结果';
      visualStatus = 'loading';
    } else if (status === 'optimized') {
      title = '撤回优化，恢复原文';
    } else if (Date.now() < task.errorUntil) {
      disabled = !canOptimizeDraft(task);
      title = task.errorText || '优化失败，请重试';
      visualStatus = 'error';
    } else {
      disabled = !canOptimizeDraft(task);
      title = disabled ? optimizeDisabledReason(task) : '使用当前会话模型快速优化提示词';
    }

    const iconKey =
      visualStatus === 'loading'
        ? 'loading'
        : visualStatus === 'optimized'
          ? 'optimized'
          : visualStatus === 'error'
            ? 'error'
            : 'idle';

    if (button.dataset.icon !== iconKey) {
      button.innerHTML = OPTIMIZE_ICONS[iconKey] ?? OPTIMIZE_ICONS.idle;
      button.dataset.icon = iconKey;
    }

    button.disabled = disabled;
    button.dataset.status = visualStatus;
    button.setAttribute('aria-label', title);
    button.setAttribute(
      'aria-busy',
      status === 'loading' || status === 'ready' ? 'true' : 'false',
    );
    button.title = title;
  }

  /** 指定任务的编辑器输入时刷新按钮状态。 */
  function onOptimizeEditorInput(task) {
    if (task.writing) {
      updateOptimizeButton(task);
      return;
    }

    if (task.errorUntil) {
      task.errorUntil = 0;
      task.errorText = '';
      window.clearTimeout(task.errorTimer);
      task.errorTimer = 0;
    }

    if (task.status === 'optimized') {
      const editor = task.editor;
      if (!editor || !editor.innerText.trim()) {
        task.status = 'idle';
        task.original = null;
      }
    }

    updateOptimizeButton(task);
  }

  /** 确保当前活动会话的 Composer 中存在优化按钮，同时保留其他 tab 的任务。 */
  function ensureOptimizeButton() {
    const sessionID = parseSessionID();
    if (!sessionID) return;

    const composer = findActiveComposer();
    if (!composer) return;

    bindOptimizeTask(getOptimizeTask(sessionID), composer);
  }

  /** 把编辑器拆成文本段和原始 mention 节点。 */
  function readEditorParts(editor) {
    const parts = [];
    const mentions = [];
    let text = '';

    const pushText = (value) => {
      if (!value) return;
      text += value;
      parts.push({ type: 'text', text: value });
    };

    const pushMention = (node) => {
      const token = `[[OC_MENTION_${mentions.length + 1}]]`;
      const mention = {
        type: node.dataset.mention || 'file',
        node,
        token,
        label: node.textContent || '',
      };
      mentions.push(mention);
      text += token;
      parts.push({ type: 'mention', ...mention });
    };

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        pushText(node.textContent || '');
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.dataset.mention) {
        pushMention(node);
        return;
      }
      if (node.tagName === 'BR') {
        pushText('\n');
        return;
      }
      Array.from(node.childNodes).forEach(walk);
    };

    Array.from(editor.childNodes).forEach((node, index, list) => {
      walk(node);
      if (
        node instanceof HTMLElement &&
        (node.tagName === 'DIV' || node.tagName === 'P') &&
        index < list.length - 1
      ) {
        pushText('\n');
      }
    });

    text = text.replace(/\u200B/g, '');
    const signature = [
      text,
      ...mentions.map((mention) =>
        [
          mention.token,
          mention.type,
          mention.label,
          mention.node.dataset.path || '',
          mention.node.dataset.name || '',
          mention.node.dataset.id || '',
          mention.node.dataset.filename || '',
          mention.node.dataset.mime || '',
        ].join('\u0001'),
      ),
    ].join('\u0000');

    return { text, parts, mentions, signature };
  }

  /** 判断草稿是否像斜杠命令。 */
  function isCommandDraft(text) {
    return /^\/[A-Za-z0-9_-]+(?:\s|$)/.test(text.trim());
  }

  /** 清理模型返回内容中的代码块、前缀和多余引号。 */
  function cleanOptimizedText(raw) {
    let text = String(raw || '').trim();
    text = text.replace(/^```[A-Za-z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
    text = text
      .replace(/^(?:优化后的?提示词|改写后的?提示词|优化结果|Prompt)\s*[:：]\s*/i, '')
      .trim();
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith('“') && text.endsWith('”'))
    ) {
      text = text.slice(1, -1).trim();
    }
    text = text.replace(/`(\[\[OC_MENTION_\d+\]\])`/g, '$1');
    return text;
  }

  /** 校验模型是否完整保留了所有 mention 占位符。 */
  function validateMentionTokens(text, snapshot) {
    const expected = snapshot.mentions.map((mention) => mention.token);
    const found = text.match(/\[\[OC_MENTION_\d+\]\]/g) || [];
    if (expected.length !== found.length) return false;
    const seen = new Set();
    for (const token of found) {
      if (!expected.includes(token) || seen.has(token)) return false;
      seen.add(token);
    }
    return expected.every((token) => seen.has(token));
  }

  /** 使用原始 mention 节点重建编辑器内容。 */
  function rebuildEditor(task, editor, snapshot, nextText) {
    const mentions = new Map(snapshot.mentions.map((mention) => [mention.token, mention.node]));
    const nodes = [];
    const pieces = nextText.split(/(\[\[OC_MENTION_\d+\]\])/g);

    for (const piece of pieces) {
      if (!piece) continue;
      if (/^\[\[OC_MENTION_\d+\]\]$/.test(piece)) {
        const node = mentions.get(piece);
        if (!node) throw new Error('UNKNOWN_MENTION');
        nodes.push(node);
      } else {
        nodes.push(document.createTextNode(piece));
      }
    }

    editor.replaceChildren(...nodes);
    task.writing = true;
    try {
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: nextText,
        }),
      );
    } finally {
      task.writing = false;
    }
  }

  /** 请求一次性的提示词优化结果（快速模式，不读取完整会话上下文）。 */
  async function requestOptimizedPrompt(sessionID, draft, signal) {
    const detail = await fetchSessionDetail(sessionID, signal);
    const model = detail?.model;
    if (!model || !model.id || !model.providerID) throw new Error('MODEL_UNAVAILABLE');

    const prompt = [OPTIMIZE_INSTRUCTION, '', '<draft>', draft, '</draft>'].join('\n');
    const json = await postJSON(
      '/api/experimental/generate/text',
      {
        prompt,
        // 快速模式不带 reasoning variant；提示词改写不需要深度推理
        model: { id: model.id, providerID: model.providerID },
      },
      signal,
    );
    const text = json?.data?.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('EMPTY_RESULT');
    return text;
  }

  /** 切回原会话后，等待草稿恢复并应用后台完成的优化结果。 */
  function schedulePendingApply(task) {
    if (task.pendingTimer) return;
    const startedAt = Date.now();

    const tick = () => {
      task.pendingTimer = 0;
      if (task.status !== 'ready') return;

      const editor = task.editor;
      if (!editor || !editor.isConnected) return;

      const current = readEditorParts(editor);
      if (!current.text.trim()) {
        if (Date.now() - startedAt < 2500) {
          task.pendingTimer = window.setTimeout(tick, 120);
        } else {
          task.status = 'idle';
          task.original = null;
          task.resultText = '';
          setOptimizeError(task, '会话草稿未恢复，优化结果已丢弃');
        }
        return;
      }

      applyPendingOptimize(task, current);
    };

    task.pendingTimer = window.setTimeout(tick, 0);
  }

  /** 把后台完成的优化结果应用到重新出现的编辑器。 */
  function applyPendingOptimize(task, current) {
    const editor = task.editor;
    const expected = task.original;
    const nextText = task.resultText;
    if (!editor || !editor.isConnected || !expected || !nextText) {
      task.status = 'idle';
      task.original = null;
      task.resultText = '';
      updateOptimizeButton(task);
      return;
    }

    if (current.signature !== expected.signature) {
      task.status = 'idle';
      task.original = null;
      task.resultText = '';
      setOptimizeError(task, '草稿已变化，优化结果已丢弃');
      return;
    }

    if (!validateMentionTokens(nextText, current)) {
      task.status = 'idle';
      task.original = null;
      task.resultText = '';
      setOptimizeError(task, '文件引用未能完整保留，已丢弃优化结果');
      return;
    }

    try {
      task.original = current;
      task.resultText = '';
      rebuildEditor(task, editor, current, nextText);
      task.status = 'optimized';
      updateOptimizeButton(task);
      log('后台优化结果已应用到切回的会话', { sessionID: task.sessionID });
    } catch (error) {
      task.status = 'idle';
      task.original = null;
      task.resultText = '';
      setOptimizeError(task, '恢复优化结果失败，请重试');
      warn('应用后台优化结果失败', { sessionID: task.sessionID, error });
    }
  }

  /** 展示指定任务短暂的优化失败状态。 */
  function setOptimizeError(task, message) {
    task.errorText = message;
    task.errorUntil = Date.now() + 3000;
    window.clearTimeout(task.errorTimer);
    task.errorTimer = window.setTimeout(() => {
      task.errorText = '';
      task.errorUntil = 0;
      task.errorTimer = 0;
      updateOptimizeButton(task);
    }, 3000);
    updateOptimizeButton(task);
  }

  /** 执行指定会话的提示词优化；切 tab 不会中断。 */
  async function optimizePrompt(task) {
    if (task.status === 'loading') return;
    const editor = task.editor;
    if (!editor || !editor.isConnected) return;
    if (!canOptimizeDraft(task)) {
      updateOptimizeButton(task);
      return;
    }

    const snapshot = readEditorParts(editor);
    const draft = snapshot.text.trim();
    if (!draft) return;
    const startedAt = Date.now();

    const controller = new AbortController();
    task.abort = controller;
    task.status = 'loading';
    task.original = snapshot;
    task.errorText = '';
    task.errorUntil = 0;
    window.clearTimeout(task.errorTimer);
    task.errorTimer = 0;
    updateOptimizeButton(task);
    log('开始优化提示词', {
      sessionID: task.sessionID,
      mode: 'fast',
      mentions: snapshot.mentions.length,
    });

    try {
      const raw = await requestOptimizedPrompt(task.sessionID, draft, controller.signal);
      if (controller.signal.aborted) return;

      const nextText = cleanOptimizedText(raw);
      if (!nextText) throw new Error('EMPTY_RESULT');
      if (!validateMentionTokens(nextText, snapshot)) throw new Error('MENTION_MISMATCH');

      const currentEditor = task.editor;
      if (!currentEditor || !currentEditor.isConnected) {
        // 原 tab 已经被切走，结果先保存，切回后再应用
        task.status = 'ready';
        task.resultText = nextText;
        log('优化完成，等待会话重新激活', {
          sessionID: task.sessionID,
          mode: 'fast',
          mentions: snapshot.mentions.length,
          elapsedMs: Date.now() - startedAt,
        });
        return;
      }

      const current = readEditorParts(currentEditor);
      if (!current.text.trim()) {
        task.status = 'idle';
        task.original = null;
        updateOptimizeButton(task);
        return;
      }
      if (current.signature !== snapshot.signature) {
        task.status = 'idle';
        task.original = null;
        setOptimizeError(task, '输入内容已变化，已取消本次优化');
        return;
      }

      const applySnapshot = currentEditor === editor ? snapshot : current;
      task.original = applySnapshot;
      rebuildEditor(task, currentEditor, applySnapshot, nextText);
      task.status = 'optimized';
      updateOptimizeButton(task);
      log('提示词优化完成', {
        sessionID: task.sessionID,
        mode: 'fast',
        mentions: snapshot.mentions.length,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      task.status = 'idle';
      task.original = null;
      const message =
        error instanceof Error && error.message === 'MENTION_MISMATCH'
          ? '文件引用未能完整保留，已取消优化'
          : error instanceof Error && error.message === 'EMPTY_RESULT'
            ? '模型未返回有效内容，请重试'
            : error instanceof Error && error.message === 'MODEL_UNAVAILABLE'
              ? '无法读取当前会话模型，请重试'
              : '优化失败，请重试';
      setOptimizeError(task, message);
      warn('提示词优化失败', {
        sessionID: task.sessionID,
        elapsedMs: Date.now() - startedAt,
        error,
      });
    } finally {
      if (task.abort === controller) task.abort = null;
    }
  }

  /** 撤回指定任务的优化，恢复原文。 */
  function undoOptimize(task) {
    const editor = task.editor;
    const original = task.original;
    if (!editor || !editor.isConnected || !original) return;
    try {
      rebuildEditor(task, editor, original, original.text);
      task.status = 'idle';
      task.original = null;
      updateOptimizeButton(task);
      log('已撤回提示词优化', { sessionID: task.sessionID });
    } catch (error) {
      warn('撤回提示词优化失败', { sessionID: task.sessionID, error });
    }
  }

  /** 根据按钮所属的 session 执行优化/撤回，不依赖当前活动路由。 */
  function onOptimizeClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    const sessionID = button?.dataset.optimizeSession;
    const task = sessionID ? optimizeTasks.get(sessionID) : null;
    if (!task) return;
    if (task.status === 'loading') return;
    if (task.status === 'ready') {
      schedulePendingApply(task);
      return;
    }
    if (task.status === 'optimized') {
      undoOptimize(task);
      return;
    }
    void optimizePrompt(task);
  }

  /** 页面关闭/刷新时中止所有优化任务。 */
  function abortAllOptimizeTasks() {
    for (const task of optimizeTasks.values()) {
      task.abort?.abort();
      window.clearTimeout(task.errorTimer);
      window.clearTimeout(task.pendingTimer);
      if (task.editor && task.inputHandler) {
        task.editor.removeEventListener('input', task.inputHandler);
      }
      task.button?.remove();
    }
    optimizeTasks.clear();
  }

  /** 停止当前会话相关的请求、定时器和监听。 */
  function stopSessionWork() {
    if (state.loadAbort) {
      state.loadAbort.abort();
      state.loadAbort = null;
    }
    if (state.tailAbort) {
      state.tailAbort.abort();
      state.tailAbort = null;
    }
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = 0;
    }
    window.clearTimeout(state.tailTimer);
    state.tailTimer = 0;

    if (state.activeFrame) {
      window.cancelAnimationFrame(state.activeFrame);
      state.activeFrame = 0;
    }
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (state.observedScroller) {
      state.observedScroller.removeEventListener('scroll', onTimelineScroll);
      state.observedScroller = null;
    }

    state.scroller = null;
    state.tailLoading = false;
    state.lastTailError = null;
    state.selectionLock = null;
    state.jumpToken += 1;
    state.jumpingID = null;
    state.ignoreUserIntent = false;
    for (const button of state.buttons.values()) {
      delete button.dataset.jumping;
    }
    hideJumpOverlay();
    hideToast();
    hidePreview();
  }

  /** 离开会话页面时清理状态和界面。 */
  function teardownSession() {
    stopSessionWork();
    state.sessionID = null;
    state.items = [];
    state.itemIDs = new Set();
    state.activeID = null;
    resetRail();
    log('已离开会话页面');
  }

  /** 加载指定会话的用户提问。 */
  async function loadSession(sessionID) {
    stopSessionWork();
    state.sessionID = sessionID;
    state.items = [];
    state.itemIDs = new Set();
    state.activeID = null;
    resetRail();
    ensureOptimizeButton();

    const controller = new AbortController();
    state.loadAbort = controller;

    log('开始加载会话', sessionID);

    try {
      const [detail, rawItems] = await Promise.all([
        fetchSessionDetail(sessionID, controller.signal).catch((error) => {
          if (controller.signal.aborted) return null;
          warn('读取会话详情失败，将忽略 revert 过滤', error);
          return null;
        }),
        fetchUserMessages(sessionID, controller.signal),
      ]);

      if (controller.signal.aborted || state.sessionID !== sessionID) return;

      const revertID = detail?.revert?.messageID ?? null;
      const items = [];
      const seen = new Set();

      for (const raw of rawItems) {
        const item = normalizeMessage(raw);
        if (!item || seen.has(item.id)) continue;
        if (revertID && !(item.id < revertID)) continue;
        seen.add(item.id);
        items.push(item);
      }

      items.sort(compareItems);
      state.items = items;
      state.itemIDs = new Set(items.map((item) => item.id));

      log('会话消息加载完成', { sessionID, count: items.length });

      renderRail();
      ensureScroller();
      applyHashActive();
      ensureOptimizeButton();
      setupPolling();
      scheduleActiveUpdate();
    } catch (error) {
      if (controller.signal.aborted) return;

      if (error instanceof Error && error.message === 'UNAUTHORIZED') {
        warn('接口未授权，请确认已通过 opencode pair 登录');
      } else {
        warn('加载会话失败', error);
      }

      state.items = [];
      state.itemIDs = new Set();
      state.activeID = null;
      renderRail();
    } finally {
      if (state.loadAbort === controller) state.loadAbort = null;
    }
  }

  /** 启动会话尾部轮询，作为 MutationObserver 的兜底。 */
  function setupPolling() {
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !state.sessionID) return;
      void refreshTail(state.sessionID);
    }, POLL_INTERVAL);
  }

  /** 延迟刷新最新提问，合并短时间内的多次 DOM 变化。 */
  function scheduleTailRefresh() {
    window.clearTimeout(state.tailTimer);
    state.tailTimer = window.setTimeout(() => {
      if (state.sessionID) void refreshTail(state.sessionID);
    }, TAIL_DEBOUNCE);
  }

  /** 增量拉取最新提问并合并到当前列表。 */
  async function refreshTail(sessionID) {
    if (state.tailLoading || state.loadAbort || state.sessionID !== sessionID) return;

    state.tailLoading = true;
    const controller = new AbortController();
    state.tailAbort = controller;

    try {
      const rawItems = await fetchUserTail(sessionID, controller.signal);
      if (controller.signal.aborted || state.sessionID !== sessionID) return;

      const byID = new Map(state.items.map((item) => [item.id, item]));
      let changed = false;

      for (const raw of rawItems) {
        const item = normalizeMessage(raw);
        if (!item || byID.has(item.id)) continue;
        byID.set(item.id, item);
        changed = true;
      }

      state.lastTailError = null;

      if (changed) {
        state.items = [...byID.values()].sort(compareItems);
        state.itemIDs = new Set(state.items.map((item) => item.id));
        log('检测到新提问，刷新导航', { count: state.items.length });
        renderRail();
        ensureScroller();
        scheduleActiveUpdate();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      if (state.lastTailError !== message) {
        state.lastTailError = message;
        warn('刷新最新提问失败', error);
      }
    } finally {
      state.tailLoading = false;
      if (state.tailAbort === controller) state.tailAbort = null;
    }
  }

  /** 路由变化时检查是否需要切换会话。 */
  function checkRoute() {
    const sessionID = parseSessionID();

    if (sessionID === state.sessionID) {
      if (sessionID) {
        ensureScroller();
        ensureOptimizeButton();
      }
      return;
    }

    if (!sessionID) {
      teardownSession();
      return;
    }

    void loadSession(sessionID);
  }

  /** popstate 可能来自扩展的深链跳转，也可能来自用户前进/后退。 */
  function onRouteEvent() {
    checkRoute();
    if (state.sessionID) {
      applyHashActive();
      scheduleActiveUpdate();
    }
  }

  /** hash 变化时只同步 active，不重新加载会话。 */
  function onHashEvent() {
    applyHashActive();
    scheduleActiveUpdate();
  }

  /** 窗口尺寸变化时隐藏预览并刷新 active。 */
  function onResize() {
    hidePreview();
    scheduleActiveUpdate();
  }

  /** 页面重新可见时补一次尾部刷新。 */
  function onVisibilityChange() {
    if (document.visibilityState !== 'visible' || !state.sessionID) return;
    void refreshTail(state.sessionID);
    scheduleActiveUpdate();
  }

  /** 初始化扩展。 */
  function bootstrap(attempt = 0) {
    if (!document.body) {
      if (attempt < 20) window.setTimeout(() => bootstrap(attempt + 1), 200);
      return;
    }

    if (!isOpenCodePage()) {
      if (attempt < 10) window.setTimeout(() => bootstrap(attempt + 1), 300);
      return;
    }

    ensureUI();
    checkRoute();

    state.routeTimer = window.setInterval(checkRoute, ROUTE_INTERVAL);
    window.addEventListener('popstate', onRouteEvent, true);
    window.addEventListener('hashchange', onHashEvent, true);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('pagehide', abortAllOptimizeTasks, { once: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    log('扩展已启动，等待 opencode pair 会话页面');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrap(), { once: true });
  } else {
    bootstrap();
  }
})();
