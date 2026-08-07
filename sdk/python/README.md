# RankLoop Python SDK

SEO 全生命周期平台的 Python 客户端。**零依赖**，只用标准库。

```bash
pip install rankloop
```

## 快速开始

向平台管理员索取 API Key（形如 `rkl_live_xxx`）和站点 ID，然后：

```python
from rankloop import Client, PublishBlockedError

client = Client(api_key="rkl_live_xxx")

content = client.submit(site_id, path="/posts/hello", body=html)

try:
    client.publish(content.id)
    print("已发布")
except PublishBlockedError as e:
    print(f"发不出去，当前 {e.score} 分，必须先修：{e.blocking}")
```

## 核心用法

### 发布前先检查（不落库）

适合放在 CI 里当门禁——内容还没提交就知道能不能发。

```python
r = client.check(body=html, url="https://yoursite.com/posts/hello")

if not r.publishable:
    for i in r.blocking_issues:
        print(f"[{i.code}] {i.message}")
        print(f"  证据：{i.evidence}")
        print(f"  建议：{i.recommendation}")
```

> **注意**：分数高不等于能发布。只要有一条 `critical` 就发不出去，哪怕 90 分。
> 判断能不能发请用 `publishable`，不要用分数。

### 按性价比修复

建议已按「每分钟能挽回多少分」排好序，阻断项在最前，从头做即可。

```python
items, impact = client.recommendations(content.id)

print(f"当前 {impact.current} 分，全修完可达 {impact.potential} 分")
print(f"只做快速项：{impact.quick_minutes} 分钟能到 {impact.quick_win} 分")

for r in items:
    flag = "【阻断发布】" if r.blocking else ""
    print(f"{flag}{r.message} — 约 {r.minutes} 分钟，+{r.gain} 分")
```

### 批量发布不想写 try/except

```python
ok, todo = client.publish_when_ready(content.id)
if not ok:
    for r in todo:
        print(f"待修复：{r.message}（约 {r.minutes} 分钟）")
```

## 完整闭环示例

```python
from rankloop import Client

client = Client(api_key="rkl_live_xxx")

# 1. 提交
content = client.submit(site_id, path="/posts/hello", body=html)

# 2. 看看差什么
ok, todo = client.publish_when_ready(content.id)

# 3. 修完重新提交
if not ok:
    fixed_html = your_fix_function(html, todo)
    client.update(content.id, body=fixed_html)
    ok, _ = client.publish_when_ready(content.id)

# 4. 发布成功后平台自动：生成 sitemap、提交 Search Console、
#    通过 IndexNow 通知 Bing/Yandex，并每天回读搜索表现数据
```

## 异常

| 异常 | 含义 |
|---|---|
| `PublishBlockedError` | 内容有严重问题，**这不是错误**，是正常流程。读 `.blocking` 拿清单 |
| `AuthError` | 密钥无效或缺失 |
| `NotFoundError` | 资源不存在，或不属于你的租户 |
| `ValidationError` | 请求参数不合法，读 `.details` |
| `QuotaExceededError` | 超出套餐配额 |

所有异常都带 `.request_id`，报问题时提供它可直接定位到那次请求。

## 关于 SEO 效果的说明

本平台负责**消除技术层面的障碍**：拦截会导致不被收录的问题、生成合规
sitemap 并主动提交、发布后持续回读真实搜索表现。

**没有任何工具能保证排名或流量** —— 那取决于内容质量、站点权威度和竞争
程度，由 Google 决定。Google 官方也明确说明抓取需要数天至数周，且不保证收录。

## 本地开发

```bash
pip install -e ".[dev]"

# 对着真实 API 跑测试
RANKLOOP_BASE_URL=http://localhost:8080/api/v1 \
RANKLOOP_API_KEY=rkl_live_xxx \
RANKLOOP_SITE_ID=xxx pytest
```
