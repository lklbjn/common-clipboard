// Cloudflare Workers版本的服务器实现

// 初始化默认剪切板数据
const DEFAULT_CLIPBOARD = {
  id: 'default',
  content: '欢迎使用公共剪切板！',
  name: '默认',
  isEncrypted: false,
  passwordHash: null
};

// 存储连接的设备信息（使用内存存储，Workers重启后会重置）
let connectedDevices = new Map();

// IP黑名单（使用内存存储，Workers重启后会重置）
let ipBlacklist = new Map();

// 解密限制黑名单
let decryptBlacklist = new Map();

// 记录IP的密码错误次数
let passwordAttempts = new Map();

// 密码错误最大尝试次数
const MAX_PASSWORD_ATTEMPTS = 6;

// 检查IP是否在解密限制黑名单中
function isIpDecryptBlacklisted(ip) {
  if (decryptBlacklist.has(ip)) {
    const block = decryptBlacklist.get(ip);
    const now = new Date();
    const secondsDiff = (now - block.blockTime) / 1000;
    if (secondsDiff < block.duration) {
      return true;
    } else {
      decryptBlacklist.delete(ip);
      passwordAttempts.delete(ip);
    }
  }
  return false;
}

// 检查IP是否在黑名单中
function isIpBlacklisted(ip) {
  if (ipBlacklist.has(ip)) {
    const block = ipBlacklist.get(ip);
    const now = new Date();
    const secondsDiff = (now - block.kickTime) / 1000;
    if (secondsDiff < block.duration) {
      return true;
    } else {
      ipBlacklist.delete(ip);
    }
  }
  return false;
}

// 基本认证中间件
async function basicAuth(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/admin')) {
    return null;
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    return new Response('需要认证', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Admin Access"'
      }
    });
  }

  const [scheme, encoded] = authorization.split(' ');
  if (!encoded || scheme !== 'Basic') {
    return new Response('认证格式错误', { status: 400 });
  }

  const buffer = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const decoded = new TextDecoder().decode(buffer).toString();
  const [username, password] = decoded.split(':');

  const env = request.env || {};
  const adminUsername = env.ACCOUNT || 'admin';
  const adminPassword = env.PASSWORD || 'password';

  if (username === adminUsername && password === adminPassword) {
    return null;
  }

  return new Response('认证失败', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Admin Access"'
    }
  });
}

// 加载剪切板数据
async function loadClipboardData(env) {
  try {
    const data = await env.CLIPBOARD_STORE.get('clipboards');
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('加载剪切板数据失败:', error);
  }
  return [DEFAULT_CLIPBOARD];
}

// 保存剪切板数据
async function saveClipboardData(clipboards, env) {
  try {
    await env.CLIPBOARD_STORE.put('clipboards', JSON.stringify(clipboards));
  } catch (error) {
    console.error('保存剪切板数据失败:', error);
  }
}

