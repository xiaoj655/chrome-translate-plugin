/**
 * Smart Translate - Popup Script
 * 设置页面逻辑
 */

document.addEventListener('DOMContentLoaded', () => {
  // 元素引用
  const elements = {
    baseUrl: document.getElementById('baseUrl'),
    apiKey: document.getElementById('apiKey'),
    model: document.getElementById('model'),
    triggerKey: document.getElementById('triggerKey'),
    toggleApiKey: document.getElementById('toggleApiKey'),
    testConnection: document.getElementById('testConnection'),
    testResult: document.getElementById('testResult'),
    saveBtn: document.getElementById('saveBtn'),
    saveStatus: document.getElementById('saveStatus')
  };

  // 加载保存的配置
  loadConfig();

  // 绑定事件
  bindEvents();

  /**
   * 加载配置
   */
  async function loadConfig() {
    try {
      const config = await chrome.storage.sync.get({
        baseUrl: '',
        apiKey: '',
        model: 'gpt-3.5-turbo',
        triggerKey: 'Control'
      });

      elements.baseUrl.value = config.baseUrl;
      elements.apiKey.value = config.apiKey;
      elements.model.value = config.model;
      elements.triggerKey.value = config.triggerKey;
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  /**
   * 绑定事件
   */
  function bindEvents() {
    // 切换API Key可见性
    elements.toggleApiKey.addEventListener('click', () => {
      const input = elements.apiKey;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      elements.toggleApiKey.title = isPassword ? '隐藏' : '显示';
    });

    // 测试连接
    elements.testConnection.addEventListener('click', testConnection);

    // 保存设置
    elements.saveBtn.addEventListener('click', saveConfig);

    // 回车键保存
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        saveConfig();
      }
    });
  }

  /**
   * 测试API连接
   */
  async function testConnection() {
    const btn = elements.testConnection;
    const result = elements.testResult;

    // 获取当前输入的配置
    const config = {
      baseUrl: elements.baseUrl.value.trim(),
      apiKey: elements.apiKey.value.trim(),
      model: elements.model.value.trim() || 'gpt-3.5-turbo'
    };

    // 验证必填字段
    if (!config.baseUrl) {
      showTestResult('请输入 API Base URL', false);
      return;
    }
    if (!config.apiKey) {
      showTestResult('请输入 API Key', false);
      return;
    }

    // 显示加载状态
    btn.classList.add('loading');
    btn.disabled = true;
    result.classList.remove('show');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'testConnection',
        config: config
      });

      if (response.success) {
        showTestResult(response.message || '连接成功！', true);
      } else {
        showTestResult(response.error || '连接失败', false);
      }
    } catch (error) {
      showTestResult('测试失败: ' + error.message, false);
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  /**
   * 显示测试结果
   */
  function showTestResult(message, success) {
    const result = elements.testResult;
    result.textContent = message;
    result.className = 'test-result show ' + (success ? 'success' : 'error');
  }

  /**
   * 保存配置
   */
  async function saveConfig() {
    const config = {
      baseUrl: elements.baseUrl.value.trim(),
      apiKey: elements.apiKey.value.trim(),
      model: elements.model.value.trim() || 'gpt-3.5-turbo',
      triggerKey: elements.triggerKey.value
    };

    try {
      await chrome.storage.sync.set(config);
      showSaveStatus('设置已保存');
    } catch (error) {
      console.error('Failed to save config:', error);
      showSaveStatus('保存失败: ' + error.message);
    }
  }

  /**
   * 显示保存状态
   */
  function showSaveStatus(message) {
    const status = elements.saveStatus;
    status.textContent = message;
    status.classList.add('show');

    setTimeout(() => {
      status.classList.remove('show');
    }, 2000);
  }
});
