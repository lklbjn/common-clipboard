<script setup>
import { ref, onMounted, watch } from 'vue';
import { io } from 'socket.io-client';
import CryptoJS from 'crypto-js';
import LockIcon from './assets/icons/lock.svg';

// 剪切板数据
const clipboards = ref([]);
const activeClipboardId = ref('default');
const socket = ref(null);
const showNameDialog = ref(false);
const newClipboardName = ref('');
const tempClipboardId = ref('');
const newClipboardPassword = ref('');
const showPasswordDialog = ref(false);
const passwordInput = ref('');
const currentClipboardId = ref('');

// WebSocket连接配置
const wsAddress = ref(localStorage.getItem('wsAddress') || 'http://localhost:3000');
const isConnected = ref(false);
const isConnecting = ref(false);
const connectionError = ref('');

// 连接WebSocket
const connectWebSocket = () => {
  if (socket.value) {
    socket.value.disconnect();
  }

  isConnecting.value = true;
  connectionError.value = '';

  try {
    socket.value = io(wsAddress.value);

    socket.value.on('connect', () => {
      isConnected.value = true;
      isConnecting.value = false;
      connectionError.value = '';
      localStorage.setItem('wsAddress', wsAddress.value);

      // 发送设备信息
      socket.value.emit('device-info', {
        browser: navigator.userAgent,
        os: navigator.platform,
        device: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop'
      });
    });

    socket.value.on('connect_error', (error) => {
      isConnected.value = false;
      isConnecting.value = false;
      connectionError.value = '连接失败：' + error.message;
    });

    socket.value.on('disconnect', () => {
      isConnected.value = false;
    });

    // 初始化剪切板数据
    socket.value.on('init-clipboards', (data) => {
      clipboards.value = data;
      // 确保在收到初始数据后更新activeClipboard
      const defaultClipboard = data.find(clip => clip.id === 'default');
      if (defaultClipboard) {
        activeClipboard.value = defaultClipboard;
      }
    });

    // 监听剪切板更新
    socket.value.on('clipboard-updated', (data) => {
      clipboards.value = data.map(clip => {
        if (clip.isEncrypted && clip.content) {
          try {
            const password = localStorage.getItem(`clipboard-${clip.id}-password`);
            if (password) {
              const bytes = CryptoJS.AES.decrypt(clip.content, password);
              return { ...clip, content: bytes.toString(CryptoJS.enc.Utf8) };
            }
          } catch (error) {
            console.error('解密失败:', error);
            showToastMessage('内容解密失败，请检查密码');
          }
        }
        return clip;
      });

      const currentClipboard = clipboards.value.find(clip => clip.id === activeClipboardId.value);
      if (currentClipboard) {
        activeClipboard.value = currentClipboard;
      }
    });
  } catch (error) {
    isConnected.value = false;
    isConnecting.value = false;
    connectionError.value = '连接错误：' + error.message;
  }
};

onMounted(() => {
  connectWebSocket();

  // 初始化剪切板数据
  socket.value.on('init-clipboards', (data) => {
    clipboards.value = data;
    // 确保在收到初始数据后更新activeClipboard
    const defaultClipboard = data.find(clip => clip.id === 'default');
    if (defaultClipboard) {
      activeClipboard.value = defaultClipboard;
    }
  });

  // 监听剪切板更新
  socket.value.on('clipboard-updated', (data) => {
    clipboards.value = data;
    // 同步更新当前活动的剪切板
    const currentClipboard = data.find(clip => clip.id === activeClipboardId.value);
    if (currentClipboard) {
      activeClipboard.value = currentClipboard;
    }
  });
});

// 获取当前活动的剪切板
const activeClipboard = ref({ id: 'default', content: '' });
watch(activeClipboardId, (newId) => {
  const found = clipboards.value.find(clip => clip.id === newId);
  if (found) {
    activeClipboard.value = found;
  }
});

// 防抖函数
const debounce = (fn, delay) => {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
};

// 监听剪切板内容变化
watch(() => activeClipboard.value.content, debounce((newContent) => {
  console.log('剪贴板内容已更新：', clipboards.value);
  if (socket.value) {
    // 保留所有原有字段，只更新content
    socket.value.emit('update-clipboard', {
      id: activeClipboard.value.id,
      content: newContent,
      name: activeClipboard.value.name,
      isEncrypted: activeClipboard.value.isEncrypted,
      encryptedKey: activeClipboard.value.encryptedKey
    });
  }
}, 300));

// 添加新剪切板
const addClipboard = () => {
  tempClipboardId.value = `clipboard-${Date.now()}`;
  newClipboardName.value = '';
  newClipboardPassword.value = '';
  showNameDialog.value = true;
};

