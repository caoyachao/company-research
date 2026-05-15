# Cloudflare Pages + Tunnel 部署指南

## 快速开始（推荐）

在项目根目录执行：

```bash
# 1. 安装 cloudflared、创建隧道、写入配置
bash deploy/cloudflare/setup.sh

# 2. 部署 Pages（需要 wrangler 已登录）
bash deploy/cloudflare/deploy-pages.sh
```

---

## 无浏览器环境登录 Cloudflare

服务器没有浏览器时，`cloudflared tunnel login` 会输出一个 URL：

```
Please open the following URL and log in with your Cloudflare account:

https://dash.cloudflare.com/argotunnel?callback=https%3A%2F%2Flocalhost%3A...&token=...
```

**操作步骤：**
1. 复制该 URL 到你的电脑浏览器打开
2. 选择你要授权的域名，点击 **Authorize**
3. 浏览器会跳转到一个 localhost 地址（无需理会，因为这是服务器的本地回调）
4. 回到服务器终端，cloudflared 会自动下载 `~/.cloudflared/cert.pem`
5. 确认证书存在：`ls ~/.cloudflared/cert.pem`

---

## 手动步骤（如果一键脚本遇到问题）

### 1. 安装 cloudflared

```bash
curl -fsSL -o /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x /tmp/cloudflared
sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
cloudflared --version
```

### 2. 登录并创建隧道

```bash
# 登录（复制输出的 URL 到浏览器授权）
cloudflared tunnel login

# 创建命名隧道
cloudflared tunnel create fin-api

# 查看隧道 ID
cloudflared tunnel list
```

### 3. 配置隧道

编辑 `~/.cloudflared/config.yml`（将 `<TUNNEL_ID>` 替换为实际 ID）：

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: ""
    service: http://localhost:3000
  - service: http_status:404
```

### 4. 启动隧道

```bash
# 前台运行（调试）
cloudflared tunnel run fin-api

# 后台运行
nohup cloudflared tunnel run fin-api > /tmp/cloudflared.log 2>&1 &
```

启动后终端会输出公网 URL：
```
Your quick Tunnel has been created! Visit it at:
https://fin-api-xxxxxxxx.trycloudflare.com
```

### 5. 部署 Pages

```bash
# 安装 wrangler
npm install -g wrangler

# 登录 Cloudflare（同样需要浏览器授权）
wrangler login

# 部署 public 目录
cd public
wrangler pages publish . --project-name=stock-research
```

### 6. 访问

在 Pages URL 后附加 Tunnel 地址作为 hash 参数：

```
https://stock-research-xxx.pages.dev/#api=https://fin-api-xxx.trycloudflare.com
```

---

## 持久化运行（systemd）

```bash
sudo tee /etc/systemd/system/cloudflared-fin-api.service <<'EOF'
[Unit]
Description=Cloudflare Tunnel for Stock Research API
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/cloudflared tunnel run fin-api
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cloudflared-fin-api
sudo systemctl start cloudflared-fin-api
```

---

## 故障排查

| 问题 | 解决 |
|------|------|
| `cloudflared tunnel login` 无输出 | 检查网络连接，或手动下载 cert.pem |
| Pages 无法访问 API | 检查 Tunnel 是否运行，CORS 是否开启 |
| 本地服务端口冲突 | 修改 `PORT` 环境变量，同步更新 tunnel 配置 |
| 证书过期 | 重新执行 `cloudflared tunnel login` |

---

## 架构图

```
┌──────────────────┐     HTTPS       ┌─────────────────┐
│ Cloudflare Pages │ ─────────────→ │ Cloudflare Tunnel│
│ (stock_research  │                 │ (公网入口)       │
│  _tool.html)      │                 └────────┬────────┘
└──────────────────┘                          │ HTTPS
                                              ↓
                                       ┌──────────────┐
                                       │ 本地服务器    │
                                       │ :3000        │
                                       │ (Node.js API)│
                                       └──────────────┘
```
