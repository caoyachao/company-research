# 联合部署方案

将 `company_research`（股票分析 Web UI）与 `llm-gateway-sdk`（LLM 网关）一起部署。

## 方案一：Docker Compose（推荐）

最稳定、最推荐的部署方式。两个服务分别容器化，通过 Docker 网络互通。

### 目录结构要求

两个项目应在同一父目录下：

```
~/Projects/
├── company_research/      # 本仓库
│   ├── docker-compose.yml
│   ├── deploy/
│   │   ├── Dockerfile.research
│   │   ├── Dockerfile.gateway
│   │   └── README.md
│   └── ...
└── llm-gateway-sdk/       # 网关仓库
    ├── llm_gateway_sdk/
    ├── pyproject.toml
    └── ...
```

### 部署步骤

#### 1. 配置 LLM 网关的 API Keys

在 `llm-gateway-sdk/` 项目根目录创建 `.env`：

```bash
cd ~/Projects/llm-gateway-sdk
cp /dev/null .env
# 编辑 .env，填入你的 API Keys（见 deploy/.env.example）
```

#### 2. 构建并启动

```bash
cd ~/Projects/company_research

# 启动两个服务
docker compose up --build -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

#### 3. 访问

- 股票分析 Web UI: http://localhost:3000
- LLM Gateway API: http://localhost:8000

### 持久化数据

| 目录 | 说明 |
|------|------|
| `./reports/` | 生成的分析报告（HTML/Markdown） |
| `./cache/` | 股票数据缓存 |
| `gateway_cache` (Docker Volume) | LLM 网关的可用性缓存 |

### 服务间通信

在 Docker 网络内，`company_research` 通过服务名 `gateway` 访问 LLM 网关：

```yaml
# docker-compose.yml 中已配置
LLM_GATEWAY_URL=http://gateway:8000/v1
```

---

## 方案二：裸机部署（Systemd）

适合已有服务器、不想引入 Docker 的场景。

### 1. 部署 LLM 网关

```bash
cd ~/Projects/llm-gateway-sdk
pip install -e .

# 创建 systemd 服务文件
sudo tee /etc/systemd/system/llm-gateway.service > /dev/null << 'EOF'
[Unit]
Description=LLM Gateway SDK
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Projects/llm-gateway-sdk
Environment=PATH=/home/ubuntu/.local/bin:/usr/bin
EnvironmentFile=/home/ubuntu/Projects/llm-gateway-sdk/.env
ExecStart=/home/ubuntu/.local/bin/python -m llm_gateway_sdk.server --port 8000 --host 127.0.0.1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable llm-gateway
sudo systemctl start llm-gateway
```

### 2. 部署股票分析工具

```bash
cd ~/Projects/company_research
pnpm install

# 创建 systemd 服务文件
sudo tee /etc/systemd/system/stock-research.service > /dev/null << 'EOF'
[Unit]
Description=Stock Analysis Web UI
After=network.target llm-gateway.service
Requires=llm-gateway.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Projects/company_research
Environment=LLM_GATEWAY_URL=http://127.0.0.1:8000/v1
Environment=LLM_GATEWAY_TIMEOUT=180
Environment=PORT=3000
ExecStart=/usr/bin/pnpm web
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable stock-research
sudo systemctl start stock-research
```

### 3. 查看状态

```bash
sudo systemctl status llm-gateway
sudo systemctl status stock-research

# 日志
sudo journalctl -u llm-gateway -f
sudo journalctl -u stock-research -f
```

---

## 方案三：PM2 进程管理（开发/测试环境）

适合开发环境快速启动，不依赖 systemd。

```bash
# 安装 PM2
npm install -g pm2

# 创建 ecosystem 配置文件
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'llm-gateway',
      cwd: '../llm-gateway-sdk',
      script: 'python',
      args: '-m llm_gateway_sdk.server --port 8000',
      env: {
        PATH: process.env.PATH,
      },
      autorestart: true,
    },
    {
      name: 'stock-research',
      cwd: '.',
      script: 'pnpm',
      args: 'web',
      env: {
        LLM_GATEWAY_URL: 'http://127.0.0.1:8000/v1',
        LLM_GATEWAY_TIMEOUT: '180',
        PORT: '3000',
      },
      autorestart: true,
    },
  ],
};
EOF

# 启动
pm2 start ecosystem.config.js

# 查看状态
pm2 status
pm2 logs

# 保存配置（开机自启）
pm2 save
pm2 startup
```

---

## 方案对比

| 方案 | 适用场景 | 复杂度 | 重启策略 | 隔离性 |
|------|---------|--------|---------|--------|
| **Docker Compose** | 生产/测试/本地 | 中 | 自动 | 高（容器隔离） |
| **Systemd** | Linux 生产服务器 | 中 | 自动 | 低（共享系统） |
| **PM2** | 开发/快速测试 | 低 | 自动 | 低（共享系统） |

---

## 反向代理（Nginx）

生产环境建议用 Nginx 做反向代理，统一入口：

```nginx
server {
    listen 80;
    server_name analysis.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/analyze {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
    }
}
```