// 确认添加新剪贴板
const confirmAddClipboard = async () => {
  const name = newClipboardName.value.trim() || `剪贴板 ${clipboards.value.length}`;
  const password = newClipboardPassword.value;

  const newClipboard = {
    content: '',
    name: name,
    isEncrypted: !!password,
    password: password // 只在创建时传递密码
  };

  try {
    const response = await fetch(`${wsAddress.value}/api/clipboards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newClipboard)
    });

    if (!response.ok) {
      throw new Error('创建剪贴板失败');
    }

    const result = await response.json();
    if (result.success) {
      activeClipboardId.value = result.id;
      showNameDialog.value = false;
      showToastMessage('创建成功！');
    }
  } catch (error) {
    console.error('创建剪贴板失败:', error);
    showToastMessage('创建失败: ' + error.message);
  }
};

// 切换剪贴板
const switchClipboard = async (id) => {
  const clipboard = clipboards.value.find(clip => clip.id === id);
  if (clipboard && clipboard.isEncrypted) {
    try {
      console.log("剪切板", `${clipboard.id}`);
      console.log("密码：", `${clipboard.id}-password`);
      const response = await fetch(`${wsAddress.value}/api/clipboards/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: id,
          password: localStorage.getItem(`${clipboard.id}-password`) || ''
        })
      });

      if (!response.ok) {
        currentClipboardId.value = id;
        showPasswordDialog.value = true;
        return;
      }

      const result = await response.json();
      if (!result.isValid) {
        showToastMessage('保存的密码已失效，请重新输入');
        currentClipboardId.value = id;
        showPasswordDialog.value = true;
        return;
      }
    } catch (error) {
      console.error('密码验证失败:', error);
      showToastMessage('密码验证服务不可用');
      return;
    }
  }
  activeClipboardId.value = id;
};

// 验证密码
const verifyPassword = async () => {
  const clipboard = clipboards.value.find(clip => clip.id === currentClipboardId.value);
  if (!clipboard) {
    showToastMessage('剪贴板不存在');
    return;
  }

  try {
    const response = await fetch(`${wsAddress.value}/api/clipboards/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: clipboard.id,
        password: passwordInput.value
      })
    });

    const result = await response.json();
    if (result.isValid) {
      showPasswordDialog.value = false;
      showToastMessage('密码验证成功！');
      clipboard.content = result.content;
      // 保存密码到本地存储
      localStorage.setItem(`${clipboard.id}-password`, passwordInput.value);
      // 设置当前活动剪贴板
      activeClipboardId.value = clipboard.id;
      activeClipboard.value = clipboard;
    } else {
      showToastMessage('密码验证失败！');
    }
  } catch (error) {
    console.error('密码验证失败:', error);
    showToastMessage('密码验证失败: ' + error.message);
  }
};

// 删除剪切板相关状态
const showDeletePasswordDialog = ref(false);
const deletePasswordInput = ref('');
const clipboardToDelete = ref(null);

// 删除剪切板
const deleteClipboard = (id) => {
  if (id === 'default') return; // 不允许删除默认剪切板
  const clipboard = clipboards.value.find(clip => clip.id === id);
  if (clipboard && clipboard.isEncrypted) {
    // 如果是加密的剪切板，需要验证密码
    clipboardToDelete.value = clipboard;
    deletePasswordInput.value = '';
    showDeletePasswordDialog.value = true;
  } else {
    confirmDeleteClipboard(id);
  }
};

// 验证删除密码
const verifyDeletePassword = async () => {
  if (!clipboardToDelete.value) return;

  try {
    const response = await fetch(`${wsAddress.value}/api/clipboards/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: clipboardToDelete.value.id,
        password: deletePasswordInput.value
      })
    });

    const result = await response.json();
    if (result.isValid) {
      showDeletePasswordDialog.value = false;
      confirmDeleteClipboard(clipboardToDelete.value.id);
    } else {
      showToastMessage('密码验证失败！');
    }
  } catch (error) {
    console.error('密码验证失败:', error);
    showToastMessage('密码验证失败: ' + error.message);
  }
};

// 确认删除剪切板
const confirmDeleteClipboard = (id) => {
  clipboards.value = clipboards.value.filter(clip => clip.id !== id);
  // 如果删除的是当前活动的剪切板，则切换到默认剪切板
  if (activeClipboardId.value === id) {
    activeClipboardId.value = 'default';
  }
  if (socket.value) {
    socket.value.emit('delete-clipboard', id);
  }
  showToastMessage('删除成功！');
};

