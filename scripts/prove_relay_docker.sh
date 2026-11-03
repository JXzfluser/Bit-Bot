#!/usr/bin/env bash
# prove_relay_docker.sh — A3-4 真 Docker 实证（可复现）
#
# 目的：证明「哑」中转镜像**真的能 build、真的能起、宿主真的连得上**——而不只是源码存在。
# 本脚本在 2026-11-03 首次真跑时抓到并修掉一个生产级 bug：relay_server 曾把监听地址写死
# 127.0.0.1，容器里绑回环 ⇒ 宿主 -p 映射打不进来（镜像起来了但不可用）。修复见 relay_server
# 的 bindHost 选项 + Dockerfile 的 BITBOT_RELAY_BIND=0.0.0.0。
#
# 跑法：bash scripts/prove_relay_docker.sh
# 无 docker 守护进程时干净 SKIP（≠ PASS）；不依赖显示环境。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

IMG="bitbot-relay:prove"
NAME="relay-prove-$$"
SECRET="prove-secret-$$"
FAIL=0
ok(){ echo "  ✓ $*"; }
bad(){ echo "  ✗ $*"; FAIL=1; }

if ! docker info >/dev/null 2>&1; then
  echo "SKIP: docker 守护进程不可用（SKIP ≠ PASS）"
  exit 0
fi

echo "== RD-1 构建镜像 =="
if docker build -f Dockerfile.relay -t "$IMG" . >/tmp/relay-docker-build.log 2>&1; then
  ok "docker build 成功（${IMG}）"
else
  bad "docker build 失败（见 /tmp/relay-docker-build.log）"
  tail -6 /tmp/relay-docker-build.log; exit 1
fi

cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== RD-2 起容器（随机宿主端口，控制面 + 健康检查都映射） =="
if docker run -d --name "$NAME" -e BITBOT_RELAY_SECRET="$SECRET" -p 127.0.0.1::18767 -p 127.0.0.1::18766 "$IMG" >/dev/null 2>&1; then
  ok "容器已启动"
else
  bad "容器启动失败"; docker logs "$NAME" 2>&1 | tail -5; exit 1
fi

hostport=""
ctrlport=""
for _ in $(seq 1 30); do
  hostport=$(docker port "$NAME" 18767/tcp 2>/dev/null | sed 's/.*://' | head -1)
  ctrlport=$(docker port "$NAME" 18766/tcp 2>/dev/null | sed 's/.*://' | head -1)
  [ -n "$hostport" ] && [ -n "$ctrlport" ] && break
  sleep 0.3
done

echo "== RD-3 健康检查：**从宿主**经端口映射可达（bindHost 修复的靶子） =="
body=""
for _ in $(seq 1 30); do
  body=$(curl -s -m 2 "http://127.0.0.1:${hostport}/healthz" 2>/dev/null || true)
  echo "$body" | grep -q '"ok":true' && break
  sleep 0.3
done
if echo "$body" | grep -q '"ok":true'; then
  ok "宿主 curl 映射端口可达：${body}（容器内绑 0.0.0.0，非回环）"
else
  bad "宿主连不上映射端口：'${body}'（若容器内绑 127.0.0.1 就会这样——见 bindHost）"
fi

echo "== RD-4 控制面从宿主可达（AUTH 真 token） =="
auth=$(RELAY_PORT="$ctrlport" BITBOT_RELAY_SECRET_PROVE="$SECRET" node -e '
const net=require("net");
const rk=require("./hosts/shared/relay/relay_keys.js");
const secret=process.env.BITBOT_RELAY_SECRET_PROVE;
let done=false;const t=setTimeout(()=>{if(!done){console.log("timeout");process.exit(0);}},3000);
const s=net.connect(Number(process.env.RELAY_PORT),"127.0.0.1",()=>s.write("AUTH "+rk.issueRelayCredential(secret,"prove-ext","client")+"\n"));
let b="";s.on("data",d=>{b+=d.toString();if(b.includes("OK")){done=true;clearTimeout(t);console.log("OK");s.end();}});
s.on("error",e=>{done=true;clearTimeout(t);console.log("ERR:"+e.code);});
' 2>&1 || true)
if [ "$auth" = "OK" ]; then
  ok "控制面 AUTH 从宿主返回 OK"
else
  bad "控制面 AUTH 失败：$auth"
fi

echo "== 汇总 =="
if [ "$FAIL" -eq 0 ]; then echo "prove_relay_docker: PASS"; exit 0; else echo "prove_relay_docker: FAIL"; exit 1; fi
