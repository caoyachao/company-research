#!/usr/bin/env bash
set -euo pipefail

# 端口配置（可通过环境变量覆盖）
GATEWAY_PORT=${GATEWAY_PORT:-8777}
WEB_PORT=${WEB_PORT:-8778}

# 从脚本所在目录推导项目路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# LLM Gateway 目录（假设与当前项目同级）
GATEWAY_DIR="$(cd "${PROJECT_ROOT}/../llm-gateway-sdk" && pwd)"

# 日志路径
LOG_DIR="${PROJECT_ROOT}/logs"
mkdir -p "$LOG_DIR"

GATEWAY_LOG="${LOG_DIR}/gateway.log"
WEB_LOG="${LOG_DIR}/web.log"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检测端口是否被占用
is_port_in_use() {
    local port=$1
    lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1
}

# 检测服务是否可访问（HTTP 健康检查）
wait_for_service() {
    local url=$1
    local name=$2
    local max_wait=${3:-30}
    local waited=0

    while ! curl -s "$url" >/dev/null 2>&1; do
        if (( waited >= max_wait )); then
            echo -e "${RED}✗ ${name} 启动超时（${max_wait}秒）${NC}"
            return 1
        fi
        sleep 1
        ((waited++))
    done
    echo -e "${GREEN}✓ ${name} 已就绪${NC}"
}

echo -e "${BLUE}=== 股票分析服务启动 ===${NC}"
echo ""

# ==================== LLM Gateway ====================
if is_port_in_use "$GATEWAY_PORT"; then
    echo -e "${YELLOW}⚠ LLM Gateway 已在端口 ${GATEWAY_PORT} 运行，跳过启动${NC}"
else
    echo -e "${BLUE}▶ 启动 LLM Gateway（端口 ${GATEWAY_PORT}）...${NC}"

    if [[ ! -d "$GATEWAY_DIR" ]]; then
        echo -e "${RED}✗ 未找到 llm-gateway-sdk 项目目录: ${GATEWAY_DIR}${NC}"
        exit 1
    fi

    cd "$GATEWAY_DIR"
    nohup python3 -m llm_gateway_sdk.server --port "$GATEWAY_PORT" > "$GATEWAY_LOG" 2>&1 &
    GATEWAY_PID=$!

    if wait_for_service "http://localhost:${GATEWAY_PORT}" "LLM Gateway" 30; then
        echo -e "  PID: ${GATEWAY_PID}"
        echo -e "  日志: ${GATEWAY_LOG}"
    else
        echo -e "${RED}✗ LLM Gateway 启动失败，查看日志: ${GATEWAY_LOG}${NC}"
        exit 1
    fi
fi

echo ""

# ==================== Web UI ====================
if is_port_in_use "$WEB_PORT"; then
    echo -e "${YELLOW}⚠ 股票分析 Web UI 已在端口 ${WEB_PORT} 运行，跳过启动${NC}"
else
    echo -e "${BLUE}▶ 启动股票分析 Web UI（端口 ${WEB_PORT}）...${NC}"

    cd "$PROJECT_ROOT"
    export PORT="$WEB_PORT"
    export LLM_GATEWAY_URL="http://127.0.0.1:${GATEWAY_PORT}/v1"
    nohup npx tsx src/web/server.ts > "$WEB_LOG" 2>&1 &
    WEB_PID=$!

    if wait_for_service "http://localhost:${WEB_PORT}" "Web UI" 15; then
        echo -e "  PID: ${WEB_PID}"
        echo -e "  日志: ${WEB_LOG}"
    else
        echo -e "${RED}✗ Web UI 启动失败，查看日志: ${WEB_LOG}${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}=== 服务启动完成 ===${NC}"
echo ""
echo -e "  ${GREEN}股票分析 Web UI${NC}  http://localhost:${WEB_PORT}"
echo -e "  ${GREEN}LLM Gateway${NC}     http://localhost:${GATEWAY_PORT}"
echo ""
echo -e "${BLUE}使用 ./scripts/stop.sh 关闭服务${NC}"