// Toast提示状态
const showToast = ref(false);
const toastMessage = ref('');

// 显示Toast提示
const showToastMessage = (message) => {
  toastMessage.value = message;
  showToast.value = true;
  setTimeout(() => {
    showToast.value = false;
  }, 2000);
};

// 复制剪贴板内容
const copyClipboardContent = () => {
  if (!activeClipboard.value.content) return;

  // 检查是否支持 Clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(activeClipboard.value.content)
      .then(() => {
        showToastMessage('复制成功！');
      })
      .catch(err => {
        fallbackCopy();
      });
  } else {
    fallbackCopy();
  }
};

// 备选的复制方案
const fallbackCopy = () => {
  try {
    // 创建临时文本区域
    const textArea = document.createElement('textarea');
    textArea.value = activeClipboard.value.content;

    // 确保文本区域在视口之外
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    // 尝试执行复制命令
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);

    if (successful) {
      showToastMessage('复制成功！');
    } else {
      showToastMessage('复制失败，请手动选择文本并使用 Ctrl+C（或 Command+C）复制。');
    }
  } catch (err) {
    showToastMessage('复制失败，请手动选择文本并使用 Ctrl+C（或 Command+C）复制。');
  }
};
</script>

<template>
  <div class="container">
    <header>
      <h1>公共剪切板</h1>
      <p class="subtitle">在不同设备间共享文本内容</p>
      <div class="connection-config">
        <input type="text" v-model="wsAddress" placeholder="WebSocket服务器地址" class="ws-input" :disabled="isConnecting">
        <button @click="connectWebSocket" class="connect-button" :disabled="isConnecting">
          {{ isConnecting ? '连接中...' : '连接' }}
        </button>
        <span class="connection-status" :class="{ connected: isConnected }">
          {{ isConnected ? '已连接' : '未连接' }}
        </span>
        <span v-if="connectionError" class="connection-error">
          {{ connectionError }}
        </span>
      </div>
    </header>

    <div class="tabs">
      <div v-for="clipboard in clipboards" :key="clipboard.id"
        :class="['tab', { active: activeClipboardId === clipboard.id }]" @click="switchClipboard(clipboard.id)">
        <span class="tab-name">
          {{ clipboard.id === 'default' ? '默认' : (clipboard.name || `剪切板 ${clipboards.indexOf(clipboard)}`) }}
          <img v-if="clipboard.isEncrypted" :src="LockIcon" class="lock-icon" alt="locked" />
        </span>
        <button v-if="clipboard.id !== 'default'" class="tab-close" @click.stop="deleteClipboard(clipboard.id)">
          &times;
        </button>
      </div>
      <button class="add-tab" @click="addClipboard">+</button>
    </div>

    <div class="editor-container">
      <div class="editor-header">
        <button class="copy-button" @click="copyClipboardContent">
          <span class="copy-icon">📋</span>
          复制内容
        </button>
      </div>
      <textarea v-model="activeClipboard.content" class="editor" placeholder="在此输入文本..."></textarea>
    </div>

    <footer>
      <p>多设备实时同步 | 数据保存在服务器</p>
    </footer>
  </div>
  <!-- 新建剪贴板名称对话框 -->
  <div v-if="showNameDialog" class="dialog-overlay">
    <div class="dialog">
      <h3>新建剪贴板</h3>
      <input type="text" v-model="newClipboardName" placeholder="请输入剪贴板名称" class="dialog-input">
      <input type="password" v-model="newClipboardPassword" placeholder="设置密码（可选）" class="dialog-input">
      <div class="dialog-buttons">
        <button @click="showNameDialog = false" class="dialog-button cancel">取消</button>
        <button @click="confirmAddClipboard" class="dialog-button confirm">确定</button>
      </div>
    </div>
  </div>
  <!-- 密码验证对话框 -->
  <div v-if="showPasswordDialog" class="dialog-overlay">
    <div class="dialog">
      <h3>请输入密码</h3>
      <input type="password" v-model="passwordInput" placeholder="请输入访问密码" class="dialog-input"
        @keyup.enter="verifyPassword">
      <div class="dialog-buttons">
        <button @click="showPasswordDialog = false" class="dialog-button cancel">取消</button>
        <button @click="verifyPassword" class="dialog-button confirm">确定</button>
      </div>
    </div>
  </div>
  <!-- 删除密码验证对话框 -->
  <div v-if="showDeletePasswordDialog" class="dialog-overlay">
    <div class="dialog">
      <h3>请输入密码以删除剪切板</h3>
      <input type="password" v-model="deletePasswordInput" placeholder="请输入访问密码" class="dialog-input"
        @keyup.enter="verifyDeletePassword">
      <div class="dialog-buttons">
        <button @click="showDeletePasswordDialog = false" class="dialog-button cancel">取消</button>
        <button @click="verifyDeletePassword" class="dialog-button confirm">确定</button>
      </div>
    </div>
  </div>
  <!-- Toast提示组件 -->
  <Transition name="toast">
    <div v-if="showToast" class="toast">
      {{ toastMessage }}
    </div>
  </Transition>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background-color: #f5f5f5;
  color: #333;
}

