#!/usr/bin/env bash
# 启动 Cloudflare 临时隧道并输出 Pages 访问链接
set -euo pipefail

# 1. 清理旧隧道
pkill -f "cloudflared tunnel --url" 2>/dev/null || true
sleep 1

# 2. 启动新隧道
nohup cloudflared tunnel --url http://localhost:3000 > /tmp/temp-tunnel.log 2>&1 &
echo "Tunnel starting... (PID: $!)"

# 3. 等待域名生成
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/temp-tunnel.log | head -1 || true)
  if [ -n "$TUNNEL_URL" ]; then
    echo ""
    echo "========================================"
    echo "  Tunnel 已启动"
    echo "========================================"
    echo ""
    echo "Tunnel URL: $TUNNEL_URL"
    echo ""
    echo "Pages 访问链接："
    echo "  <你的Pages_URL>/#api=$TUNNEL_URL"
    echo "  例如: https://your-project.pages.dev/#api=$TUNNEL_URL"
    echo "本地 API 测试："
    echo "  curl \"$TUNNEL_URL/api/stock-data?stock=600519.SH\""
    echo ""
    echo "停止隧道: pkill -f 'cloudflared tunnel --url'"
    exit 0
  fi
  sleep 2
done

echo "超时，隧道启动失败。查看日志: cat /tmp/temp-tunnel.log"
