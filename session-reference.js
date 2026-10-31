(() => {
  'use strict';

  const STYLE = `
    [data-action="composer-session-reference"] { margin-right: 4px; }
    .oc-session-reference-overlay { position: fixed; inset: 0; z-index: 2147483646; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.45); }
    .oc-session-reference-dialog { display: flex; flex-direction: column; gap: 10px; width: min(720px, 100%); max-height: min(80vh, 800px); padding: 16px; border: 1px solid var(--v2-border-border-base, #888); border-radius: 10px; background: var(--v2-background-bg-layer-01, #fff); color: var(--v2-text-text-base, #111); font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 8px 32px #0004; }
    .oc-session-reference-dialog header, .oc-session-reference-dialog footer { display: flex; align-items: center; gap: 8px; }
    .oc-session-reference-dialog header strong { flex: 1; font-size: 15px; }
    .oc-session-reference-dialog button, .oc-session-reference-dialog select, .oc-session-reference-dialog input[type=search] { color: inherit; background: var(--v2-background-bg-base, #fff); border: 1px solid var(--v2-border-border-base, #888); border-radius: 5px; padding: 6px 8px; font: inherit; }
    .oc-session-reference-dialog button { cursor: pointer; }
    .oc-session-reference-dialog button:disabled { opacity: .5; cursor: default; }
    .oc-session-reference-dialog input[type=search] { flex: 1; min-width: 0; }
    .oc-session-reference-dialog .oc-ref-controls { display: flex; gap: 8px; min-width: 0; }
    .oc-session-reference-dialog .oc-ref-project { position: relative; flex: 0 1 150px; width: 150px; min-width: 0; max-width: 35%; }
    .oc-session-reference-dialog .oc-ref-project-toggle { display: block; width: 100%; overflow: hidden; padding-right: 24px; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
    .oc-session-reference-dialog .oc-ref-project-toggle::after { content: '▾'; position: absolute; right: 8px; }
    .oc-session-reference-dialog .oc-ref-project-menu { position: absolute; z-index: 2; top: 100%; left: 0; width: min(360px, 85vw); max-height: min(45vh, 320px); overflow: auto; border: 1px solid var(--v2-border-border-base, #888); border-radius: 5px; background: var(--v2-background-bg-layer-01, #fff); box-shadow: 0 4px 12px #0003; }
    .oc-session-reference-dialog .oc-ref-project-menu[hidden] { display: none; }
    .oc-session-reference-dialog .oc-ref-project-menu button { display: block; width: 100%; overflow: hidden; border: 0; border-radius: 0; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
    .oc-session-reference-dialog .oc-ref-project-menu button:hover, .oc-session-reference-dialog .oc-ref-project-menu button:focus-visible { background: var(--v2-overlay-simple-overlay-hover, #ddd); }
    .oc-session-reference-dialog .oc-ref-list { overflow: auto; min-height: 120px; flex: 1; border: 1px solid var(--v2-border-border-base, #aaa); border-radius: 5px; }
    .oc-session-reference-dialog .oc-ref-session { display: block; width: 100%; border: 0; border-radius: 0; text-align: left; border-bottom: 1px solid var(--v2-border-border-base, #ddd); }
    .oc-session-reference-dialog .oc-ref-message { display: flex; align-items: flex-start; gap: 8px; padding: 10px; border-bottom: 1px solid var(--v2-border-border-base, #ddd); }
    .oc-session-reference-dialog .oc-ref-message input { margin-top: 4px; flex: none; }
    .oc-session-reference-dialog .oc-ref-message div { min-width: 0; flex: 1; }
    .oc-session-reference-dialog .oc-ref-question { overflow: hidden; margin-bottom: 4px; color: var(--v2-text-text-muted, #666); text-overflow: ellipsis; white-space: nowrap; }
    .oc-session-reference-dialog pre { max-height: 6em; overflow: hidden; margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
    .oc-session-reference-dialog .oc-ref-hint { color: var(--v2-text-text-muted, #666); }
    .oc-session-reference-dialog footer .oc-ref-hint { flex: 1; }
  `;

  /** 读取当前路由中的会话标识。 */
  function currentSession() {
    const match = location.pathname.match(/\/session\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  /** 通过当前页面的认证读取同源接口。 */
  async function getJSON(path, signal) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('认证已失效');
    return response.json();
  }

  /** 分页读取会话或消息，达到上限时明确提示。 */
  async function getPages(path, signal, order = 'asc') {
    const records = [];
    let cursor = '';
    for (let page = 0; page < 25; page += 1) {
      const query = new URLSearchParams({ limit: '200' });
      if (cursor) query.set('cursor', cursor);
      else query.set('order', order);
      const result = await getJSON(`${path}?${query}`, signal);
      if (!Array.isArray(result?.data)) throw new Error('接口返回格式不受支持');
      records.push(...result.data);
      cursor = result.cursor?.next || '';
      if (!cursor || !result.data.length) return { records, truncated: false };
    }
    return { records, truncated: !!cursor };
  }

  /** 提取助手回答的可见文本，不包含推理和工具输出。 */
  function messageText(message) {
    if (message.type === 'assistant') return (message.content || []).filter((part) => part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n');
    return '';
  }

  /** 创建引用选择器，所有内容只在用户确认后插入当前草稿。 */
  async function openReference(editor, sessionID) {
    document.querySelector('.oc-session-reference-overlay')?.remove();
    const controller = new AbortController();
    const overlay = document.createElement('div');
    overlay.className = 'oc-session-reference-overlay';
    overlay.innerHTML = `<section class="oc-session-reference-dialog" role="dialog" aria-modal="true" aria-label="引用其他会话">
      <header><strong>引用其他会话</strong><button type="button" data-action="close" aria-label="关闭">✕</button></header>
      <div class="oc-ref-controls"><div class="oc-ref-project"><button type="button" class="oc-ref-project-toggle" aria-label="选择项目" aria-expanded="false" aria-controls="oc-ref-project-menu">正在加载项目…</button><div id="oc-ref-project-menu" class="oc-ref-project-menu" hidden></div></div><input type="search" placeholder="搜索会话或项目" aria-label="搜索会话或项目"></div>
      <div class="oc-ref-hint" data-part="status">正在加载会话…</div><div class="oc-ref-list"></div>
      <footer><button type="button" data-action="back" hidden>返回会话</button><span class="oc-ref-hint" data-part="count"></span><button type="button" data-action="insert" disabled>插入引用</button></footer>
    </section>`;
    document.body.appendChild(overlay);
    const dialog = overlay.querySelector('section');
    const list = overlay.querySelector('.oc-ref-list');
    const status = overlay.querySelector('[data-part="status"]');
    const count = overlay.querySelector('[data-part="count"]');
    const scope = { value: '' };
    const projectToggle = overlay.querySelector('.oc-ref-project-toggle');
    const projectMenu = overlay.querySelector('.oc-ref-project-menu');
    const search = overlay.querySelector('input[type="search"]');
    const back = overlay.querySelector('[data-action="back"]');
    const insert = overlay.querySelector('[data-action="insert"]');
    const selected = new Set();
    let sessions = [], projects = [], currentProject = '', active = null, messages = [], truncated = false, sortedProjectIDs = [];
    let requestID = 0;

    /** 关闭选择器并取消尚未完成的读取。 */
    function close() { controller.abort(); document.removeEventListener('keydown', onKey); overlay.remove(); }
    /** 按 Esc 关闭选择器。 */
    function onKey(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (!projectMenu.hidden) { setProjectMenu(false); projectToggle.focus(); } else close();
    }
    /** 更新项目菜单开合状态。 */
    function setProjectMenu(open) {
      projectMenu.hidden = !open;
      projectToggle.setAttribute('aria-expanded', String(open));
    }
    /** 同步所选项目名称，并返回其会话列表。 */
    function selectProject(id) {
      scope.value = id;
      projectToggle.textContent = id ? `${projectName(id)}${id === currentProject ? '（当前项目）' : ''}` : '请选择项目';
      projectToggle.title = projects.find((item) => item.id === id)?.canonical || projectName(id);
      setProjectMenu(false);
      requestID += 1;
      renderSessions();
    }
    /** 获取项目名称，缺失时显示可识别的项目标识。 */
    function projectName(id) {
      const project = projects.find((item) => item.id === id);
      return project?.name || project?.canonical || id || '未知项目';
    }
    /** 匹配项目名称、路径或标识。 */
    function projectMatches(id, query) {
      const project = projects.find((item) => item.id === id);
      return `${projectName(id)} ${project?.canonical || ''} ${id}`.toLowerCase().includes(query);
    }
    /** 展示范围内的其他会话。 */
    function renderSessions() {
      active = null; selected.clear(); messages = []; back.hidden = true; insert.disabled = true; count.textContent = '';
      list.replaceChildren();
      const query = search.value.trim().toLowerCase();
      if (!scope.value && !query) { status.textContent = '无法识别当前项目，请选择或搜索项目。'; return; }
      const matchingProjects = query ? sortedProjectIDs.filter((id) => projectMatches(id, query)) : [];
      const filtered = sessions.filter((item) => item.id !== sessionID && (query ? (item.title || '').toLowerCase().includes(query) || projectMatches(item.projectID, query) : item.projectID === scope.value));
      status.textContent = `${query ? `${matchingProjects.length} 个项目 · ` : ''}${filtered.length} 个会话${truncated ? '；会话过多，仅显示前 5000 个' : ''}`;
      for (const id of matchingProjects) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'oc-ref-session';
        button.textContent = `项目：${projectName(id)}`;
        button.addEventListener('click', () => { search.value = ''; selectProject(id); });
        list.appendChild(button);
      }
      for (const item of filtered) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'oc-ref-session';
        button.textContent = `${item.title || '未命名会话'} · ${projectName(item.projectID)}`;
        button.addEventListener('click', () => void renderMessages(item)); list.appendChild(button);
      }
    }
    /** 更新选中数量和长文本提示。 */
    function updateCount() {
      const length = messages.filter((item) => selected.has(item.id)).reduce((sum, item) => sum + item.text.length, 0);
      count.textContent = `已选 ${selected.size} 条 · ${length} 字符${length > 20000 ? '，内容较长，可能消耗大量 Token' : ''}`;
      insert.disabled = selected.size === 0;
    }
    /** 读取并展示所选会话的完整可引用文本。 */
    async function renderMessages(session) {
      const request = ++requestID; active = session; selected.clear(); messages = []; list.replaceChildren(); back.hidden = false; insert.disabled = true; count.textContent = '';
      status.textContent = `正在读取：${session.title || '未命名会话'}…`;
      try {
        const result = await getPages(`/api/session/${encodeURIComponent(session.id)}/message`, controller.signal);
        if (request !== requestID || !overlay.isConnected) return;
        let question = '';
        messages = [];
        for (const item of result.records) {
          if (item.type === 'user') {
            question = (item.metadata?.displayText || item.text || '').replace(/\s+/g, ' ').trim();
          } else {
            const text = messageText(item);
            if (item.id && text.trim()) messages.push({ id: item.id, type: item.type, text, question });
          }
        }
        status.textContent = `${session.title || '未命名会话'} · ${projectName(session.projectID)} · 请选择回答（预览限高，插入完整内容）${result.truncated ? '（消息过多，仅显示前 5000 条）' : ''}`;
        if (!messages.length) status.textContent += '；没有可引用的回答';
        for (const item of [...messages].reverse()) {
          const label = document.createElement('label'); label.className = 'oc-ref-message';
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', `选择回答 ${item.id}`);
          const body = document.createElement('div');
          const prompt = document.createElement('div'); prompt.className = 'oc-ref-question';
          prompt.textContent = `提问：${item.question || '无对应提问'}`; prompt.title = item.question || '无对应提问';
          const title = document.createElement('strong'); title.textContent = '回答';
          const text = document.createElement('pre'); text.textContent = item.text; body.append(prompt, title, text); label.append(checkbox, body); list.appendChild(label);
          const preview = item.text.trim();
          text.title = preview.length > 1000 ? `${preview.slice(0, 1000)}…` : preview;
          checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(item.id); else selected.delete(item.id); updateCount(); });
        }
        updateCount();
      } catch (error) { if (request === requestID && !controller.signal.aborted) { status.textContent = `读取消息失败：${error.message}`; console.warn('[会话引用] 读取消息失败', error); } }
    }
    /** 将所选快照追加到原编辑器，不替换原有节点或自动发送。 */
    function insertReference() {
      if (!active || !selected.size) return;
      if (currentSession() !== sessionID || !editor.isConnected || !editor.getClientRects().length) { status.textContent = '当前会话或输入框已变化，请重新打开引用选择器。'; return; }
      const chosen = messages.filter((item) => selected.has(item.id));
      const text = chosen.map((item) => item.text).join('\n\n---\n\n');
      const prefix = editor.textContent?.replace(/\u200B/g, '').trim() ? '\n\n' : '';
      editor.appendChild(document.createTextNode(prefix + text));
      editor.focus();
      const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prefix + text }));
      console.info('[会话引用] 已插入所选消息', { count: chosen.length });
      close();
    }
    overlay.querySelector('[data-action="close"]').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    projectToggle.addEventListener('click', () => setProjectMenu(projectMenu.hidden));
    overlay.addEventListener('click', (event) => {
      if (!event.target.closest('.oc-ref-project')) setProjectMenu(false);
    });
    search.addEventListener('input', () => { requestID += 1; renderSessions(); });
    back.addEventListener('click', () => { requestID += 1; renderSessions(); });
    insert.addEventListener('click', insertReference);
    dialog.querySelector('[data-action="close"]').focus();
    try {
      const [detail, sessionResult, projectResult] = await Promise.all([
        getJSON(`/api/session/${encodeURIComponent(sessionID)}`, controller.signal),
        getPages('/api/session', controller.signal, 'desc'),
        getJSON('/api/project', controller.signal),
      ]);
      if (!overlay.isConnected) return;
      currentProject = detail?.data?.projectID || ''; sessions = sessionResult.records; truncated = sessionResult.truncated;
      projects = Array.isArray(projectResult) ? projectResult : Array.isArray(projectResult?.data) ? projectResult.data : [];
      const projectIDs = new Set([...projects.map((project) => project.id), ...sessions.map((session) => session.projectID), currentProject].filter(Boolean));
      projectMenu.replaceChildren();
      const projectActivity = new Map(projects.map((project) => [project.id, project.time?.active]));
      sortedProjectIDs = [...projectIDs].sort((a, b) => {
        const aTime = projectActivity.get(a);
        const bTime = projectActivity.get(b);
        const aValid = Number.isFinite(aTime);
        const bValid = Number.isFinite(bTime);
        if (aValid !== bValid) return aValid ? -1 : 1;
        return aValid ? bTime - aTime : 0;
      });
      for (const id of sortedProjectIDs) {
        const option = document.createElement('button'); option.type = 'button';
        option.textContent = `${projectName(id)}${id === currentProject ? '（当前项目）' : ''}`;
        const project = projects.find((item) => item.id === id);
        option.title = project?.canonical || id;
        option.addEventListener('click', () => { selectProject(id); projectToggle.focus(); });
        projectMenu.appendChild(option);
      }
      selectProject(currentProject);
    } catch (error) { if (!controller.signal.aborted) { status.textContent = `读取会话失败：${error.message}`; console.warn('[会话引用] 读取会话失败', error); } }
  }

  /** 在活动输入框的优化按钮后添加同尺寸引用按钮。 */
  function ensureButton() {
    for (const optimize of document.querySelectorAll('[data-action="composer-optimize"]')) {
      const actions = optimize.parentElement; const form = optimize.closest('form[data-component="composer"]');
      const editor = form?.querySelector('[data-component="composer-editor"]');
      if (!actions || !editor) continue;
      let button = actions.querySelector('[data-action="composer-session-reference"]');
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'size-7 rounded-md p-[6px]';
        button.dataset.action = 'composer-session-reference'; button.dataset.component = 'icon-button-v2'; button.dataset.size = 'normal'; button.dataset.variant = 'submit';
        button.title = '引用其他会话'; button.setAttribute('aria-label', '引用其他会话');
        button.innerHTML = '<svg data-slot="icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        button.addEventListener('click', () => {
          const id = currentSession();
          const currentEditor = button.closest('form[data-component="composer"]')?.querySelector('[data-component="composer-editor"]');
          if (id && currentEditor) void openReference(currentEditor, id);
        });
      }
      if (optimize.nextElementSibling !== button) optimize.after(button);
    }
  }

  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
  const observer = new MutationObserver(ensureButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  ensureButton();
})();