.container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
}

header {
  text-align: center;
  margin-bottom: 20px;
}

h1 {
  color: #2c3e50;
  margin-bottom: 5px;
}

.subtitle {
  color: #7f8c8d;
}

.connection-config {
  margin-top: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ws-input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  width: 300px;
  font-size: 14px;
}

.connect-button {
  padding: 8px 16px;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
}

.connect-button:hover:not(:disabled) {
  background-color: #2980b9;
}

.connect-button:disabled {
  background-color: #95a5a6;
  cursor: not-allowed;
}

.connection-status {
  padding: 4px 8px;
  background-color: #e74c3c;
  color: white;
  border-radius: 4px;
  font-size: 12px;
}

.connection-status.connected {
  background-color: #2ecc71;
}

.connection-error {
  color: #e74c3c;
  font-size: 12px;
}

.tabs {
  display: flex;
  background-color: #fff;
  border-radius: 8px 8px 0 0;
  overflow-x: auto;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.tab {
  padding: 12px 20px;
  cursor: pointer;
  border-right: 1px solid #eee;
  display: flex;
  align-items: center;
  white-space: nowrap;
  transition: background-color 0.3s;
}

.tab.active {
  background-color: #3498db;
  color: white;
}

.tab-name {
  margin-right: 8px;
}

.lock-icon {
  width: 14px;
  height: 14px;
  vertical-align: -2px;
  margin-left: 4px;
  color: currentColor;
  /* 确保SVG图标继承父元素的颜色 */
}

.tab-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.3s;
}

.tab-close:hover {
  opacity: 1;
}

.add-tab {
  padding: 12px 15px;
  background-color: #ecf0f1;
  border: none;
  cursor: pointer;
  font-size: 18px;
  transition: background-color 0.3s;
}

.add-tab:hover {
  background-color: #dde4e6;
}

.editor-container {
  background-color: #fff;
  border-radius: 0 0 8px 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.editor {
  width: 100%;
  height: 400px;
  padding: 15px;
  border: 1px solid #ddd;
  border-radius: 4px;
  resize: vertical;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 16px;
  line-height: 1.5;
}

footer {
  margin-top: 20px;
  text-align: center;
  color: #7f8c8d;
  font-size: 14px;
}

/* 对话框样式 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.dialog {
  background-color: white;
  border-radius: 8px;
  padding: 20px;
  width: 400px;
  max-width: 90%;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.dialog h3 {
  margin-bottom: 15px;
  color: #2c3e50;
}

.dialog-input {
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 15px;
  font-size: 16px;
}

.dialog-buttons {
  display: flex;
  justify-content: flex-end;
}

.dialog-button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  margin-left: 10px;
}

.dialog-button.cancel {
  background-color: #ecf0f1;
  color: #7f8c8d;
}

.dialog-button.confirm {
  background-color: #3498db;
  color: white;
}

/* 移动端适配 */
@media screen and (max-width: 768px) {
  .container {
    padding: 10px;
  }

  .connection-config {
    flex-direction: column;
    gap: 8px;
  }

  .ws-input {
    width: 100%;
    max-width: none;
  }

  .tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 5px;
  }

  .tab {
    padding: 8px 12px;
    font-size: 14px;
  }

  .editor {
    height: 300px;
    font-size: 14px;
  }

  .dialog {
    width: 90%;
    margin: 0 10px;
  }
}

/* 复制按钮样式 */
.editor-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.copy-button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 16px;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
}

.copy-button:hover {
  background-color: #2980b9;
}

.copy-icon {
  font-size: 16px;
}

@media screen and (max-width: 480px) {
  h1 {
    font-size: 24px;
  }

  .subtitle {
    font-size: 14px;
  }

  .connection-status,
  .connection-error {
    font-size: 12px;
  }

  .copy-button {
    padding: 6px 12px;
    font-size: 12px;
  }
}

/* Toast提示样式 */
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 24px;
  background-color: rgba(52, 152, 219, 0.9);
  color: white;
  border-radius: 4px;
  font-size: 14px;
  z-index: 1001;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* Toast动画 */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}
</style>
