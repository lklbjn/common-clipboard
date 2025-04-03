# Common Clipboard - 多设备共享剪贴板

一个支持多设备同步和多标签页管理的共享剪贴板应用，让你在不同设备间轻松共享文本内容。

## 功能特点

- 🔄 **实时同步**: 基于WebSocket的实时数据同步，确保所有设备上的内容保持一致
- 🔒 **加密保护**: 支持AES加密，可为敏感内容设置密码保护
- 📑 **多标签管理**: 创建多个独立的剪贴板空间，更好地组织不同类型的内容
- 🌐 **跨平台支持**: 支持桌面和移动设备的主流浏览器
- 👮 **管理员控制**: 提供管理员界面，可以监控和管理设备连接

## 技术架构

### 前端 (client)
- Vue 3 - 响应式UI框架
- Socket.io-client - WebSocket客户端
- Crypto-js - 加密功能实现
- Vite - 构建工具

### 后端 (server)
- Express - Web服务器框架
- Socket.io - WebSocket服务
- Body-parser - 请求体解析
- CORS - 跨域资源共享

## 快速开始

### 环境要求
- Node.js (推荐 v14 或更高版本)
- npm 或 yarn 包管理器

### 安装步骤

1. 克隆项目
```bash
git clone [项目地址]
cd common-clipboard
```

2. 安装依赖
```bash
# 安装服务端依赖
cd server
npm install

# 安装客户端依赖
cd ../client
npm install
```

3. 启动应用
```bash
# 在server目录下启动服务端
npm start

# 在client目录下启动客户端开发服务器
npm run dev
```

### 配置管理员账号

启动服务器时可以通过以下方式配置管理员账号：

```bash
# 方式1：使用命令行参数
node server.js -a admin -p password

# 方式2：使用用户名:密码格式
node server.js admin:password

# 方式3：直接传递用户名和密码
node server.js admin password
```

默认管理员账号：
- 用户名：admin
- 密码：password

## 使用说明

1. 访问应用
   - 默认地址：http://localhost:3000
   - 管理员界面：http://localhost:3000/admin.html

2. 基本操作
   - 创建新的剪贴板标签
   - 输入或粘贴内容到剪贴板
   - 为敏感内容设置密码保护
   - 在其他设备上访问同一地址即可同步内容

3. 安全功能
   - 使用密码加密重要内容
   - 管理员可以监控设备连接
   - 支持踢出可疑设备

## 开发说明

### 项目结构
```
├── client/           # 前端Vue应用
│   ├── src/         # 源代码
│   ├── public/      # 静态资源
│   └── vite.config.js
└── server/          # 后端Express应用
    └── server.js    # 服务器入口文件
```

### 开发模式

```bash
# 在server目录下运行
npm run dev
```

这将同时启动前端开发服务器和后端服务器。

## 贡献指南

欢迎提交Issue和Pull Request来帮助改进项目。在提交代码前，请确保：

1. 代码符合项目的编码规范
2. 添加必要的测试用例
3. 更新相关文档