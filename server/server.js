const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');

// 解析命令行参数获取管理员账号信息
// 从环境变量或默认值获取管理员账号信息
let adminUsername = process.env.ACCOUNT || 'admin';
let adminPassword = process.env.PASSWORD || 'password';

// 解析命令行参数获取管理员账号信息
const args = process.argv.slice(2);
if (args.length >= 2) {
  // 处理 -a/-p 格式
  const aIndex = args.indexOf('-a');
  const pIndex = args.indexOf('-p');
  if (aIndex !== -1 && pIndex !== -1 && args[aIndex + 1] && args[pIndex + 1]) {
    adminUsername = args[aIndex + 1];
    adminPassword = args[pIndex + 1];
  }
  // 处理 username:password 格式
  else if (args[0].includes(':')) {
    [adminUsername, adminPassword] = args[0].split(':');
  }
  // 处理 username password 格式
  else if (args[0] && args[1]) {
    adminUsername = args[0];
    adminPassword = args[1];
  }
}

console.log(`管理员账号已配置为: ${adminUsername}`);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 添加HTTP基本认证中间件
const basicAuth = (req, res, next) => {
  // 检查请求路径是否为admin.html或admin相关API
  if (req.path.startsWith('/admin')) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
      return res.status(401).send('需要认证');
    }
    
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];
    
    if (user === adminUsername && pass === adminPassword) {
      next();
    } else {
      res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
      return res.status(401).send('认证失败');
    }
  } else {
    next();
  }
};

app.use(basicAuth);
app.use(express.static('.'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// 存储连接的设备信息
let connectedDevices = new Map();

// IP黑名单，存储被踢出的IP地址及其踢出时间
let ipBlacklist = new Map();

// 检查IP是否在黑名单中
function isIpBlacklisted(ip) {
  if (ipBlacklist.has(ip)) {
    const block = ipBlacklist.get(ip);
    const now = new Date();
    const secondsDiff = (now - block.kickTime) / 1000;
    if (secondsDiff < block.duration) {
      return true;
    } else {
      // 超过24小时，从黑名单中移除
      ipBlacklist.delete(ip);
    }
  }
  return false;
}

// 存储剪切板数据
let clipboards = [
  {
    id: 'default',
    content: '欢迎使用公共剪切板！',
    name: '默认',
    isEncrypted: false,
    passwordHash: null
  }
];

// 管理员修改剪切板密码接口
app.post('/admin/clipboards/password', (req, res) => {
  const { id, password } = req.body;
  
  if (!id) {
    return res.status(400).json({ error: '缺少剪切板ID' });
  }
  
  const clipboard = clipboards.find(clip => clip.id === id);
  if (!clipboard) {
    return res.status(404).json({ error: '剪切板不存在' });
  }
  
  // 生成密码哈希（如果有密码）
  const isEncrypted = password !== '';
  const passwordHash = isEncrypted ? crypto.createHash('sha256').update(password).digest('hex') : null;
  
  // 更新剪切板密码
  clipboard.isEncrypted = isEncrypted;
  clipboard.passwordHash = passwordHash;
  
  // 通知所有客户端更新
  const sanitizedClipboards = clipboards.map(clip => ({
    ...clip,
    content: clip.isEncrypted ? '' : clip.content,
    passwordHash: undefined
  }));
  io.emit('clipboard-updated', sanitizedClipboards);
  
  res.json({ success: true });
});

// 密码验证接口
app.post('/api/clipboards/verify', (req, res) => {
  const { id, password } = req.body;
  
  if (!id || !password) {
    return res.status(400).json({ error: '缺少ID或密码参数' });
  }
  
  const clipboard = clipboards.find(clip => clip.id === id);
  if (!clipboard) {
    return res.status(404).json({ error: '剪切板不存在' });
  }
  
  if (!clipboard.isEncrypted) {
    return res.json({ isValid: true, content: clipboard.content });
  }
  
  const inputHash = crypto.createHash('sha256').update(password).digest('hex');
  if (inputHash === clipboard.passwordHash) {
    return res.json({ isValid: true, content: clipboard.content });
  }
  
  return res.json({ isValid: false });
});

app.post('/api/clipboards', (req, res) => {
  const { id, content, name, isEncrypted, password } = req.body;
  
  if (isEncrypted && !password) {
    return res.status(400).json({ error: '加密剪切板需要提供密码' });
  }
  
  // 生成密码哈希
  const passwordHash = isEncrypted ? crypto.createHash('sha256').update(password).digest('hex') : null;

  const existingIndex = clipboards.findIndex(clip => clip.id === id);
  if (existingIndex !== -1) {
    // 如果是加密剪切板，需要验证密码
    if (clipboards[existingIndex].isEncrypted) {
      if (!password || crypto.createHash('sha256').update(password).digest('hex') !== clipboards[existingIndex].passwordHash) {
        return res.status(403).json({ error: '密码错误' });
      }
    }
    clipboards[existingIndex] = {
      ...clipboards[existingIndex],
      content,
      name,
      isEncrypted,
      passwordHash
    };
  } else {
    clipboards.push({
      id,
      content,
      name,
      isEncrypted,
      passwordHash
    });
  }

  // 通知所有客户端更新，过滤掉加密内容
  const sanitizedClipboards = clipboards.map(clip => ({
    ...clip,
    content: clip.isEncrypted ? '' : clip.content,
    passwordHash: undefined
  }));
  io.emit('clipboard-updated', sanitizedClipboards);
  res.json({ success: true });
});

app.delete('/api/clipboards/:id', (req, res) => {
  const { id } = req.params;

  // 不允许删除默认剪切板
  if (id === 'default') {
    return res.status(400).json({ error: '不能删除默认剪切板' });
  }

  clipboards = clipboards.filter(clip => clip.id !== id);

  // 通知所有客户端更新
  io.emit('clipboard-updated', clipboards);
  res.json({ success: true });
});

// 管理页面路由
app.get('/admin/devices', (req, res) => {
  const devices = Array.from(connectedDevices.values());
  res.json(devices);
});

// 剪切板列表
app.get('/admin/clipboards', (req, res) => {
  // 过滤掉加密内容
  const sanitizedClipboards = clipboards.map(clip => ({
    ...clip,
    content: clip.content
  }));
  res.json(sanitizedClipboards);
});

// 删除剪切板
app.delete('/admin/clipboards/:id', (req, res) => {
  const { id } = req.params;

  // 不允许删除默认剪切板
  if (id === 'default') {
    return res.status(400).json({ error: '不能删除默认剪切板' });
  }

  clipboards = clipboards.filter(clip => clip.id !== id);

  // 通知所有客户端更新
  io.emit('clipboard-updated', clipboards);
  res.json({ success: true });
});

// 获取黑名单列表
app.get('/admin/blacklist', (req, res) => {
  const blacklist = Array.from(ipBlacklist.entries()).map(([ip, data]) => {
    const now = new Date();
    const secondsDiff = data.duration - (now - data.kickTime) / 1000;
    return {
      ip,
      kickTime: data.kickTime.toISOString(),
      remainingHours: Math.max(0, secondsDiff)
    };
  });
  res.json(blacklist);
});

// 添加IP到黑名单
app.post('/admin/blacklist', (req, res) => {
  const { ip, seconds } = req.body;

  if (!ip || !seconds) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  if (seconds < 1 || seconds > 2592000) {
    return res.status(400).json({ error: '封禁时长必须在1-2592000秒之间' });
  }

  // 计算解封时间
  const kickTime = new Date();
  ipBlacklist.set(ip, { kickTime, duration: seconds });

  // 断开该IP的所有连接
  for (const [socketId, socket] of io.sockets.sockets) {
    const socketIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    if (socketIp === ip) {
      socket.emit('kicked', {
        reason: `您的IP已被管理员封禁${seconds}秒`
      });
      socket.disconnect(true);
    }
  }

  res.json({ success: true });
});

// 从黑名单中删除IP
app.delete('/admin/blacklist/:ip', (req, res) => {
  const { ip } = req.params;

  if (ipBlacklist.delete(ip)) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: '指定的IP不在黑名单中' });
  }
});

