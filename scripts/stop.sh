#!/usr/bin/env bash
set -euo pipefail

# 端口配置（可通过环境变量覆盖）
GATEWAY_PORT=${GATEWAY_PORT:-8777}
WEB_PORT=${WEB_PORT:-8778}

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# 根据端口查找并结束进程
kill_by_port() {
    local port=$1
    local name=$2
    local pids

    pids=$(lsof -t -i :"$port" -sTCP:LISTEN 2>/dev/null || true)

    if [[ -z "$pids" ]]; then
        echo -e "  ${YELLOW}⚠ ${name}（端口 ${port}）未运行${NC}"
        return 0
    fi

    echo -e "  ${BLUE}▶ 关闭 ${name}（端口 ${port}，PID: ${pids}）...${NC}"
    echo "$pids" | xargs kill -TERM 2>/dev/null || true

    # 等待进程退出，最多 5 秒
    local waited=0
    while (( waited < 5 )); do
        pids=$(lsof -t -i :"$port" -sTCP:LISTEN 2>/dev/null || true)
        if [[ -z "$pids" ]]; then
            echo -e "  ${GREEN}✓ ${name} 已关闭${NC}"
            return 0
        fi
        sleep 1
        ((waited++))
    done

    # 强制结束
    echo "$pids" | xargs kill -KILL 2>/dev/null || true
    echo -e "  ${GREEN}✓ ${name} 已强制关闭${NC}"
}

echo -e "${BLUE}=== 股票分析服务关闭 ===${NC}"
echo ""

kill_by_port "$WEB_PORT" "股票分析 Web UI"
kill_by_port "$GATEWAY_PORT" "LLM Gateway"

echo ""
echo -e "${GREEN}=== 服务已关闭 ===${NC}"
