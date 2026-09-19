#!/usr/bin/env bash
# 安装 wordland 开机自启服务（从 config.json 读取参数生成 .service）
set -e
cd "$(dirname "$0")"

if [ ! -f ../config.json ]; then
  echo "未找到 config.json，请先： cp ../config.example.json ../config.json 并修改。"
  exit 1
fi

# 从 config.json 读取端口和局域网 IP
read PORT LAN_IP < <(node -e 'const c=require("../lib/config");console.log(c.port, c.lanIp)')

# 探测 node 绝对路径
NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "未找到 node，请先安装 Node.js 或在 PATH 中提供。"
  exit 1
fi

# 若端口已被占用，提示先停掉手动进程
if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  echo "端口 ${PORT} 已被占用，请先关闭手动运行的 node server.js（npm start），再重新运行本脚本。"
  exit 1
fi

# 由模板生成本机专属 .service（替换 @USER@ / @WORKDIR@ / @NODE@ / @PORT@ / @LAN_IP@）
WORKDIR="$(cd .. && pwd)"
sed -e "s|@USER@|$(whoami)|g" \
    -e "s|@WORKDIR@|${WORKDIR}|g" \
    -e "s|@NODE@|${NODE_BIN}|g" \
    -e "s|@PORT@|${PORT}|g" \
    -e "s|@LAN_IP@|${LAN_IP}|g" \
    wordland.service.template > wordland.service

sudo cp wordland.service /etc/systemd/system/wordland.service
sudo systemctl daemon-reload
sudo systemctl enable --now wordland

sleep 1
systemctl --no-pager status wordland || true
echo ""
echo "生成的服务文件： $(pwd)/wordland.service （已在 .gitignore 中，不会被提交）"
echo "✅ 完成。常用命令："
echo "  sudo systemctl stop wordland     # 停止"
echo "  sudo systemctl start wordland    # 启动"
echo "  sudo systemctl restart wordland  # 重启（更新代码后）"
echo "  journalctl -u wordland -f        # 查看日志"
