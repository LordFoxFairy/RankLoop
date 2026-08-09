# miaokit.cloud 主站补充文案

当前状态：**83 / 100**，还差三项。规则给出的精确证据：

```
🟡 THIN_CONTENT      正文约 297 字，建议不少于 300      ← 只差 3 个字
🔵 FEW_INTERNAL_LINKS 仅 0 条内链
🔵 MISSING_OG_IMAGE   og:image 未设置
```

---

## 一、正文只差 3 个字（最容易修）

现有正文已经写得不错——说清了是什么、怎么发货、有哪些入口、适合谁。
只是卡在 297 字，差 3 个字过线。既然要补，建议补得有价值一点，
在「适合谁」后面加一段**常见疑问**，顺带解决搜索用户真正会问的问题：

```html
<h2>常见问题</h2>

<h3>下单后多久发货？</h3>
<p>自动发货，付款后立即在订单页看到卡密或账号信息。官方渠道直充类商品
需要提供充值账号，通常在 5 到 30 分钟内到账。</p>

<h3>价格会变吗？</h3>
<p>页面显示的就是当前价。价格与库存每 5 分钟从货源自动同步一次，
不会出现点进去才发现涨价或缺货的情况。</p>

<h3>支持哪些 AI 工具？</h3>
<p>ChatGPT Plus、Claude、Gemini、GROK 等主流工具的账号与充值都有，
另有视频会员、网盘会员、生活服务券等数字权益，共两百余件商品在售。</p>

<h3>出问题怎么办？</h3>
<p>质保类商品在质保期内可换新。下单与售后统一走链动小铺处理。</p>
```

补完约 **480 字**，稳过阈值，而且这些是真实用户会搜的问题
（「ChatGPT Plus 多久到账」「AI 账号 哪里买」），有机会带来长尾流量。

---

## 二、内链 0 条的真实原因

规则报「仅 0 条内链」，但页面上明明有 4 个入口。原因是**这些入口都是跨子域的绝对地址**：

```
https://shop.miaokit.cloud/     ← 不同子域，规则按外链计
https://pay.ldxp.cn/            ← 完全站外
https://convert.miaokit.cloud/  ← 不同子域
https://api.miaokit.cloud/      ← 不同子域
```

从 Google 的角度，子域之间确实是相对独立的站点，权重传递弱于同域路径。

**两种改法，任选：**

**方案 A（简单）：** 保持现状，在主站上增加同域页面并互链。例如加
`/about`、`/faq`、`/how-it-works` 几个说明页，主页链过去，页面之间也互链。

**方案 B（更好但要改架构）：** 把商品目录挂到主域路径下，
`miaokit.cloud/shop/` 而不是 `shop.miaokit.cloud`，
让 215 个商品页的权重直接汇入主域。

如果短期不想动架构，**方案 A 就够了**——主站本来页面就少，
加两三个说明页既补内链又补内容，一举两得。

---

## 三、og:image（两站通用）

shop 和主站都缺。分享到微信、Twitter、Telegram 时没有缩略图，点击率会明显低。

```html
<meta property="og:title" content="miaokit — ChatGPT Plus、Claude、Gemini 等 AI 工具与数字权益">
<meta property="og:description" content="AI 工具账号与数字权益目录，两百余件商品在售，价格库存每 5 分钟自动同步，下单自动发货。">
<meta property="og:image" content="https://miaokit.cloud/og-cover.png">
<meta property="og:url" content="https://miaokit.cloud/">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
```

图片建议 **1200 × 630**，放品牌名 + 一句话说明即可。
shop 那边同理，把 URL 和文案换成 shop 的。

---

## 四、改完预期

| 页面 | 现在 | 改完 |
|---|---|---|
| 主站 | 83 | **95+** |
| shop 首页 | 95 | **98**（补 og:image） |
| shop 商品页 | 98 | **100**（补 og:image） |

---

## 五、自助复检

```bash
curl -sS -L https://miaokit.cloud/ -o page.html
python3 -c "
import json; print(json.dumps({
  'format':'html',
  'body':open('page.html',encoding='utf-8').read(),
  'url':'https://miaokit.cloud/'}))" > req.json

curl -sS -X POST https://<租户域名>/api/v1/contents/check \
  -H 'Authorization: Bearer rkl_live_xxx' \
  -H 'content-type: application/json' --data @req.json
```

看返回里的 `score` 与 `issues`。