// 处理请求
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for');

  // 检查IP是否在黑名单中
  if (isIpBlacklisted(clientIp)) {
    return new Response(JSON.stringify({
      error: '您的IP已被封禁，请等待解封'
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 基本认证检查
  const authResponse = await basicAuth(request);
  if (authResponse) {
    return authResponse;
  }

  // 加载剪切板数据
  let clipboards = await loadClipboardData(env);

  // 路由处理
  if (request.method === 'GET') {
    if (url.pathname === '/admin/devices') {
      return new Response(JSON.stringify(Array.from(connectedDevices.values())), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/admin/clipboards') {
      const sanitizedClipboards = clipboards.map(clip => ({
        ...clip,
        content: clip.content
      }));
      return new Response(JSON.stringify(sanitizedClipboards), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/admin/blacklist') {
      const blacklist = Array.from(ipBlacklist.entries()).map(([ip, data]) => {
        const now = new Date();
        const secondsDiff = data.duration - (now - data.kickTime) / 1000;
        return {
          ip,
          kickTime: data.kickTime.toISOString(),
          remainingHours: Math.max(0, secondsDiff)
        };
      });
      return new Response(JSON.stringify(blacklist), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/admin/decrypt-blacklist') {
      const blacklist = Array.from(decryptBlacklist.entries()).map(([ip, data]) => {
        const now = new Date();
        const secondsDiff = data.duration - (now - data.blockTime) / 1000;
        return {
          ip,
          blockTime: data.blockTime.toISOString(),
          remainingSeconds: Math.max(0, secondsDiff)
        };
      });
      return new Response(JSON.stringify(blacklist), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (request.method === 'POST') {
    const data = await request.json();

    if (url.pathname === '/api/clipboards/verify') {
      const { id, password } = data;

      if (!id || !password) {
        return new Response(JSON.stringify({ error: '缺少ID或密码参数' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (isIpDecryptBlacklisted(clientIp)) {
        const block = decryptBlacklist.get(clientIp);
        const remainingTime = Math.ceil(block.duration - (new Date() - block.blockTime) / 1000);
        return new Response(JSON.stringify({
          error: `由于多次密码错误，您的IP已被限制解密，请等待${remainingTime}秒后重试`
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const clipboard = clipboards.find(clip => clip.id === id);
      if (!clipboard) {
        return new Response(JSON.stringify({ error: '剪切板不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!clipboard.isEncrypted) {
        return new Response(JSON.stringify({
          isValid: true,
          content: clipboard.content
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const crypto = require('crypto');
      const inputHash = crypto.createHash('sha256').update(password).digest('hex');
      if (inputHash === clipboard.passwordHash) {
        passwordAttempts.delete(clientIp);
        return new Response(JSON.stringify({
          isValid: true,
          content: clipboard.content
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const attempts = (passwordAttempts.get(clientIp) || 0) + 1;
      passwordAttempts.set(clientIp, attempts);

      if (attempts >= MAX_PASSWORD_ATTEMPTS) {
        const blockTime = new Date();
        const duration = 3600;
        decryptBlacklist.set(clientIp, { blockTime, duration });
        passwordAttempts.delete(clientIp);
        return new Response(JSON.stringify({
          error: '密码错误次数过多，您的IP已被限制解密1小时'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        isValid: false,
        remainingAttempts: MAX_PASSWORD_ATTEMPTS - attempts
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/api/clipboards') {
      const { content, name, isEncrypted, password } = data;

      if (isEncrypted && !password) {
        return new Response(JSON.stringify({ error: '加密剪切板需要提供密码' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const crypto = require('crypto');
      const passwordHash = isEncrypted ? crypto.createHash('sha256').update(password).digest('hex') : null;

      // 生成新的UUID作为剪切板ID
      const newId = crypto.randomUUID();

      clipboards.push({
        id: newId,
        content,
        name,
        isEncrypted,
        passwordHash
      });

      await saveClipboardData(clipboards, env);

      return new Response(JSON.stringify({ success: true, id: newId }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/admin/blacklist') {
      const { ip, seconds } = data;

      if (!ip || !seconds) {
        return new Response(JSON.stringify({ error: '缺少必要参数' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (seconds < 1 || seconds > 2592000) {
        return new Response(JSON.stringify({ error: '封禁时长必须在1-2592000秒之间' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const kickTime = new Date();
      ipBlacklist.set(ip, { kickTime, duration: seconds });

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (request.method === 'DELETE') {
    const match = url.pathname.match(/^\/(?:api|admin)\/clipboards\/(.+)$/);
    if (match) {
      const id = match[1];

      if (id === 'default') {
        return new Response(JSON.stringify({ error: '不能删除默认剪切板' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      clipboards = clipboards.filter(clip => clip.id !== id);
      await saveClipboardData(clipboards, env);

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const blacklistMatch = url.pathname.match(/^\/admin\/blacklist\/(.+)$/);
    if (blacklistMatch) {
      const ip = blacklistMatch[1];
      if (ipBlacklist.delete(ip)) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify({ error: '指定的IP不在黑名单中' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const decryptBlacklistMatch = url.pathname.match(/^\/admin\/decrypt-blacklist\/(.+)$/);
    if (decryptBlacklistMatch) {
      const ip = decryptBlacklistMatch[1];
      if (decryptBlacklist.delete(ip)) {
        passwordAttempts.delete(ip);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify({ error: '指定的IP不在解密限制黑名单中' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  }

  return new Response('Not Found', { status: 404 });
}

// WebSocket处理（Workers不支持原生WebSocket，需要使用Durable Objects或其他方案）
async function handleWebSocket(request) {
  return new Response('WebSocket not supported in this version', { status: 400 });
}

// 导出处理函数
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      
      // WebSocket升级请求
      if (request.headers.get('Upgrade') === 'websocket') {
        return handleWebSocket(request);
      }

      // 静态文件服务
      if (url.pathname === '/' || !url.pathname.startsWith('/api') && !url.pathname.startsWith('/admin')) {
        // 在实际部署时，应该配置静态资源的服务方式
        return new Response('Static file serving not configured', { status: 404 });
      }

      return handleRequest(request, env);
    } catch (error) {
      console.error('请求处理错误:', error);
      return new Response(JSON.stringify({ error: '服务器内部错误' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};