/**
 * Smart Translate - Background Service Worker
 * 处理LLM API调用
 */

// 默认配置
const DEFAULT_CONFIG = {
  baseUrl: '',
  apiKey: '',
  model: 'gpt-3.5-turbo',
  triggerKey: 'Control'
};

// Qwen-MT 系列模型列表
const QWEN_MT_MODELS = ['qwen-mt-plus', 'qwen-mt-flash', 'qwen-mt-lite'];

// 检测是否为 Qwen-MT 模型
function isQwenMTModel(model) {
  return QWEN_MT_MODELS.some(m => model.toLowerCase().includes(m));
}

// Prompt模板（用于通用LLM）
const PROMPTS = {
  word: `你是一个专业的英汉词典。请为以下英文单词提供详细的中文解释。
严格按照以下JSON格式返回，不要添加任何其他内容：
{
  "word": "单词原形",
  "phonetic": "音标（如 /wɜːrd/）",
  "meanings": [
    {
      "pos": "词性（如：n. 名词、v. 动词、adj. 形容词、adv. 副词等）",
      "definitions": ["中文释义1", "中文释义2"],
      "examples": [
        {"en": "英文例句", "zh": "中文翻译"}
      ]
    }
  ]
}

单词：`,

  paragraph: `请将以下英文翻译成中文。要求：
1. 翻译准确、流畅自然
2. 保持原文的语气和风格
3. 只返回翻译结果，不要添加任何解释或其他内容

原文：`
};

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'translate') {
    handleTranslation(request.text, request.isWord)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true; // 保持消息通道开放
  }
  
  if (request.type === 'testConnection') {
    testApiConnection(request.config)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

// 处理翻译请求
async function handleTranslation(text, isWord) {
  // 获取配置
  const config = await chrome.storage.sync.get(DEFAULT_CONFIG);
  
  // 验证配置
  if (!config.baseUrl || !config.apiKey) {
    return { 
      error: '请先配置 API 参数。点击扩展图标进行设置。' 
    };
  }

  try {
    // 检测是否为 Qwen-MT 模型
    if (isQwenMTModel(config.model)) {
      const response = await callQwenMTApi(config, text);
      // Qwen-MT 只返回翻译结果，不支持词典模式
      return { data: response, isQwenMT: true };
    }

    // 通用 LLM 模式
    const prompt = isWord 
      ? PROMPTS.word + text 
      : PROMPTS.paragraph + text;

    const response = await callLLMApi(config, prompt, isWord);
    return { data: response };
  } catch (error) {
    console.error('Smart Translate API Error:', error);
    throw error;
  }
}

// 调用 Qwen-MT API（专用翻译模型）
async function callQwenMTApi(config, text) {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const endpoint = `${baseUrl}/chat/completions`;

  // 简单的语种检测：如果主要是中文则翻译成英文，否则翻译成中文
  const isChinese = /[\u4e00-\u9fa5]/.test(text) && 
    (text.match(/[\u4e00-\u9fa5]/g) || []).length > text.length * 0.3;
  
  const sourceLang = isChinese ? 'Chinese' : 'auto';
  const targetLang = isChinese ? 'English' : 'Chinese';

  const requestBody = {
    model: config.model,
    messages: [
      {
        role: 'user',
        content: text
      }
    ],
    translation_options: {
      source_lang: sourceLang,
      target_lang: targetLang
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message || response.statusText;
    throw new Error(`API 请求失败: ${errorMessage}`);
  }

  const data = await response.json();
  
  if (!data.choices || data.choices.length === 0) {
    throw new Error('API 返回数据格式错误');
  }

  const content = data.choices[0].message?.content;
  
  if (!content) {
    throw new Error('API 未返回有效内容');
  }

  return content.trim();
}

// 调用LLM API
async function callLLMApi(config, prompt, isWord) {
  const baseUrl = config.baseUrl.replace(/\/$/, ''); // 移除末尾斜杠
  const endpoint = `${baseUrl}/chat/completions`;

  const requestBody = {
    model: config.model,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: isWord ? 0.3 : 0.7, // 单词模式更精确，段落模式更自然
    max_tokens: isWord ? 1000 : 2000
  };

  // 如果是单词模式，尝试使用JSON模式（如果API支持）
  if (isWord) {
    requestBody.response_format = { type: 'json_object' };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message || response.statusText;
    throw new Error(`API 请求失败: ${errorMessage}`);
  }

  const data = await response.json();
  
  if (!data.choices || data.choices.length === 0) {
    throw new Error('API 返回数据格式错误');
  }

  const content = data.choices[0].message?.content;
  
  if (!content) {
    throw new Error('API 未返回有效内容');
  }

  // 对于单词模式，尝试解析JSON
  if (isWord) {
    try {
      // 尝试提取JSON（有些模型可能会在JSON前后添加额外文本）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
    } catch (e) {
      // 如果解析失败，返回原始内容
      console.warn('JSON parse failed, returning raw content');
      return content;
    }
  }

  return content.trim();
}

// 测试API连接
async function testApiConnection(config) {
  if (!config.baseUrl || !config.apiKey) {
    return { error: '请填写完整的 API 配置' };
  }

  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const endpoint = `${baseUrl}/chat/completions`;

  try {
    let requestBody;
    
    // Qwen-MT 模型使用专用格式
    if (isQwenMTModel(config.model)) {
      requestBody = {
        model: config.model,
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ],
        translation_options: {
          source_lang: 'English',
          target_lang: 'Chinese'
        }
      };
    } else {
      requestBody = {
        model: config.model,
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ],
        max_tokens: 5
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || response.statusText;
      return { error: `连接失败: ${errorMessage}` };
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return { success: true, message: '连接成功！' };
    }

    return { error: '响应格式异常' };
  } catch (error) {
    return { error: `网络错误: ${error.message}` };
  }
}

// 安装时设置默认配置
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
    // 只设置未配置的项
    const updates = {};
    for (const key in DEFAULT_CONFIG) {
      if (items[key] === undefined) {
        updates[key] = DEFAULT_CONFIG[key];
      }
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.sync.set(updates);
    }
  });
});
