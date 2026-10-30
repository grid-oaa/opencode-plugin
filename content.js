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
  const BOOKMARKS_KEY = 'ocBookmarksV1';
  const BOOKMARK_PREVIEW_LIMIT = 240;
  const BOOKMARK_NOTE_LIMIT = 2000;
  const BOOKMARK_MAX = 1000;
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

    .item[data-bookmarked='true']::after {
      content: '★';
      position: absolute;
      top: 50%;
      left: 4px;
      color: var(--v2-text-text-muted, #666);
      font-size: 9px;
      line-height: 1;
      opacity: 0.8;
      transform: translateY(-50%);
    }

    .item[data-active='true'][data-bookmarked='true']::after {
      color: var(--v2-text-text-base, #111);
    }

    .preview {
      position: fixed;
      right: 78px;
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
      pointer-events: auto;
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

    .preview-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 10px;
      padding-top: 9px;
      border-top: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 40%,
          transparent
        );
    }

    .preview-action {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 7px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--v2-text-text-muted, #666);
      font: inherit;
      font-size: 11px;
      line-height: 1.2;
      cursor: pointer;
      transition:
        background-color 120ms ease,
        color 120ms ease;
    }

    .preview-action:hover,
    .preview-action:focus-visible {
      background: var(--v2-overlay-simple-overlay-hover, rgba(0, 0, 0, 0.06));
      color: var(--v2-text-text-base, #111);
      outline: none;
    }

    .preview-action[data-active='true'] {
      color: var(--v2-text-text-base, #111);
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
      z-index: 9;
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

    .bookmarks-trigger {
      position: fixed;
      z-index: 3;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 55%,
          transparent
        );
      border-radius: 9px;
      background: color-mix(
        in srgb,
        var(--v2-background-bg-base, #fff) 68%,
        transparent
      );
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
      color: var(--v2-text-text-muted, #666);
      cursor: pointer;
      opacity: 0.72;
      pointer-events: auto;
      backdrop-filter: blur(10px);
      transition:
        opacity 140ms ease,
        color 140ms ease,
        background-color 140ms ease,
        border-color 140ms ease;
    }

    .bookmarks-trigger:hover,
    .bookmarks-trigger:focus-visible {
      border-color: color-mix(
        in srgb,
        var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 85%,
        transparent
      );
      background: var(--v2-background-bg-base, #fff);
      color: var(--v2-text-text-base, #111);
      opacity: 1;
      outline: none;
    }

    .bookmarks-trigger[data-inside='true'] {
      background: var(--v2-background-bg-base, #fff);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
    }

    .bookmarks-trigger[hidden] {
      display: none;
    }

    .bookmarks-drawer {
      position: fixed;
      top: 50%;
      right: 78px;
      z-index: 4;
      display: flex;
      flex-direction: column;
      width: min(420px, calc(100vw - 100px));
      max-height: 70vh;
      overflow: hidden;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-strong, rgba(128, 128, 128, 0.25)) 16%,
          transparent
        );
      border-radius: 16px;
      background: var(--v2-background-bg-layer-01, #fff);
      box-shadow: var(--v2-elevation-floating, 0 10px 30px rgba(0, 0, 0, 0.14));
      color: var(--v2-text-text-base, #111);
      font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(calc(-50% + 6px));
      transition:
        opacity 140ms ease,
        transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        visibility 0s linear 160ms;
    }

    .bookmarks-drawer[data-open='true'] {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(-50%);
      transition:
        opacity 140ms ease,
        transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        visibility 0s;
    }

    .bookmarks-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 40%,
          transparent
        );
    }

    .bookmarks-title {
      font-size: 13px;
      font-weight: 600;
    }

    .bookmarks-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--v2-text-text-muted, #666);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }

    .bookmarks-close:hover,
    .bookmarks-close:focus-visible {
      background: var(--v2-overlay-simple-overlay-hover, rgba(0, 0, 0, 0.06));
      color: var(--v2-text-text-base, #111);
      outline: none;
    }

    .bookmarks-search {
      margin: 10px 12px 8px;
      padding: 6px 9px;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 60%,
          transparent
        );
      border-radius: 7px;
      background: transparent;
      color: var(--v2-text-text-base, #111);
      font: inherit;
      font-size: 12px;
      outline: none;
    }

    .bookmarks-search::placeholder {
      color: var(--v2-text-text-muted, #666);
    }

    .bookmarks-search:focus {
      border-color: var(--v2-border-border-focus, #3b82f6);
    }

    .bookmarks-list {
      flex: 1;
      min-height: 0;
      padding: 0 8px 8px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .bookmarks-empty {
      padding: 26px 18px;
      color: var(--v2-text-text-muted, #666);
      font-size: 12px;
      line-height: 1.6;
      text-align: center;
    }

    .bookmarks-selectbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px 8px;
      color: var(--v2-text-text-muted, #666);
      font-size: 11px;
    }

    .bookmarks-select-all {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }

    .bookmarks-select-all input,
    .bookmark-check {
      width: 14px;
      height: 14px;
      margin: 0;
      accent-color: var(--v2-text-text-base, #111);
      cursor: pointer;
    }

    .bookmarks-selected-count {
      color: var(--v2-text-text-muted, #666);
      font-size: 11px;
    }

    .bookmark-item {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      padding: 9px 8px;
      border-bottom: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 28%,
          transparent
        );
    }

    .bookmark-check {
      flex: 0 0 auto;
      margin-top: 2px;
    }

    .bookmark-body {
      flex: 1;
      min-width: 0;
    }

    .bookmark-item:last-child {
      border-bottom: 0;
    }

    .bookmark-jump {
      display: -webkit-box;
      overflow: hidden;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--v2-text-text-base, #111);
      font: inherit;
      font-size: 12px;
      line-height: 1.5;
      text-align: left;
      cursor: pointer;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .bookmark-jump:hover,
    .bookmark-jump:focus-visible {
      color: var(--v2-text-text-base, #111);
      text-decoration: underline;
      outline: none;
    }

    .bookmark-note {
      margin-top: 5px;
      padding: 5px 7px;
      border-left: 2px solid
        color-mix(
          in srgb,
          var(--v2-text-text-muted, #666) 45%,
          transparent
        );
      color: var(--v2-text-text-muted, #666);
      font-size: 11px;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .bookmark-meta {
      margin-top: 4px;
      color: var(--v2-text-text-muted, #666);
      font-size: 10px;
    }

    .bookmark-actions {
      display: flex;
      gap: 4px;
      margin-top: 5px;
    }

    .bookmark-action {
      padding: 2px 6px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--v2-text-text-muted, #666);
      font: inherit;
      font-size: 10px;
      cursor: pointer;
    }

    .bookmark-action:hover,
    .bookmark-action:focus-visible {
      background: var(--v2-overlay-simple-overlay-hover, rgba(0, 0, 0, 0.06));
      color: var(--v2-text-text-base, #111);
      outline: none;
    }

    .bookmarks-foot {
      display: flex;
      gap: 5px;
      padding: 10px 12px;
      border-top: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 40%,
          transparent
        );
    }

    .bookmark-export {
      flex: 1;
      min-width: 0;
      padding: 6px 4px;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 55%,
          transparent
        );
      border-radius: 7px;
      background: transparent;
      color: var(--v2-text-text-base, #111);
      font: inherit;
      font-size: 11px;
      white-space: nowrap;
      cursor: pointer;
    }

    .bookmark-export:hover,
    .bookmark-export:focus-visible {
      background: var(--v2-overlay-simple-overlay-hover, rgba(0, 0, 0, 0.06));
      outline: none;
    }

    .bookmark-export:disabled {
      cursor: progress;
      opacity: 0.55;
    }

    .note-backdrop {
      position: fixed;
      inset: 0;
      z-index: 7;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(0, 0, 0, 0.18);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 140ms ease,
        visibility 0s linear 140ms;
    }

    .note-backdrop[data-open='true'] {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition:
        opacity 140ms ease,
        visibility 0s;
    }

    .note-card {
      width: min(460px, calc(100vw - 40px));
      padding: 16px;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-strong, rgba(128, 128, 128, 0.25)) 16%,
          transparent
        );
      border-radius: 14px;
      background: var(--v2-background-bg-layer-01, #fff);
      box-shadow: var(--v2-elevation-floating, 0 10px 30px rgba(0, 0, 0, 0.18));
      color: var(--v2-text-text-base, #111);
      font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    }

    .note-title {
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 600;
    }

    .note-textarea {
      width: 100%;
      min-height: 100px;
      max-height: 240px;
      padding: 8px 9px;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 65%,
          transparent
        );
      border-radius: 8px;
      background: transparent;
      color: var(--v2-text-text-base, #111);
      font: inherit;
      line-height: 1.5;
      outline: none;
      resize: vertical;
    }

    .note-textarea:focus {
      border-color: var(--v2-border-border-focus, #3b82f6);
    }

    .note-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 10px;
    }

    .note-button {
      padding: 5px 10px;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 55%,
          transparent
        );
      border-radius: 7px;
      background: transparent;
      color: var(--v2-text-text-base, #111);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }

    .note-button:hover,
    .note-button:focus-visible {
      background: var(--v2-overlay-simple-overlay-hover, rgba(0, 0, 0, 0.06));
      outline: none;
    }

    .note-button[data-primary='true'] {
      border-color: var(--v2-text-text-base, #111);
      background: var(--v2-text-text-base, #111);
      color: var(--v2-background-bg-base, #fff);
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

    .glm-launcher {
      position: fixed;
      z-index: 3;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 55%,
          transparent
        );
      border-radius: 9px;
      background: color-mix(
        in srgb,
        var(--v2-background-bg-base, #fff) 68%,
        transparent
      );
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
      color: var(--v2-text-text-muted, #666);
      cursor: pointer;
      opacity: 0.72;
      pointer-events: auto;
      backdrop-filter: blur(10px);
      transition:
        opacity 140ms ease,
        color 140ms ease,
        background-color 140ms ease,
        border-color 140ms ease;
    }

    .glm-launcher:hover,
    .glm-launcher:focus-visible {
      border-color: color-mix(
        in srgb,
        var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 85%,
        transparent
      );
      background: var(--v2-background-bg-base, #fff);
      color: var(--v2-text-text-base, #111);
      opacity: 1;
      outline: none;
    }

    .glm-launcher[data-inside='true'] {
      background: var(--v2-background-bg-base, #fff);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
    }

    .glm-launcher[hidden] {
      display: none;
    }

    .ai-menu {
      position: fixed;
      z-index: 4;
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 60vh;
      padding: 5px;
      overflow-y: auto;
      border: 1px solid
        color-mix(
          in srgb,
          var(--v2-border-border-base, rgba(128, 128, 128, 0.25)) 55%,
          transparent
        );
      border-radius: 12px;
      background: color-mix(
        in srgb,
        var(--v2-background-bg-base, #fff) 76%,
        transparent
      );
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      opacity: 0;
      visibility: hidden;
      transform: translateY(6px);
      pointer-events: none;
      backdrop-filter: blur(12px);
      scrollbar-width: none;
      transition:
        opacity 120ms ease,
        transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1),
        visibility 0s linear 140ms;
    }

    .ai-menu::-webkit-scrollbar {
      display: none;
    }

    .ai-menu[data-open='true'] {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
      pointer-events: auto;
      transition:
        opacity 120ms ease,
        transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1),
        visibility 0s;
    }

    .ai-menu-item {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      padding: 4px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      transition: background-color 120ms ease;
    }

    .ai-menu-item img {
      display: block;
      width: 24px;
      height: 24px;
      border-radius: 6px;
    }

    .ai-menu-item:hover,
    .ai-menu-item:focus-visible {
      background: var(--v2-overlay-simple-overlay-hover, rgba(0, 0, 0, 0.06));
      outline: none;
    }

    .ai-menu-item[data-active='true'] {
      background: color-mix(
        in srgb,
        var(--v2-text-text-base, #111) 6%,
        transparent
      );
    }

    .ai-menu-item[data-active='true']::after {
      content: '';
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--v2-text-text-base, #111);
      box-shadow: 0 0 0 2px var(--v2-background-bg-base, #fff);
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
      .toast,
      .glm-launcher,
      .ai-menu,
      .bookmarks-trigger,
      .bookmarks-drawer,
      .note-backdrop,
      .preview-action,
      .bookmark-action,
      .bookmark-export,
      .note-button {
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

  const AI_CHAT_ICON = `<svg data-slot="icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 15h-7l-4.5 3.5V15H7a2.5 2.5 0 0 1-2.5-2.5v-7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  const BOOKMARK_ICON = `<svg data-slot="icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

  const STAR_ICON = `<svg data-slot="icon-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

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
    glmLauncher: null,
    glmAnchor: null,
    glmObserver: null,
    glmFrame: 0,
    aiSite: 'glm',
    aiMenu: null,
    aiMenuShowTimer: 0,
    aiMenuHideTimer: 0,
    aiStorageBound: false,
    suppressAiMenuFocus: false,
    sessionTitle: '',
    bookmarks: new Map(),
    bookmarkStorageBound: false,
    bookmarkTrigger: null,
    bookmarksDrawer: null,
    bookmarksSearch: null,
    bookmarksList: null,
    bookmarksEmpty: null,
    bookmarksOpen: false,
    noteBackdrop: null,
    noteTextarea: null,
    noteTitle: null,
    noteTargetID: null,
    exporting: false,
    previewID: null,
    previewBookmarkButton: null,
    bookmarksExportBookmarks: null,
    bookmarksExportSession: null,
    bookmarkSelection: new Set(),
    bookmarksSelectAll: null,
    bookmarksSelectedCount: null,
    bookmarksExportSelected: null,
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

  /** 分页读取会话中的全部消息，用于 Markdown 导出。 */
  async function fetchAllMessages(sessionID, signal) {
    const base = `/api/session/${encodeURIComponent(sessionID)}/message`;
    let url = `${base}?limit=${PAGE_SIZE}&order=asc`;
    const collected = [];

    for (let page = 0; page < 25; page += 1) {
      const json = await api(url, signal);
      const data = Array.isArray(json?.data) ? json.data : [];
      collected.push(...data);

      const next = json?.cursor?.next;
      if (!next || data.length === 0) break;
      url = `${base}?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(next)}`;
    }

    const result = [];
    const seen = new Set();
    for (const raw of collected) {
      if (!raw || typeof raw.id !== 'string' || seen.has(raw.id)) continue;
      seen.add(raw.id);
      result.push(raw);
    }
    return result;
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

  /** 返回书签在当前 server/session 下的稳定 key。 */
  function bookmarkKey(messageID) {
    return `${location.origin}|${state.sessionID}|${messageID}`;
  }

  /** 返回当前会话的书签记录。 */
  function getBookmark(messageID) {
    if (!state.sessionID || !messageID) return null;
    return state.bookmarks.get(bookmarkKey(messageID)) || null;
  }

  /** 返回当前会话的全部书签，按消息顺序排列。 */
  function getSessionBookmarks() {
    const order = new Map(state.items.map((item, index) => [item.id, index]));
    return [...state.bookmarks.values()]
      .filter(
        (record) =>
          record &&
          record.server === location.origin &&
          record.sessionID === state.sessionID &&
          typeof record.messageID === 'string',
      )
      .sort((left, right) => {
        const leftIndex = order.has(left.messageID) ? order.get(left.messageID) : 999999;
        const rightIndex = order.has(right.messageID) ? order.get(right.messageID) : 999999;
        return leftIndex - rightIndex || left.createdAt - right.createdAt;
      });
  }

  /** 解析本地存储中的书签对象。 */
  function parseBookmarks(raw) {
    const map = new Map();
    if (!raw || typeof raw !== 'object') return map;

    for (const [key, record] of Object.entries(raw)) {
      if (!record || typeof record !== 'object') continue;
      if (typeof record.server !== 'string' || typeof record.sessionID !== 'string') continue;
      if (typeof record.messageID !== 'string') continue;
      map.set(key, {
        server: record.server,
        sessionID: record.sessionID,
        sessionTitle: typeof record.sessionTitle === 'string' ? record.sessionTitle : '',
        messageID: record.messageID,
        promptPreview:
          typeof record.promptPreview === 'string'
            ? record.promptPreview.slice(0, BOOKMARK_PREVIEW_LIMIT)
            : '',
        note:
          typeof record.note === 'string' ? record.note.slice(0, BOOKMARK_NOTE_LIMIT) : '',
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
      });
    }
    return map;
  }

  /** 从 chrome.storage.local 读取全部书签。 */
  async function loadBookmarks() {
    try {
      const data = await chrome.storage.local.get(BOOKMARKS_KEY);
      state.bookmarks = parseBookmarks(data?.[BOOKMARKS_KEY]);
      syncBookmarkUi();
    } catch (error) {
      warn('读取会话书签失败', error);
    }
  }

  /** 监听其他窗口对书签的修改。 */
  function bindBookmarkStorage() {
    if (state.bookmarkStorageBound) return;
    state.bookmarkStorageBound = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[BOOKMARKS_KEY]) return;
      state.bookmarks = parseBookmarks(changes[BOOKMARKS_KEY].newValue);
      syncBookmarkUi();
    });
  }

  /** Alt+B 打开书签；Escape 关闭备注或书签抽屉。 */
  function onGlobalKeyDown(event) {
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key.toLowerCase() === 'b'
    ) {
      if (state.noteBackdrop?.dataset.open === 'true') return;
      event.preventDefault();
      toggleBookmarksDrawer();
      return;
    }

    if (event.key !== 'Escape') return;
    if (state.noteBackdrop?.dataset.open === 'true') {
      event.preventDefault();
      hideNoteDialog();
      return;
    }
    if (state.bookmarksOpen) {
      event.preventDefault();
      hideBookmarksDrawer();
    }
  }

  /** 点击书签抽屉和备注弹层以外的区域时关闭抽屉。 */
  function onDocumentPointerDown(event) {
    if (!state.bookmarksOpen) return;
    const path = event.composedPath();
    if (
      path.includes(state.bookmarksDrawer) ||
      path.includes(state.bookmarkTrigger) ||
      path.includes(state.noteBackdrop)
    ) {
      return;
    }
    hideBookmarksDrawer();
  }

  /** 持久化书签；超过上限时保留最近更新的记录。 */
  async function persistBookmarks() {
    try {
      const records = [...state.bookmarks.values()]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, BOOKMARK_MAX);
      state.bookmarks = new Map(
        records.map((record) => [
          `${record.server}|${record.sessionID}|${record.messageID}`,
          record,
        ]),
      );
      const payload = Object.fromEntries(state.bookmarks);
      await chrome.storage.local.set({ [BOOKMARKS_KEY]: payload });
    } catch (error) {
      warn('保存会话书签失败', error);
      showToast('书签保存失败，请重试');
    }
  }

  /** 创建一条新的书签记录。 */
  function createBookmarkRecord(messageID, note = '') {
    const item = state.items.find((entry) => entry.id === messageID);
    const prompt = item?.display || item?.preview || '(空消息)';
    const now = Date.now();
    return {
      server: location.origin,
      sessionID: state.sessionID,
      sessionTitle: state.sessionTitle || '',
      messageID,
      promptPreview: prompt.slice(0, BOOKMARK_PREVIEW_LIMIT),
      note: note.slice(0, BOOKMARK_NOTE_LIMIT),
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 保存备注；备注为空且尚未收藏时不创建记录。 */
  function setBookmarkNote(messageID, note) {
    if (!state.sessionID || !messageID) return false;
    const key = bookmarkKey(messageID);
    const existing = state.bookmarks.get(key);
    const value = note.trim().slice(0, BOOKMARK_NOTE_LIMIT);
    if (!value && !existing) return false;

    if (existing) {
      existing.note = value;
      existing.updatedAt = Date.now();
      existing.sessionTitle = state.sessionTitle || existing.sessionTitle;
    } else {
      state.bookmarks.set(key, createBookmarkRecord(messageID, value));
    }

    void persistBookmarks();
    syncBookmarkUi();
    return true;
  }

  /** 删除指定书签（包含备注）。 */
  function removeBookmark(messageID) {
    if (!state.sessionID || !messageID) return;
    const key = bookmarkKey(messageID);
    const existing = state.bookmarks.get(key);
    if (!existing) return;
    state.bookmarks.delete(key);
    state.bookmarkSelection.delete(messageID);
    void persistBookmarks();
    syncBookmarkUi();
    showToast(existing.note ? '已取消收藏，备注一并删除' : '已取消收藏');
  }

  /** 收藏 / 取消收藏一条提问。 */
  function toggleBookmark(messageID) {
    if (!state.sessionID || !messageID) return;
    const key = bookmarkKey(messageID);
    const existing = state.bookmarks.get(key);

    if (existing) {
      removeBookmark(messageID);
      return;
    }

    state.bookmarks.set(key, createBookmarkRecord(messageID));
    void persistBookmarks();
    syncBookmarkUi();
    showToast('已收藏');
  }

  /** 更新预览卡上的收藏按钮状态。 */
  function updatePreviewBookmarkButton() {
    const button = state.previewBookmarkButton;
    if (!button) return;
    const bookmarked = !!getBookmark(state.previewID);
    button.dataset.active = bookmarked ? 'true' : 'false';
    button.title = bookmarked ? '取消收藏' : '收藏这条提问';
    const label = button.querySelector('span');
    if (label) label.textContent = bookmarked ? '已收藏' : '收藏';
  }

  /** 同步 rail 标记、预览按钮和书签抽屉。 */
  function syncBookmarkUi() {
    for (const [id, button] of state.buttons) {
      if (getBookmark(id)) {
        button.dataset.bookmarked = 'true';
      } else {
        delete button.dataset.bookmarked;
      }
    }

    updatePreviewBookmarkButton();
    if (state.bookmarksOpen) renderBookmarksList();
    syncBookmarkSelectionUi();
  }

  /** 兼容旧调用：书签入口和 AI 入口一起定位。 */
  function positionBookmarksTrigger() {
    positionGlmLauncher();
  }

  /** 按消息 ID 升序排列，与 OpenCode 时间线的顺序保持一致。 */
  function compareItems(left, right) {
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  }

  /** 创建预览卡上的收藏 / 备注 / 跳转操作。 */
  function createPreviewActions() {
    const wrap = document.createElement('div');
    wrap.className = 'preview-actions';

    const bookmark = document.createElement('button');
    bookmark.type = 'button';
    bookmark.className = 'preview-action';
    bookmark.dataset.previewAction = 'bookmark';
    bookmark.innerHTML = `${STAR_ICON}<span>收藏</span>`;
    bookmark.title = '收藏这条提问';
    bookmark.addEventListener('click', () => {
      if (state.previewID) toggleBookmark(state.previewID);
    });

    const note = document.createElement('button');
    note.type = 'button';
    note.className = 'preview-action';
    note.dataset.previewAction = 'note';
    note.textContent = '备注';
    note.title = '给这条提问添加备注';
    note.addEventListener('click', () => {
      if (state.previewID) openNoteDialog(state.previewID);
    });

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'preview-action';
    jump.dataset.previewAction = 'jump';
    jump.textContent = '跳转';
    jump.title = '跳转到这条提问';
    jump.addEventListener('click', () => {
      if (state.previewID) jumpTo(state.previewID);
    });

    wrap.append(bookmark, note, jump);
    state.previewBookmarkButton = bookmark;
    return wrap;
  }

  /** 创建书签入口、书签抽屉和备注弹层。 */
  function createBookmarkUi() {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'bookmarks-trigger';
    trigger.hidden = true;
    trigger.title = '会话书签（Alt+B）';
    trigger.setAttribute('aria-label', '打开会话书签');
    trigger.innerHTML = BOOKMARK_ICON;

    const drawer = document.createElement('aside');
    drawer.className = 'bookmarks-drawer';
    drawer.dataset.open = 'false';
    drawer.setAttribute('aria-label', '会话书签');
    drawer.setAttribute('role', 'complementary');

    const head = document.createElement('div');
    head.className = 'bookmarks-head';
    const title = document.createElement('div');
    title.className = 'bookmarks-title';
    title.textContent = '会话书签';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bookmarks-close';
    close.textContent = '×';
    close.title = '关闭书签';
    close.setAttribute('aria-label', '关闭会话书签');
    head.append(title, close);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'bookmarks-search';
    search.placeholder = '搜索书签…';
    search.setAttribute('aria-label', '搜索会话书签');
    search.addEventListener('input', renderBookmarksList);

    const list = document.createElement('div');
    list.className = 'bookmarks-list';

    const selectBar = document.createElement('div');
    selectBar.className = 'bookmarks-selectbar';
    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'bookmarks-select-all';
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.disabled = true;
    selectAll.addEventListener('change', onToggleSelectAll);
    const selectAllText = document.createElement('span');
    selectAllText.textContent = '全选';
    selectAllLabel.append(selectAll, selectAllText);
    const selectedCount = document.createElement('span');
    selectedCount.className = 'bookmarks-selected-count';
    selectedCount.textContent = '已选 0 条';
    selectBar.append(selectAllLabel, selectedCount);

    const foot = document.createElement('div');
    foot.className = 'bookmarks-foot';

    const exportSelected = document.createElement('button');
    exportSelected.type = 'button';
    exportSelected.className = 'bookmark-export';
    exportSelected.textContent = '导出选中';
    exportSelected.title = '导出勾选的书签';
    exportSelected.disabled = true;
    exportSelected.addEventListener('click', () => {
      if (state.bookmarkSelection.size > 0) {
        void exportBookmarksMarkdown(new Set(state.bookmarkSelection));
      }
    });

    const exportBookmarks = document.createElement('button');
    exportBookmarks.type = 'button';
    exportBookmarks.className = 'bookmark-export';
    exportBookmarks.textContent = '全部书签';
    exportBookmarks.title = '把当前会话的全部书签导出为 Markdown';
    exportBookmarks.addEventListener('click', () => {
      void exportBookmarksMarkdown();
    });
    const exportSession = document.createElement('button');
    exportSession.type = 'button';
    exportSession.className = 'bookmark-export';
    exportSession.textContent = '导出会话';
    exportSession.title = '把当前会话导出为 Markdown';
    exportSession.addEventListener('click', () => {
      void exportSessionMarkdown();
    });
    foot.append(exportSelected, exportBookmarks, exportSession);

    drawer.append(head, search, selectBar, list, foot);

    const noteBackdrop = document.createElement('div');
    noteBackdrop.className = 'note-backdrop';
    noteBackdrop.dataset.open = 'false';
    const noteCard = document.createElement('div');
    noteCard.className = 'note-card';
    noteCard.setAttribute('role', 'dialog');
    noteCard.setAttribute('aria-modal', 'true');
    noteCard.setAttribute('aria-label', '提问备注');
    const noteTitle = document.createElement('div');
    noteTitle.className = 'note-title';
    noteTitle.textContent = '添加备注';
    const noteTextarea = document.createElement('textarea');
    noteTextarea.className = 'note-textarea';
    noteTextarea.maxLength = BOOKMARK_NOTE_LIMIT;
    noteTextarea.placeholder = '记录这条提问为什么重要、结论是什么…';
    const noteActions = document.createElement('div');
    noteActions.className = 'note-actions';
    const noteCancel = document.createElement('button');
    noteCancel.type = 'button';
    noteCancel.className = 'note-button';
    noteCancel.textContent = '取消';
    const noteSave = document.createElement('button');
    noteSave.type = 'button';
    noteSave.className = 'note-button';
    noteSave.dataset.primary = 'true';
    noteSave.textContent = '保存';
    noteActions.append(noteCancel, noteSave);
    noteCard.append(noteTitle, noteTextarea, noteActions);
    noteBackdrop.append(noteCard);

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleBookmarksDrawer();
    });
    close.addEventListener('click', hideBookmarksDrawer);
    noteCancel.addEventListener('click', hideNoteDialog);
    noteSave.addEventListener('click', saveNoteDialog);
    noteBackdrop.addEventListener('pointerdown', (event) => {
      if (event.target === noteBackdrop) hideNoteDialog();
    });
    noteTextarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        hideNoteDialog();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        saveNoteDialog();
      }
    });

    state.bookmarkTrigger = trigger;
    state.bookmarksDrawer = drawer;
    state.bookmarksSearch = search;
    state.bookmarksList = list;
    state.bookmarksExportBookmarks = exportBookmarks;
    state.bookmarksExportSession = exportSession;
    state.bookmarksExportSelected = exportSelected;
    state.bookmarksSelectAll = selectAll;
    state.bookmarksSelectedCount = selectedCount;
    state.noteBackdrop = noteBackdrop;
    state.noteTextarea = noteTextarea;
    state.noteTitle = noteTitle;

    return { trigger, drawer, noteBackdrop };
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
    preview.append(previewText, createPreviewActions());
    preview.addEventListener('pointerenter', () => {
      window.clearTimeout(state.previewTimer);
    });
    preview.addEventListener('pointerleave', hidePreviewSoon);
    preview.addEventListener('focusin', () => {
      window.clearTimeout(state.previewTimer);
    });
    preview.addEventListener('focusout', (event) => {
      if (event.relatedTarget && preview.contains(event.relatedTarget)) return;
      hidePreviewSoon();
    });

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

    const glmLauncher = document.createElement('button');
    glmLauncher.type = 'button';
    glmLauncher.className = 'glm-launcher';
    glmLauncher.hidden = true;
    glmLauncher.title = '打开 AI 对话';
    glmLauncher.setAttribute('aria-label', '打开 AI 对话');
    glmLauncher.setAttribute('aria-haspopup', 'menu');
    glmLauncher.setAttribute('aria-expanded', 'false');
    glmLauncher.innerHTML = AI_CHAT_ICON;
    glmLauncher.addEventListener('click', openGlmPanel);
    glmLauncher.addEventListener('pointerenter', scheduleAiMenuShow);
    glmLauncher.addEventListener('pointerleave', scheduleAiMenuHide);
    glmLauncher.addEventListener('focus', () => {
      if (state.suppressAiMenuFocus) return;
      if (glmLauncher.matches(':focus-visible')) openAiMenu();
    });
    glmLauncher.addEventListener('blur', scheduleAiMenuHide);
    glmLauncher.addEventListener('keydown', onAiTriggerKeyDown);

    const aiMenu = document.createElement('div');
    aiMenu.className = 'ai-menu';
    aiMenu.dataset.open = 'false';
    aiMenu.setAttribute('role', 'menu');
    aiMenu.setAttribute('aria-label', 'AI 对话站点');
    aiMenu.addEventListener('pointerenter', cancelAiMenuHide);
    aiMenu.addEventListener('pointerleave', scheduleAiMenuHide);
    aiMenu.addEventListener('focusin', cancelAiMenuHide);
    aiMenu.addEventListener('focusout', onAiMenuFocusOut);

    const bookmarkUi = createBookmarkUi();

    shadow.append(
      rail,
      preview,
      overlay,
      glmLauncher,
      aiMenu,
      bookmarkUi.trigger,
      bookmarkUi.drawer,
      bookmarkUi.noteBackdrop,
      toast,
    );
    document.body.appendChild(host);

    state.host = host;
    state.shadow = shadow;
    state.rail = rail;
    state.preview = preview;
    state.previewText = previewText;
    state.jumpOverlay = overlay;
    state.glmLauncher = glmLauncher;
    state.aiMenu = aiMenu;
    state.toast = toast;

    renderAiMenu();
    updateAiTrigger();
    positionBookmarksTrigger();

    log('导航界面已创建');
  }

  /** 清空导航栏并隐藏预览。 */
  function resetRail() {
    if (!state.rail) return;
    state.rail.textContent = '';
    state.rail.hidden = true;
    state.buttons.clear();
    hidePreview();
    hideBookmarksDrawer();
    hideNoteDialog();
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
      positionBookmarksTrigger();
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
    syncBookmarkUi();

    if (!state.activeID || !state.buttons.has(state.activeID)) {
      state.activeID = state.items[state.items.length - 1]?.id ?? null;
    }
    setActive(state.activeID, false);

    window.requestAnimationFrame(() => {
      scrollActiveIntoView();
      positionBookmarksTrigger();
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
    state.previewID = id;
    state.previewText.textContent = item.preview;
    updatePreviewBookmarkButton();

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
    state.previewID = null;
  }

  /** 格式化书签更新时间。 */
  function formatBookmarkTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  /** 打开 / 关闭会话书签抽屉。 */
  function toggleBookmarksDrawer() {
    if (state.bookmarksOpen) {
      hideBookmarksDrawer();
    } else {
      openBookmarksDrawer();
    }
  }

  /** 打开会话书签抽屉。 */
  function openBookmarksDrawer() {
    if (!state.bookmarksDrawer) return;
    hidePreview();
    state.bookmarksOpen = true;
    state.bookmarksDrawer.dataset.open = 'true';
    renderBookmarksList();
    window.setTimeout(() => {
      state.bookmarksSearch?.focus({ preventScroll: true });
    }, 0);
  }

  /** 关闭会话书签抽屉。 */
  function hideBookmarksDrawer() {
    state.bookmarksOpen = false;
    if (state.bookmarksDrawer) state.bookmarksDrawer.dataset.open = 'false';
  }

  /** 返回当前搜索条件下的书签列表。 */
  function getFilteredSessionBookmarks() {
    const query = (state.bookmarksSearch?.value || '').trim().toLowerCase();
    return getSessionBookmarks().filter((record) => {
      if (!query) return true;
      const item = state.items.find((entry) => entry.id === record.messageID);
      const text = `${item?.display || record.promptPreview || ''}\n${record.note || ''}`;
      return text.toLowerCase().includes(query);
    });
  }

  /** 同步勾选数量、全选框和“导出选中”按钮。 */
  function syncBookmarkSelectionUi() {
    const current = new Set(getSessionBookmarks().map((record) => record.messageID));
    for (const id of [...state.bookmarkSelection]) {
      if (!current.has(id)) state.bookmarkSelection.delete(id);
    }

    const selected = state.bookmarkSelection.size;
    if (state.bookmarksSelectedCount) {
      state.bookmarksSelectedCount.textContent = `已选 ${selected} 条`;
    }
    if (state.bookmarksExportSelected) {
      state.bookmarksExportSelected.disabled = state.exporting || selected === 0;
    }

    const visible = getFilteredSessionBookmarks().map((record) => record.messageID);
    const selectedVisible = visible.filter((id) => state.bookmarkSelection.has(id)).length;
    const selectAll = state.bookmarksSelectAll;
    if (selectAll) {
      selectAll.disabled = state.exporting || visible.length === 0;
      selectAll.checked = visible.length > 0 && selectedVisible === visible.length;
      selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    }
  }

  /** 同步列表中的 checkbox 状态。 */
  function updateBookmarkCheckboxes() {
    const list = state.bookmarksList;
    if (!list) return;
    for (const row of list.querySelectorAll('.bookmark-item')) {
      const check = row.querySelector('.bookmark-check');
      if (check) check.checked = state.bookmarkSelection.has(row.dataset.id);
    }
  }

  /** 全选/取消全选当前搜索结果。 */
  function onToggleSelectAll(event) {
    const checked = !!event.currentTarget.checked;
    for (const record of getFilteredSessionBookmarks()) {
      if (checked) {
        state.bookmarkSelection.add(record.messageID);
      } else {
        state.bookmarkSelection.delete(record.messageID);
      }
    }
    updateBookmarkCheckboxes();
    syncBookmarkSelectionUi();
  }

  /** 渲染当前会话的书签列表。 */
  function renderBookmarksList() {
    const list = state.bookmarksList;
    if (!list) return;

    const query = (state.bookmarksSearch?.value || '').trim().toLowerCase();
    const bookmarks = getFilteredSessionBookmarks();

    list.textContent = '';

    if (bookmarks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bookmarks-empty';
      empty.textContent = query
        ? '没有匹配的书签。'
        : '还没有书签。悬停提问后点击“收藏”或“备注”即可添加。';
      list.append(empty);
      syncBookmarkSelectionUi();
      return;
    }

    for (const record of bookmarks) {
      const item = state.items.find((entry) => entry.id === record.messageID);
      const row = document.createElement('div');
      row.className = 'bookmark-item';
      row.dataset.id = record.messageID;

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'bookmark-check';
      check.checked = state.bookmarkSelection.has(record.messageID);
      check.title = '选择导出';
      check.setAttribute('aria-label', '选择这条书签用于导出');
      check.addEventListener('change', () => {
        if (check.checked) {
          state.bookmarkSelection.add(record.messageID);
        } else {
          state.bookmarkSelection.delete(record.messageID);
        }
        syncBookmarkSelectionUi();
      });

      const body = document.createElement('div');
      body.className = 'bookmark-body';

      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'bookmark-jump';
      jump.textContent = item?.display || record.promptPreview || '(空消息)';
      jump.title = '跳转到这条提问';
      jump.addEventListener('click', () => {
        hideBookmarksDrawer();
        jumpTo(record.messageID);
      });
      body.append(jump);

      if (record.note) {
        const note = document.createElement('div');
        note.className = 'bookmark-note';
        note.textContent = record.note;
        body.append(note);
      }

      const meta = document.createElement('div');
      meta.className = 'bookmark-meta';
      meta.textContent = `更新于 ${formatBookmarkTime(record.updatedAt)}`;
      body.append(meta);

      const actions = document.createElement('div');
      actions.className = 'bookmark-actions';
      const editNote = document.createElement('button');
      editNote.type = 'button';
      editNote.className = 'bookmark-action';
      editNote.textContent = record.note ? '编辑备注' : '添加备注';
      editNote.addEventListener('click', () => openNoteDialog(record.messageID));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'bookmark-action';
      remove.textContent = '取消收藏';
      remove.addEventListener('click', () => removeBookmark(record.messageID));
      actions.append(editNote, remove);
      body.append(actions);

      row.append(check, body);
      list.append(row);
    }

    syncBookmarkSelectionUi();
  }

  /** 打开备注编辑弹层。 */
  function openNoteDialog(messageID) {
    if (!messageID || !state.noteBackdrop) return;
    const existing = getBookmark(messageID);
    state.noteTargetID = messageID;
    state.noteTitle.textContent = existing ? '编辑备注' : '添加备注';
    state.noteTextarea.value = existing?.note || '';
    state.noteBackdrop.dataset.open = 'true';
    hidePreview();
    window.requestAnimationFrame(() => {
      state.noteTextarea.focus();
      state.noteTextarea.setSelectionRange(
        state.noteTextarea.value.length,
        state.noteTextarea.value.length,
      );
    });
  }

  /** 关闭备注弹层。 */
  function hideNoteDialog() {
    if (state.noteBackdrop) state.noteBackdrop.dataset.open = 'false';
    state.noteTargetID = null;
  }

  /** 保存备注；有备注会自动创建书签。 */
  function saveNoteDialog() {
    const messageID = state.noteTargetID;
    if (!messageID) return;
    const note = state.noteTextarea.value.trim().slice(0, BOOKMARK_NOTE_LIMIT);
    if (!note && !getBookmark(messageID)) {
      hideNoteDialog();
      return;
    }
    setBookmarkNote(messageID, note);
    hideNoteDialog();
    showToast(note ? '备注已保存' : '备注已清空');
  }

  /** 提取用户消息正文。 */
  function userMessageText(message) {
    return typeof message?.text === 'string' ? message.text.trim() : '';
  }

  /** 提取用户消息的附件名称。 */
  function userAttachmentLines(message) {
    const files = Array.isArray(message?.files) ? message.files : [];
    return files
      .map((file) => (file && (file.name || file.filename)) || '附件')
      .filter(Boolean)
      .map((name) => `- 附件：${name}`);
  }

  /** 提取助手消息的正文和工具调用名称。 */
  function assistantMessageBlocks(message) {
    const content = Array.isArray(message?.content) ? message.content : [];
    const texts = content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text.trim())
      .filter(Boolean);
    const tools = content
      .filter((part) => part?.type === 'tool')
      .map((part) => part.name || 'tool');

    return { texts, tools };
  }

  /** 把消息按用户提问聚合为轮次。 */
  function buildSessionTurns(messages) {
    const turns = [];
    let current = null;

    for (const message of messages) {
      if (!message) continue;
      if (message.type === 'user') {
        current = { user: message, assistants: [] };
        turns.push(current);
        continue;
      }
      if (message.type === 'assistant' && current) {
        current.assistants.push(message);
      }
    }
    return turns;
  }

  /** 生成单个 Q&A 轮次的 Markdown。 */
  function formatSessionTurn(turn, bookmark) {
    if (!turn?.user) return '';
    const lines = [];
    lines.push(`## ${bookmark ? '⭐ ' : ''}用户`);
    const userText = userMessageText(turn.user);
    if (userText) lines.push(userText);
    lines.push(...userAttachmentLines(turn.user));
    if (bookmark?.note) {
      lines.push('', '> 备注：', ...bookmark.note.split(/\r?\n/).map((line) => `> ${line}`));
    }

    const texts = [];
    const toolCounts = new Map();
    for (const assistant of turn.assistants) {
      const blocks = assistantMessageBlocks(assistant);
      if (blocks.texts.length) texts.push(blocks.texts.join('\n\n'));
      for (const name of blocks.tools) {
        toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
      }
    }

    if (texts.length || toolCounts.size) {
      lines.push('', '## 助手');
      if (texts.length) lines.push(texts.join('\n\n'));
      if (toolCounts.size) {
        const summary = [...toolCounts.entries()]
          .map(([name, count]) => (count > 1 ? `${name} × ${count}` : name))
          .join('，');
        lines.push('', `> 工具调用：${summary}`);
      }
    }

    return lines.join('\n').trim();
  }

  /** 生成导出 Markdown；onlyBookmarks 为 true 时只保留书签轮次。 */
  function buildExportMarkdown(turns, onlyBookmarks, targetIDs = null) {
    const bookmarks = new Map(
      getSessionBookmarks().map((record) => [record.messageID, record]),
    );
    const sections = [];
    const used = new Set();

    for (const turn of turns) {
      const userId = turn.user?.id;
      if (targetIDs && !targetIDs.has(userId)) continue;
      const record = bookmarks.get(userId) || null;
      if (onlyBookmarks && !record) continue;
      const section = formatSessionTurn(turn, record);
      if (!section) continue;
      sections.push(section);
      if (userId) used.add(userId);
    }

    // API 中没返回的旧书签也保留下来，避免导出静默丢失
    if (onlyBookmarks) {
      for (const record of getSessionBookmarks()) {
        if (used.has(record.messageID)) continue;
        if (targetIDs && !targetIDs.has(record.messageID)) continue;
        const item = state.items.find((entry) => entry.id === record.messageID);
        const lines = [`## ⭐ 用户`, item?.display || record.promptPreview || '(空消息)'];
        if (record.note) {
          lines.push('', '> 备注：', ...record.note.split(/\r?\n/).map((line) => `> ${line}`));
        }
        sections.push(lines.join('\n'));
      }
    }

    if (sections.length === 0) return '';

    const title = state.sessionTitle || '未命名会话';
    const bookmarkTitle = onlyBookmarks
      ? targetIDs
        ? ' · 选中书签'
        : ' · 会话书签'
      : '';
    const header = [
      `# ${title}${bookmarkTitle}`,
      '',
      `- 会话 ID：${state.sessionID || ''}`,
      `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
      `- 来源：${location.href}`,
      onlyBookmarks ? `- 书签数量：${sections.length}` : '',
    ]
      .filter((line, index, list) => line || list[index - 1] !== '')
      .join('\n');

    return `${header}\n\n---\n\n${sections.join('\n\n---\n\n')}\n`;
  }

  /** 把 Markdown 作为文件下载。 */
  function downloadMarkdown(markdown, suffix) {
    const title = (state.sessionTitle || 'opencode-session')
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join('');
    const filename = `${title || 'opencode-session'}-${suffix}-${stamp}.md`;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 切换导出按钮的忙碌状态。 */
  function setExporting(value) {
    state.exporting = value;
    if (state.bookmarksExportBookmarks) state.bookmarksExportBookmarks.disabled = value;
    if (state.bookmarksExportSession) state.bookmarksExportSession.disabled = value;
    if (state.bookmarksExportSelected) {
      state.bookmarksExportSelected.disabled = value || state.bookmarkSelection.size === 0;
    }
    syncBookmarkSelectionUi();
  }

  /** 导出当前会话的书签及其回答。 */
  async function exportBookmarksMarkdown(selectedIDs = null) {
    if (state.exporting || !state.sessionID) return;

    const targets = selectedIDs instanceof Set ? new Set(selectedIDs) : null;
    if (targets) {
      for (const id of [...targets]) {
        if (!getBookmark(id)) targets.delete(id);
      }
      if (targets.size === 0) {
        showToast('请先勾选要导出的书签');
        return;
      }
    } else if (getSessionBookmarks().length === 0) {
      showToast('当前会话还没有书签');
      return;
    }

    setExporting(true);
    showToast(targets ? '正在整理选中书签…' : '正在整理书签…');
    const sessionID = state.sessionID;
    try {
      const messages = await fetchAllMessages(sessionID);
      if (state.sessionID !== sessionID) return;
      const turns = buildSessionTurns(messages);
      const markdown = buildExportMarkdown(turns, true, targets);
      if (!markdown) {
        showToast('没有可导出的书签内容');
        return;
      }
      downloadMarkdown(markdown, targets ? 'bookmarks-selected' : 'bookmarks');
      showToast(targets ? '选中书签已导出' : '书签已导出');
      log('已导出会话书签', {
        sessionID,
        count: targets ? targets.size : getSessionBookmarks().length,
        selected: !!targets,
      });
    } catch (error) {
      warn('导出书签失败', error);
      showToast('导出书签失败，请重试');
    } finally {
      setExporting(false);
    }
  }

  /** 导出当前会话的完整 Markdown。 */
  async function exportSessionMarkdown() {
    if (state.exporting || !state.sessionID) return;

    setExporting(true);
    showToast('正在整理会话…');
    const sessionID = state.sessionID;
    try {
      const messages = await fetchAllMessages(sessionID);
      if (state.sessionID !== sessionID) return;
      const turns = buildSessionTurns(messages);
      const markdown = buildExportMarkdown(turns, false);
      if (!markdown) {
        showToast('当前会话没有可导出的内容');
        return;
      }
      downloadMarkdown(markdown, 'session');
      showToast('会话已导出');
      log('已导出会话 Markdown', { sessionID, messages: messages.length });
    } catch (error) {
      warn('导出会话失败', error);
      showToast('导出会话失败，请重试');
    } finally {
      setExporting(false);
    }
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

  /** 读取 OpenCode 主题变量，供侧栏加载态和回退卡片使用。 */
  function readSidePanelTheme() {
    const style = window.getComputedStyle(document.body);
    const read = (name) => style.getPropertyValue(name).trim();
    const theme = {
      bg: read('--v2-background-bg-base'),
      text: read('--v2-text-text-base'),
      muted: read('--v2-text-text-muted'),
      border: read('--v2-border-border-base'),
      hover: read('--v2-overlay-simple-overlay-hover'),
    };
    return Object.fromEntries(Object.entries(theme).filter(([, value]) => value));
  }

  /** 返回已配置的 AI 站点；共享配置缺失时使用内置的智谱清言。 */
  function getAiSites() {
    const sites = Array.isArray(globalThis.OC_AI_SITES) ? globalThis.OC_AI_SITES : [];
    if (sites.length) return sites;
    return [{ id: 'glm', name: '智谱清言', url: 'https://chatglm.cn/', logo: '' }];
  }

  /** 按 id 解析站点，找不到时使用默认站点。 */
  function resolveAiSite(siteId) {
    const sites = getAiSites();
    return (
      sites.find((site) => site.id === siteId) ||
      sites.find((site) => site.id === globalThis.OC_AI_SITE_FALLBACK) ||
      sites[0]
    );
  }

  /** 更新悬浮按钮的提示，显示当前选中的站点。 */
  function updateAiTrigger() {
    const button = state.glmLauncher;
    if (!button) return;
    const site = resolveAiSite(state.aiSite);
    const gap = /^[A-Za-z0-9]/.test(site.name) ? ' ' : '';
    button.title = `选择 AI 对话（当前${gap}${site.name}）`;
    button.setAttribute('aria-label', `选择 AI 对话，当前${gap}${site.name}`);
  }

  /** 渲染向上的 AI 站点菜单。 */
  function renderAiMenu() {
    const menu = state.aiMenu;
    if (!menu) return;

    menu.textContent = '';
    for (const site of getAiSites()) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ai-menu-item';
      item.dataset.site = site.id;
      item.setAttribute('role', 'menuitem');
      item.setAttribute('tabindex', '-1');
      item.title = site.name;
      item.setAttribute('aria-label', `打开${site.name}`);

      if (site.logo) {
        const image = document.createElement('img');
        image.src = site.logo;
        image.alt = '';
        image.width = 24;
        image.height = 24;
        image.draggable = false;
        item.append(image);
      } else {
        item.textContent = site.name.slice(0, 1);
      }

      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectAiSite(site.id);
      });
      item.addEventListener('keydown', onAiMenuKeyDown);
      menu.append(item);
    }

    updateAiMenuActive();
  }

  /** 更新菜单中当前站点的选中状态。 */
  function updateAiMenuActive() {
    const menu = state.aiMenu;
    if (!menu) return;
    for (const item of menu.querySelectorAll('.ai-menu-item')) {
      if (item.dataset.site === state.aiSite) {
        item.dataset.active = 'true';
      } else {
        delete item.dataset.active;
      }
    }
  }

  /** 把菜单定位到悬浮按钮上方，并避开右侧提问导航。 */
  function positionAiMenu() {
    const menu = state.aiMenu;
    const button = state.glmLauncher;
    if (!menu || !button || button.hidden) return;

    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const width = menuRect.width || 44;
    const height = menuRect.height || 84;
    let left = buttonRect.right - width;
    let top = buttonRect.top - height - 8;

    const rail = state.rail && !state.rail.hidden ? state.rail : null;
    const railRect = rail ? rail.getBoundingClientRect() : null;
    if (railRect) {
      const overlapsX = left < railRect.right && left + width > railRect.left;
      const overlapsY = top < railRect.bottom && top + height > railRect.top;
      if (overlapsX && overlapsY) left = railRect.left - width - 8;
    }

    left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - height - 8, top));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  /** 打开站点菜单；键盘触发时可以聚焦第一项。 */
  function openAiMenu(focusFirst = false) {
    const menu = state.aiMenu;
    const button = state.glmLauncher;
    if (!menu || !button) return;

    window.clearTimeout(state.aiMenuShowTimer);
    window.clearTimeout(state.aiMenuHideTimer);
    state.aiMenuShowTimer = 0;
    state.aiMenuHideTimer = 0;
    menu.dataset.open = 'true';
    button.setAttribute('aria-expanded', 'true');
    positionAiMenu();

    if (focusFirst === true) {
      menu.querySelector('.ai-menu-item')?.focus();
    }
  }

  /** 延迟展开菜单，避免鼠标划过时误触。 */
  function scheduleAiMenuShow() {
    cancelAiMenuHide();
    const menu = state.aiMenu;
    if (!menu || menu.dataset.open === 'true') return;

    window.clearTimeout(state.aiMenuShowTimer);
    state.aiMenuShowTimer = window.setTimeout(() => {
      state.aiMenuShowTimer = 0;
      openAiMenu();
    }, 100);
  }

  /** 延迟收起菜单，给鼠标从按钮移到菜单留出时间。 */
  function scheduleAiMenuHide() {
    window.clearTimeout(state.aiMenuShowTimer);
    state.aiMenuShowTimer = 0;
    window.clearTimeout(state.aiMenuHideTimer);
    state.aiMenuHideTimer = window.setTimeout(() => {
      state.aiMenuHideTimer = 0;
      hideAiMenu();
    }, 220);
  }

  /** 取消待执行的收起动作。 */
  function cancelAiMenuHide() {
    window.clearTimeout(state.aiMenuHideTimer);
    state.aiMenuHideTimer = 0;
  }

  /** 收起菜单。 */
  function hideAiMenu() {
    window.clearTimeout(state.aiMenuShowTimer);
    window.clearTimeout(state.aiMenuHideTimer);
    state.aiMenuShowTimer = 0;
    state.aiMenuHideTimer = 0;
    if (state.aiMenu) state.aiMenu.dataset.open = 'false';
    if (state.glmLauncher) state.glmLauncher.setAttribute('aria-expanded', 'false');
  }

  /** 处理悬浮按钮的键盘操作。 */
  function onAiTriggerKeyDown(event) {
    if (event.key === 'Escape') {
      hideAiMenu();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    openAiMenu();
    const items = [...(state.aiMenu?.querySelectorAll('.ai-menu-item') || [])];
    if (!items.length) return;
    const item = event.key === 'ArrowDown' ? items[0] : items[items.length - 1];
    item.focus();
  }

  /** 菜单内的方向键、Esc 和焦点管理。 */
  function onAiMenuKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideAiMenu();
      const button = state.glmLauncher;
      if (button) {
        state.suppressAiMenuFocus = true;
        button.focus();
        window.setTimeout(() => {
          state.suppressAiMenuFocus = false;
        }, 0);
      }
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(state.aiMenu?.querySelectorAll('.ai-menu-item') || [])];
    if (!items.length) return;
    const index = items.indexOf(event.currentTarget);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next = (index + delta + items.length) % items.length;
    items[next].focus();
  }

  /** 焦点离开按钮和菜单时收起菜单。 */
  function onAiMenuFocusOut(event) {
    const next = event.relatedTarget;
    if (next && (state.aiMenu?.contains(next) || state.glmLauncher === next)) return;
    scheduleAiMenuHide();
  }

  /** 选择 AI 站点：保存选择、收起菜单并打开侧栏。 */
  function selectAiSite(siteId) {
    const site = resolveAiSite(siteId);
    state.aiSite = site.id;
    updateAiMenuActive();
    updateAiTrigger();
    hideAiMenu();

    try {
      chrome.storage.local.set({ ocAiSite: site.id }).catch(() => {});
    } catch (error) {
      warn('保存 AI 站点失败', error);
    }

    openAiPanel(site.id);
  }

  /** 请求后台打开指定 AI 站点侧栏。 */
  function openAiPanel(siteId) {
    const site = resolveAiSite(siteId);
    const theme = readSidePanelTheme();
    try {
      chrome.runtime.sendMessage(
        { type: 'open-ai-panel', siteId: site.id, theme },
        (response) => {
          if (chrome.runtime.lastError) {
            warn('打开 AI 对话侧栏失败', chrome.runtime.lastError.message);
            showToast('请点击浏览器工具栏的扩展图标打开侧栏');
            return;
          }
          if (!response?.ok) {
            warn('打开 AI 对话侧栏失败', response?.error);
            showToast('请点击浏览器工具栏的扩展图标打开侧栏');
            return;
          }
          state.aiSite = response.siteId || site.id;
          updateAiMenuActive();
          updateAiTrigger();
        },
      );
    } catch (error) {
      warn('打开 AI 对话侧栏失败', error);
      showToast('扩展已更新，请刷新页面后重试');
    }
  }

  /** 点击悬浮按钮：展开站点菜单；只有点击菜单里的 logo 才打开侧栏。 */
  function openGlmPanel(event) {
    event.preventDefault();
    event.stopPropagation();
    openAiMenu();
  }

  /** 从本地存储恢复上次选择的 AI 站点。 */
  async function loadAiSite() {
    try {
      const data = await chrome.storage.local.get('ocAiSite');
      const site = resolveAiSite(data?.ocAiSite);
      state.aiSite = site.id;
      updateAiMenuActive();
      updateAiTrigger();
    } catch (error) {
      warn('读取 AI 站点失败', error);
    }
  }

  /** 监听站点选择变化，同步菜单状态。 */
  function bindAiSiteStorage() {
    if (state.aiStorageBound) return;
    state.aiStorageBound = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.ocAiSite) return;
      const site = resolveAiSite(changes.ocAiSite.newValue);
      state.aiSite = site.id;
      updateAiMenuActive();
      updateAiTrigger();
    });
  }

  /** 计算悬浮按钮位置；优先放在输入框右侧并底部对齐，空间不足时放到右上角内侧。 */
  function positionGlmLauncher(composer = findActiveComposer()) {
    const button = state.glmLauncher;
    if (!button) return;

    const form = composer?.form;
    if (!form || !form.isConnected) {
      hideGlmLauncher();
      return;
    }

    const rect = form.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hideGlmLauncher();
      return;
    }

    const size = 32;
    const gap = 8;
    const groupWidth = size * 2 + gap;
    const trigger = state.bookmarkTrigger;
    const rail = state.rail && !state.rail.hidden ? state.rail : null;
    const railRect = rail ? rail.getBoundingClientRect() : null;
    const rightLimit = Math.min(
      window.innerWidth - 8,
      railRect ? railRect.left - 6 : window.innerWidth - 8,
    );

    let left = rect.right + gap;
    let top = rect.bottom - size;
    let inside = false;

    if (left + groupWidth > rightLimit) {
      inside = true;
      top = rect.top + gap;
      const bookmarkLeft = rect.right - gap - size;
      left = bookmarkLeft - gap - size;
    }

    left = Math.max(8, Math.min(window.innerWidth - groupWidth - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - size - 8, top));

    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
    button.dataset.inside = inside ? 'true' : 'false';
    button.hidden = false;

    if (trigger) {
      trigger.style.left = `${Math.round(left + size + gap)}px`;
      trigger.style.top = `${Math.round(top)}px`;
      trigger.dataset.inside = inside ? 'true' : 'false';
      trigger.hidden = false;
    }

    if (state.aiMenu?.dataset.open === 'true') positionAiMenu();
  }

  /** 合并布局变化，在下一帧重新定位悬浮按钮。 */
  function scheduleGlmPosition() {
    if (state.glmFrame) return;
    state.glmFrame = window.requestAnimationFrame(() => {
      state.glmFrame = 0;
      positionGlmLauncher();
    });
  }

  /** 确保悬浮按钮跟随当前 Composer；切换会话或 tab 时重新绑定观察器。 */
  function ensureGlmLauncher(composer) {
    const button = state.glmLauncher;
    if (!button) return;

    const form = composer?.form;
    if (!form) {
      hideGlmLauncher();
      return;
    }

    if (state.glmAnchor !== form) {
      state.glmObserver?.disconnect();
      state.glmAnchor = form;
      state.glmObserver = new ResizeObserver(() => scheduleGlmPosition());
      state.glmObserver.observe(form);
    }

    positionGlmLauncher(composer);
  }

  /** 隐藏悬浮按钮。 */
  function hideGlmLauncher() {
    if (state.glmLauncher) state.glmLauncher.hidden = true;
    if (state.bookmarkTrigger) state.bookmarkTrigger.hidden = true;
    hideAiMenu();
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
    if (!sessionID) {
      hideGlmLauncher();
      return;
    }

    const composer = findActiveComposer();
    if (!composer) {
      hideGlmLauncher();
      return;
    }

    ensureGlmLauncher(composer);
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
    if (state.glmObserver) {
      state.glmObserver.disconnect();
      state.glmObserver = null;
    }
    if (state.glmFrame) {
      window.cancelAnimationFrame(state.glmFrame);
      state.glmFrame = 0;
    }
    state.glmAnchor = null;
    hideGlmLauncher();
    hideBookmarksDrawer();
    hideNoteDialog();
    state.bookmarkSelection.clear();
    if (state.bookmarksSearch) state.bookmarksSearch.value = '';
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
    state.sessionTitle = '';
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

      state.sessionTitle =
        typeof detail?.title === 'string' && detail.title.trim() ? detail.title.trim() : '';

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
    scheduleGlmPosition();
    positionBookmarksTrigger();
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
    bindAiSiteStorage();
    void loadAiSite();
    bindBookmarkStorage();
    void loadBookmarks();
    document.addEventListener('keydown', onGlobalKeyDown, true);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
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
