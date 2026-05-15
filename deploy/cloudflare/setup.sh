#!/usr/bin/env bash
# Cloudflare Tunnel 一键安装与配置脚本
# 用法: bash deploy/cloudflare/setup.sh

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CF_DIR="${HOME}/.cloudflared"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Cloudflare Tunnel 安装与配置脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 1. 检查 cloudflared
echo -e "${BLUE}▶ 检查 cloudflared...${NC}"
if ! command -v cloudflared &>/dev/null; then
    echo -e "${YELLOW}  cloudflared 未安装，正在下载...${NC}"
    curl -fsSL -o /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
    chmod +x /tmp/cloudflared
    sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
    echo -e "${GREEN}  ✓ cloudflared 已安装到 /usr/local/bin/cloudflared${NC}"
else
    echo -e "${GREEN}  ✓ cloudflared 已存在: $(cloudflared --version)${NC}"
fi

# 2. 登录 Cloudflare
echo ""
echo -e "${BLUE}▶ 登录 Cloudflare...${NC}"
echo -e "${YELLOW}  注意：如果当前环境无浏览器，脚本会输出一个 URL，${NC}"
echo -e "${YELLOW}  请在你的电脑浏览器中打开该 URL 完成授权。${NC}"
echo ""

if [ ! -f "${CF_DIR}/cert.pem" ]; then
    echo -e "${YELLOW}  未检测到证书，开始登录流程...${NC}"
    mkdir -p "${CF_DIR}"
    cloudflared tunnel login || true
    echo ""
else
    echo -e "${GREEN}  ✓ 已检测到 Cloudflare 登录证书${NC}"
fi

# 3. 创建命名隧道
echo ""
echo -e "${BLUE}▶ 创建命名隧道...${NC}"
TUNNEL_NAME="stock-api"
if cloudflared tunnel list 2>/dev/null | grep -q "${TUNNEL_NAME}"; then
    echo -e "${GREEN}  ✓ 隧道 '${TUNNEL_NAME}' 已存在${NC}"
    TUNNEL_ID=$(cloudflared tunnel list | grep "${TUNNEL_NAME}" | awk '{print $1}')
else
    echo -e "${YELLOW}  正在创建隧道 '${TUNNEL_NAME}'...${NC}"
    cloudflared tunnel create "${TUNNEL_NAME}"
    TUNNEL_ID=$(cloudflared tunnel list | grep "${TUNNEL_NAME}" | awk '{print $1}')
fi

echo -e "${GREEN}  隧道 ID: ${TUNNEL_ID}${NC}"

# 4. 写入配置文件
echo ""
echo -e "${BLUE}▶ 写入隧道配置...${NC}"
cat > "${CF_DIR}/config.yml" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CF_DIR}/${TUNNEL_ID}.json

ingress:
  - hostname: ""
    service: http://localhost:3000
  - service: http_status:404
EOF

echo -e "${GREEN}  ✓ 配置文件已写入: ${CF_DIR}/config.yml${NC}"

# 5. 验证本地服务端口
echo ""
echo -e "${BLUE}▶ 检查本地服务...${NC}"
if lsof -i :3000 &>/dev/null || ss -tlnp | grep -q ':3000'; then
    echo -e "${GREEN}  ✓ 端口 3000 已有服务运行${NC}"
else
    echo -e "${YELLOW}  ⚠ 端口 3000 暂无服务，请先运行: pnpm web${NC}"
fi

# 6. 输出使用说明
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  配置完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}启动隧道:${NC}"
echo "  cloudflared tunnel run ${TUNNEL_NAME}"
echo ""
echo -e "${BLUE}或后台运行:${NC}"
echo "  nohup cloudflared tunnel run ${TUNNEL_NAME} > /tmp/cloudflared.log 2>&1 &"
echo ""
echo -e "${BLUE}查看隧道 URL:${NC}"
echo "  cloudflared tunnel info ${TUNNEL_NAME}"
echo ""
echo -e "${BLUE}部署 Pages（在项目根目录执行）:${NC}"
echo "  bash deploy/cloudflare/deploy-pages.sh"
echo ""

# 7. 可选：生成 systemd 服务
echo -e "${BLUE}是否创建 systemd 服务实现开机自启？ (y/n)${NC}"
read -r answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
    sudo tee /etc/systemd/system/cloudflared-stock-api.service > /dev/null <<EOF
[Unit]
Description=Cloudflare Tunnel for Stock Research API
After=network.target

[Service]
Type=simple
User=$USER
ExecStart=/usr/local/bin/cloudflared tunnel run ${TUNNEL_NAME}
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    echo -e "${GREEN}  ✓ systemd 服务已创建: cloudflared-stock-api.service${NC}"
    echo -e "${GREEN}  启动: sudo systemctl start cloudflared-stock-api${NC}"
    echo -e "${GREEN}  自启: sudo systemctl enable cloudflared-stock-api${NC}"
fi