// WebSocket连接
io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

  // 检查IP是否在黑名单中
  if (isIpBlacklisted(clientIp)) {
    const { kickTime, duration } = ipBlacklist.get(clientIp);
    console.log(`IP ${clientIp} 已被封禁，封禁时间：${kickTime.toISOString()}，解封时间：${new Date(kickTime.getTime() + duration * 1000).toISOString()}`);
    socket.emit('kicked', {
      reason: `您的IP已被封禁，请等待解封`
    });
    socket.disconnect(true);
    return;
  }

  console.log('用户已连接:', socket.id);

  // 存储设备信息
  socket.on('device-info', (deviceInfo) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    connectedDevices.set(socket.id, {
      id: socket.id,
      ip: clientIp,
      ...deviceInfo,
      connectedAt: new Date().toISOString()
    });
    // 广播设备列表更新
    io.emit('devices-updated', Array.from(connectedDevices.values()));
  });

  // 发送当前剪切板数据给新连接的客户端
  socket.emit('init-clipboards', clipboards);

  // 监听剪切板更新事件
  socket.on('update-clipboard', (data) => {
    const { id, content, name, isEncrypted, encryptedKey } = data;

    const existingIndex = clipboards.findIndex(clip => clip.id === id);
    if (existingIndex !== -1) {
      clipboards[existingIndex] = {
        ...clipboards[existingIndex],
        content,
        name,
        isEncrypted,
        encryptedKey
      };
    } else {
      clipboards.push({
        id,
        content,
        name,
        isEncrypted,
        encryptedKey
      });
    }

    // 广播给所有客户端
    io.emit('clipboard-updated', clipboards);
  });

  socket.on('delete-clipboard', (id) => {
    // 不允许删除默认剪切板
    if (id === 'default') return;

    clipboards = clipboards.filter(clip => clip.id !== id);

    // 广播给所有客户端
    io.emit('clipboard-updated', clipboards);
  });

  // 处理踢出设备请求
  socket.on('kick-device', (deviceId, callback) => {
    const targetSocket = io.sockets.sockets.get(deviceId);
    if (targetSocket) {
      const targetIp = targetSocket.handshake.headers['x-forwarded-for'] || targetSocket.handshake.address;
      // 将IP添加到黑名单，默认封禁24小时(86400秒)
      ipBlacklist.set(targetIp, { kickTime: new Date(), duration: 86400 });
      targetSocket.emit('kicked', {
        reason: '您已被管理员踢出，24小时内无法重新连接'
      });
      targetSocket.disconnect(true);
      callback({ success: true });
    } else {
      callback({ success: false, error: '设备未找到或已断开连接' });
    }
  });

  socket.on('disconnect', () => {
    console.log('用户已断开连接:', socket.id);
    // 移除断开连接的设备信息
    connectedDevices.delete(socket.id);
    // 广播设备列表更新
    io.emit('devices-updated', Array.from(connectedDevices.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://127.0.0.1:${PORT}`);
  console.log(`账号:${adminUsername}`);
  console.log(`密码:${adminPassword}`);
});