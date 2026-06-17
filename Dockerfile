# 江哥书法工作台 - CloudBase Run 部署
# 单容器: 静态文件 + 火山 CORS 代理(同源调用,无 CORS 问题)

FROM node:18-alpine

WORKDIR /app

# 没有第三方依赖,直接 copy 所有
COPY . .

# CloudBase Run 默认期望容器监听 80
ENV PORT=80
EXPOSE 80

# 健康检查 — CloudBase Run 用它判断容器是否启动成功
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:80/index.html > /dev/null || exit 1

CMD ["node", "server.js"]
