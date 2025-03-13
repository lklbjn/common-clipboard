# 第一阶段：构建前端应用
FROM node:18-alpine as client-builder
WORKDIR /app/client

# 复制前端项目文件
COPY client/package*.json ./
RUN npm install
COPY client/ ./

# 构建前端应用
RUN npm run build

# 第二阶段：构建后端服务
FROM node:18-alpine
WORKDIR /app

# 复制后端项目文件
COPY server/package*.json ./
RUN npm install --production
COPY server/ ./

# 从第一阶段复制构建好的前端文件
COPY --from=client-builder /app/client/dist ./public

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 暴露端口
EXPOSE 3000

# 启动服务
CMD ["node", "server.js"]