#!/usr/bin/env bash
# FKPolyTools 部署脚本：仅启动后端 API，前端由 Nginx 提供并代理 /api
# 用法: ./update.sh

set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "==> 项目目录: $ROOT"

# 停止已有 API 进程（避免 EADDRINUSE）
echo "==> 停止已有 API..."
pkill -f "tsx watch src/index.ts" 2>/dev/null && echo "    已停止 API" || true
pkill -f "api_src.*tsx" 2>/dev/null || true
sleep 3
# 若 3000 仍被占用则释放（fuser 在 CentOS/RHEL 上可用）
if fuser -n tcp 3000 &>/dev/null; then
  fuser -k 3000/tcp 2>/dev/null && echo "    已释放 3000 端口" && sleep 2
fi

# 1. 根目录依赖与 SDK 构建
echo "==> 安装依赖并构建 SDK..."
pnpm install
pnpm build

# 1.5 同步前端到 Nginx 可读目录（/root 对 nginx 不可读，会 500）
WWW="/var/www/fkpoly"
mkdir -p "$WWW"
DIST="$ROOT/web_front_src/dist"
if [[ -f "$DIST/index.html" ]]; then
  cp -r "$DIST"/* "$WWW/"
  echo "    已同步前端 dist 到 $WWW"
else
  cp "$ROOT/deploy/index-placeholder.html" "$WWW/index.html"
  echo "    已放置占位页到 $WWW (请上传 dist 后重新运行 ./update.sh)"
fi

# 2. 启动 API 后端 (端口 3000)
mkdir -p "$ROOT/logs"
echo "==> 启动 API 服务 (http://0.0.0.0:3000)..."
cd "$ROOT/api_src"
pnpm install
nohup pnpm dev > "$ROOT/logs/api.log" 2>&1 &
API_PID=$!
echo $API_PID > "$ROOT/logs/api.pid"
cd "$ROOT"
sleep 2

echo ""
echo "==> 后端已启动"
echo "    API: http://0.0.0.0:3000 (PID: $API_PID, 日志: logs/api.log)"
echo "    文档: http://0.0.0.0:3000/docs"
echo ""
echo "前端由 Nginx 提供，请确保："
echo "  1. 已将 deploy/nginx-poly.conf 启用（见文件内注释）"
echo "  2. web_front_src/dist 已存在（本地 pnpm build 后上传）"
echo "  3. 执行: sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "停止 API: pkill -f 'tsx watch'"
