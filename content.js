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
      z-index: 1;
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

    @media (prefers-reduced-motion: reduce) {
      .rail,
      .item::before,
      .preview {
        animation: none;
        transition: none;
      }
    }
  `;

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

    shadow.append(rail, preview);
    document.body.appendChild(host);

    state.host = host;
    state.shadow = shadow;
    state.rail = rail;
    state.preview = preview;
    state.previewText = previewText;

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

  /** 跳转到指定提问。 */
  function jumpTo(id) {
    if (!id) return;
    // 锁定用户主动选择，直到用户再次滚动时间线或使用方向键
    state.selectionLock = id;
    setActive(id, true);

    const hash = `#message-${id}`;
    if (location.hash === hash) {
      const element = document.getElementById(`message-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'auto', block: 'start' });
        return;
      }

      // 目标行被虚拟化卸载时，改变 history.state 让 Router 重新处理同一个 hash
      try {
        history.replaceState(
          { ...(history.state || {}), __ocPromptNav: Date.now() },
          '',
          location.href,
        );
      } catch (error) {
        warn('更新地址栏状态失败', error);
      }
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      return;
    }

    try {
      history.replaceState(history.state, '', location.pathname + location.search + hash);
    } catch (error) {
      warn('更新地址栏失败', error);
    }

    // OpenCode 的 Solid Router 只监听 popstate，需要手动派发一次
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    log('跳转到提问', id);
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
      if (sessionID) ensureScroller();
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
    document.addEventListener('visibilitychange', onVisibilityChange);

    log('扩展已启动，等待 opencode pair 会话页面');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bootstrap(), { once: true });
  } else {
    bootstrap();
  }
})();
