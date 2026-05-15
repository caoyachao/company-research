#!/usr/bin/env bash
# Cloudflare Pages 部署脚本
# 用法: bash deploy/cloudflare/deploy-pages.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PUBLIC_DIR="${PROJECT_ROOT}/public"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Cloudflare Pages 部署脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 1. 检查 wrangler
echo -e "${BLUE}▶ 检查 wrangler CLI...${NC}"
if ! command -v wrangler &>/dev/null; then
    echo -e "${YELLOW}  wrangler 未安装，正在安装...${NC}"
    npm install -g wrangler
else
    echo -e "${GREEN}  ✓ wrangler 已存在${NC}"
fi

# 2. 登录 Cloudflare
echo ""
echo -e "${BLUE}▶ 检查 Cloudflare 登录状态...${NC}"
if ! wrangler whoami &>/dev/null; then
    echo -e "${YELLOW}  未登录，开始登录...${NC}"
    wrangler login
else
    echo -e "${GREEN}  ✓ 已登录 Cloudflare${NC}"
fi

# 3. 部署
echo ""
echo -e "${BLUE}▶ 部署 public 目录到 Cloudflare Pages...${NC}"
cd "${PUBLIC_DIR}"

PROJECT_NAME="stock-research"
echo -e "${YELLOW}  项目名: ${PROJECT_NAME}${NC}"
echo -e "${YELLOW}  部署目录: ${PUBLIC_DIR}${NC}"
echo ""

wrangler pages publish . --project-name="${PROJECT_NAME}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Pages 部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}访问方式:${NC}"
echo -e "  1. 直接访问 Pages URL（部署输出中会显示）"
echo -e "  2. 如果隧道已启动，在 URL 后加: #api=https://<your-tunnel>.trycloudflare.com"
echo ""
echo -e "${BLUE}示例:${NC}"
echo -e "  https://stock-research-xxxx.pages.dev/#api=https://stock-api-xxxx.trycloudflare.com"
echo ""
