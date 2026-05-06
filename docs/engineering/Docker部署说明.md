# Docker 部署说明

本文档用于把当前项目部署到单台外网云服务器做试运行。默认只把 `console` 容器的 80 端口暴露到公网，API 和工具服务只在 Docker 内网互通。

## 1. 服务器准备

建议使用 Ubuntu 22.04 / 24.04。

安全组只开放：

- `22`：SSH，建议限制为自己的固定 IP
- `80`：HTTP
- `443`：后续上 HTTPS 时开放

安装 Docker：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

重新登录 SSH 后确认：

```bash
docker version
docker compose version
```

## 2. 准备配置

进入项目根目录：

```bash
cp deploy/docker/.env.docker.example .env
```

编辑 `.env`，至少填写：

- `DEEPSEEK_API_KEY`
- `MOONSHOT_API_KEY`
- `DASHSCOPE_API_KEY`
- `SQLSERVER_*`
- `MYSQL_ROOT_PASSWORD`
- `MYSQL_PASSWORD`

如果云服务器访问不到公司 SQL Server，需要先配置 VPN、白名单、公网映射或专线。

## 3. 构建并启动

```bash
docker compose build
docker compose up -d mysql
docker compose up -d
```

首次启动后初始化配置中心和 active bundle：

```bash
docker compose exec api npm run bootstrap:local
```

查看状态：

```bash
docker compose ps
docker compose logs -f api
```

## 4. 验证

```bash
curl -sS http://127.0.0.1/api/console/scenes
docker compose exec api curl -sS http://127.0.0.1:3100/health
docker compose exec api npm run check
docker compose exec api npm run regression:no-retired-runtime
```

外部浏览器访问：

```text
http://你的服务器公网 IP/
```

## 5. RAG 数据

Compose 默认使用 `rag-data` volume。若要迁移本机已有知识库，可先把本机 RAG 数据目录打包上传，再导入 volume。例如：

```bash
tar czf rag-data.tgz -C /Users/gato-pm/Desktop/mac_demo_portable/data .
scp rag-data.tgz root@你的服务器:/tmp/
```

服务器上执行：

```bash
docker compose stop rag
RAG_VOLUME="$(docker volume ls --format '{{.Name}}' | grep '_rag-data$' | head -n 1)"
docker run --rm -v "$RAG_VOLUME:/data" -v /tmp:/backup alpine sh -c 'rm -rf /data/* && tar xzf /backup/rag-data.tgz -C /data'
docker compose up -d rag
```

实际 volume 名会带 compose 项目前缀，可用 `docker volume ls | grep rag-data` 查看。

## 6. HTTPS

试跑通过后建议把 `console` 前面再放一层宿主机 Nginx 或 Caddy 做 HTTPS，也可以把当前 `console` 容器替换为带证书的反向代理。

不要把 `19101`、`19102`、`19103`、`19104` 暴露到公网。
