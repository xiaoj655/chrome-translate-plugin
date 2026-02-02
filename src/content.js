/**
 * Smart Translate - Content Script
 * 划词翻译核心功能
 */

(function() {
  'use strict';

  // 状态管理
  const state = {
    selectedText: '',
    selectionRect: null,
    triggerDot: null,
    panel: null,
    isTranslating: false,
    triggerKey: 'Control', // 默认触发键
    abortController: null
  };

  // 默认配置
  const DEFAULT_CONFIG = {
    triggerKey: 'Control',
    baseUrl: '',
    apiKey: '',
    model: 'gpt-3.5-turbo'
  };

  // 初始化
  async function init() {
    await loadConfig();
    bindEvents();
  }

  // 加载配置
  async function loadConfig() {
    try {
      const config = await chrome.storage.sync.get(DEFAULT_CONFIG);
      state.triggerKey = config.triggerKey || 'Control';
    } catch (e) {
      console.error('Smart Translate: Failed to load config', e);
    }
  }

  // 绑定事件
  function bindEvents() {
    // 鼠标抬起 - 检测选中文本
    document.addEventListener('mouseup', handleMouseUp);
    
    // 鼠标按下 - 隐藏UI
    document.addEventListener('mousedown', handleMouseDown);
    
    // 键盘事件 - 快捷键触发
    document.addEventListener('keydown', handleKeyDown);
    
    // ESC关闭
    document.addEventListener('keyup', handleKeyUp);

    // 监听配置变化
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.triggerKey) {
        state.triggerKey = changes.triggerKey.newValue;
      }
    });
  }

  // 处理鼠标抬起
  function handleMouseUp(e) {
    // 忽略在翻译面板内的操作（包括选择文本）
    if (state.panel && state.panel.contains(e.target)) {
      return;
    }
    if (state.triggerDot && state.triggerDot.contains(e.target)) {
      return;
    }

    const selection = window.getSelection();
    const text = selection.toString().trim();

    // 检查选区是否在面板内
    if (text && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (state.panel && state.panel.contains(range.commonAncestorContainer)) {
        return;
      }
    }

    if (text && text.length > 0) {
      state.selectedText = text;
      state.selectionRect = getSelectionRect(selection);
      showTriggerDot();
    } else {
      hideTriggerDot();
    }
  }

  // 处理鼠标按下
  function handleMouseDown(e) {
    // 检查是否点击在面板或小圆点上
    const isOnPanel = state.panel && state.panel.contains(e.target);
    const isOnTriggerDot = state.triggerDot && state.triggerDot.contains(e.target);
    
    // 如果点击在 UI 元素上，不做任何处理
    if (isOnPanel || isOnTriggerDot) {
      return;
    }
    
    // 点击其他地方时，隐藏 UI
    hidePanel();
    hideTriggerDot();
  }

  // 处理键盘按下
  function handleKeyDown(e) {
    // 检查是否有选中文本且按下了触发键
    if (state.selectedText && e.key === state.triggerKey && !state.isTranslating) {
      e.preventDefault();
      triggerTranslation();
    }
  }

  // 处理键盘抬起
  function handleKeyUp(e) {
    if (e.key === 'Escape') {
      hidePanel();
      hideTriggerDot();
    }
  }

  // 获取选中文本的位置
  function getSelectionRect(selection) {
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    if (rects.length === 0) return null;
    
    // 返回最后一个rect（选中文本的末尾位置）
    const lastRect = rects[rects.length - 1];
    return {
      left: lastRect.right + window.scrollX,
      top: lastRect.bottom + window.scrollY,
      width: lastRect.width,
      height: lastRect.height
    };
  }

  // 显示触发小圆点
  function showTriggerDot() {
    if (!state.selectionRect) return;

    if (!state.triggerDot) {
      state.triggerDot = document.createElement('div');
      state.triggerDot.className = 'st-trigger-dot';
      document.body.appendChild(state.triggerDot);

      // 鼠标悬浮触发翻译
      state.triggerDot.addEventListener('mouseenter', () => {
        if (!state.isTranslating) {
          triggerTranslation();
        }
      });
    }

    // 定位小圆点
    const { left, top } = state.selectionRect;
    state.triggerDot.style.left = `${left + 5}px`;
    state.triggerDot.style.top = `${top + 5}px`;

    // 显示动画
    requestAnimationFrame(() => {
      state.triggerDot.classList.add('st-visible');
    });
  }

  // 隐藏触发小圆点
  function hideTriggerDot(clearState = true) {
    if (state.triggerDot) {
      state.triggerDot.classList.remove('st-visible');
    }
    if (clearState) {
      state.selectedText = '';
      state.selectionRect = null;
    }
  }

  // 触发翻译
  async function triggerTranslation() {
    if (!state.selectedText || state.isTranslating) return;

    // 保存当前选中的文本，因为后续操作可能会清空选区
    const textToTranslate = state.selectedText;
    
    // 隐藏小圆点但不清空状态（保留 selectionRect 用于定位面板）
    hideTriggerDot(false);
    showPanel();
    await translate(textToTranslate);
  }

  // 显示翻译面板
  function showPanel() {
    if (!state.selectionRect) return;

    if (!state.panel) {
      state.panel = document.createElement('div');
      state.panel.className = 'st-panel';
      document.body.appendChild(state.panel);
    }

    // 初始内容 - 加载状态
    state.panel.innerHTML = `
      <div class="st-panel-content">
        <div class="st-loading">
          <div class="st-loading-spinner"></div>
          <span>翻译中...</span>
        </div>
      </div>
    `;

    // 定位面板
    positionPanel();

    // 显示动画
    requestAnimationFrame(() => {
      state.panel.classList.add('st-visible');
    });
  }

  // 定位面板
  function positionPanel() {
    if (!state.panel || !state.selectionRect) return;

    const { left, top } = state.selectionRect;
    const panelRect = state.panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    let panelLeft = left;
    let panelTop = top + 10;

    // 检查右边界
    if (panelLeft + panelRect.width > viewportWidth + scrollX - 20) {
      panelLeft = viewportWidth + scrollX - panelRect.width - 20;
    }

    // 检查左边界
    if (panelLeft < scrollX + 20) {
      panelLeft = scrollX + 20;
    }

    // 检查下边界 - 如果超出则显示在选中文本上方
    if (panelTop + panelRect.height > viewportHeight + scrollY - 20) {
      panelTop = state.selectionRect.top - state.selectionRect.height - panelRect.height - 10;
    }

    state.panel.style.left = `${panelLeft}px`;
    state.panel.style.top = `${panelTop}px`;
  }

  // 隐藏面板
  function hidePanel() {
    if (state.panel) {
      state.panel.classList.remove('st-visible');
      // 取消正在进行的翻译请求
      if (state.abortController) {
        state.abortController.abort();
        state.abortController = null;
      }
    }
    state.isTranslating = false;
  }

  // 翻译逻辑
  async function translate(text) {
    state.isTranslating = true;
    state.abortController = new AbortController();

    try {
      // 判断是单词还是段落
      const isWord = isSingleWord(text);
      
      // 发送消息给background script进行API调用
      const response = await chrome.runtime.sendMessage({
        type: 'translate',
        text: text,
        isWord: isWord
      });

      if (response.error) {
        showError(response.error);
        return;
      }

      // Qwen-MT 模型只返回翻译结果，不支持词典模式
      if (response.isQwenMT) {
        renderParagraphResult(text, response.data);
      } else if (isWord) {
        renderWordResult(response.data);
      } else {
        renderParagraphResult(text, response.data);
      }

    } catch (error) {
      if (error.name !== 'AbortError') {
        showError(error.message || '翻译失败，请检查网络连接和API配置');
      }
    } finally {
      state.isTranslating = false;
    }
  }

  // 判断是否为单个单词
  function isSingleWord(text) {
    // 去除首尾空格后，检查是否只包含字母、连字符或撇号（英文单词）
    const trimmed = text.trim();
    // 单词模式：只有一个词，没有空格
    if (/\s/.test(trimmed)) return false;
    // 检查是否是英文单词（允许连字符和撇号）
    return /^[a-zA-Z][a-zA-Z'-]*[a-zA-Z]?$/.test(trimmed) && trimmed.length <= 30;
  }

  // 渲染单词结果
  function renderWordResult(data) {
    if (!state.panel) return;

    const content = state.panel.querySelector('.st-panel-content');
    if (!content) return;

    try {
      const wordData = typeof data === 'string' ? JSON.parse(data) : data;
      
      let html = '<div class="st-word-section">';
      
      // 单词和音标
      html += `
        <div class="st-word-header">
          <span class="st-word-text">${escapeHtml(wordData.word || '')}</span>
          ${wordData.phonetic ? `<span class="st-word-phonetic">${escapeHtml(wordData.phonetic)}</span>` : ''}
        </div>
      `;

      // 释义
      if (wordData.meanings && wordData.meanings.length > 0) {
        wordData.meanings.forEach(meaning => {
          html += `<div class="st-meaning-group">`;
          html += `<span class="st-pos">${escapeHtml(meaning.pos || '')}</span>`;
          
          if (meaning.definitions && meaning.definitions.length > 0) {
            html += '<ul class="st-definitions">';
            meaning.definitions.forEach(def => {
              html += `<li class="st-definition-item">${escapeHtml(def)}</li>`;
            });
            html += '</ul>';
          }

          // 例句
          if (meaning.examples && meaning.examples.length > 0) {
            html += '<div class="st-examples">';
            meaning.examples.forEach(example => {
              if (typeof example === 'object') {
                html += `
                  <div class="st-example-item">
                    <div class="st-example-en">${escapeHtml(example.en || '')}</div>
                    <div class="st-example-zh">${escapeHtml(example.zh || '')}</div>
                  </div>
                `;
              } else {
                html += `<div class="st-example-item">${escapeHtml(example)}</div>`;
              }
            });
            html += '</div>';
          }

          html += '</div>';
        });
      }

      html += '</div>';

      content.innerHTML = html;
      positionPanel();

    } catch (e) {
      // 如果JSON解析失败，当作普通文本显示
      renderParagraphResult(state.selectedText, data);
    }
  }

  // 渲染段落翻译结果
  function renderParagraphResult(original, translated) {
    if (!state.panel) return;

    const content = state.panel.querySelector('.st-panel-content');
    if (!content) return;

    content.innerHTML = `
      <div class="st-paragraph-section">
        <div class="st-original-text">
          <span class="st-original-label">原文</span>
          <div>${escapeHtml(original)}</div>
        </div>
        <div class="st-translated-text">
          <span class="st-translated-label">译文</span>
          <div>${escapeHtml(translated)}</div>
        </div>
      </div>
    `;

    positionPanel();
  }

  // 显示错误
  function showError(message) {
    if (!state.panel) return;

    const content = state.panel.querySelector('.st-panel-content');
    if (!content) return;

    let errorMessage = message;
    let suggestion = '';

    if (message.includes('API') || message.includes('配置')) {
      suggestion = '请点击扩展图标配置 API 参数';
    } else if (message.includes('网络') || message.includes('fetch')) {
      suggestion = '请检查网络连接';
    }

    content.innerHTML = `
      <div class="st-error">
        <div class="st-error-title">翻译失败</div>
        <div class="st-error-message">${escapeHtml(errorMessage)}</div>
        ${suggestion ? `<div style="margin-top: 8px; color: #666;">${escapeHtml(suggestion)}</div>` : ''}
      </div>
    `;

    positionPanel();
  }

  // HTML转义
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 启动
  init();
})();
