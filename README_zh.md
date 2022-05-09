![](https://s1.ax1x.com/2022/05/09/OJcCIf.gif)

# A-SOUL-Wecom-Notifier

从各平台和服务中提取A-SOUL动态并将提醒推送至企业微信

本项目复刻自 https://github.com/sparanoid/a-soul 

原作: [sparanoid](https://github.com/sparanoid)

[English](https://github.com/nenekodev/A-SOUL-Wecom-Notifier/blob/main/README.md)

## 功能

- 模块化组件
- 同时监测多个服务的状态
- 支持连接错误后重连
- 支持通过代理绕开API请求限制
- 低内存占用量 (~ 50 MB)
- ESM 默认情况下具有最小的依赖关系

## 支持和计划支持的服务

- [x] bilibili
- [x] bilibili直播
- [x] 抖音
- [x] 抖音直播
- [x] 微博

## 支持和计划支持的平台

- [x] 企业微信
- [ ] 微信订阅号

## 系统要求

- Node.js >= 16

## 使用方式

你需要先根据下方的模板或仓库中的`config_template.js`在根目录设置好你自己的配置文件（`config.js`），然后直接

```bash
npm install

npm start
```

## 用 Github Action 运行该服务

由于主线程是循环的，Github 会在任务开始后六小时强行终止 workflow（Github Action 之 schedule 模式有**运行时长最多 6 小时、运行间隔不得小于 5 分钟**的限制），因此会返回一个运行失败的信息，这是正常的。

你可以尝试像我这样设置你的 `action.yml` ：

https://github.com/nenekodev/A-SOUL-Wecom-Notifier/blob/main/.github/workflows/A-SOUL_BOT.yml

如果你不想看到运行失败的消息，可以将其设置成单次运行 `node ./ run --once -c config_template.js` ，并使用外部的触发器按你所需要的间隔（如每分钟）触发一次即可：

https://github.com/nenekodev/A-SOUL-Wecom-Notifier/blob/main/.github/workflows/A-SOUL_BOT-RunOnce.yml

- 注意：Github Action 自带之 cron schedule 功能**恐不能准时启动**。 你可以参照这篇文章来解决：https://zhuanlan.zhihu.com/p/379365305 或试试我的另一个项目：[Github-Actions-Trigger](https://github.com/nenekodev/Github-Actions-Trigger)

## 配置

一个最小的 `config.js`:

```js
{
  accounts: [
    {
      enabled: true,
      slug: '嘉然',
      biliId: '672328094',
    },
  ]
}
```

完整的 `config.js` 应该类似:

```js
export default {
  loopInterval: 60 * 1000, // ms
  douyinBotThrottle: 24 * 3600 * 1000, // 24 hours, if latest post older than this value, do not send notifications
  douyinLiveBotThrottle: 1200 * 1000, // 20 mins
  bilibiliBotThrottle: 65 * 60 * 1000, // 65 mins, bilibili sometimes got limit rate for 60 mins.
  bilibiliLiveBotThrottle: 65 * 60 * 1000,
  weiboBotThrottle: 3600 * 1000,
  rateLimitProxy: 'http://10.2.1.2:7890', // Custom proxy to bypass bilibili API rate limit
  pluginOptions: {
    requestOptions: {
      timeout: {
        request: 3000
      },
    },
    //  If you have defined cookies or wecom_secret and etc. in GitHub secrets DO NOT redifine below.
    customCookies: {
      // Nov 11, 2021
      // Douyin main site now require `__ac_nonce` and `__ac_signature` to work
      douyin: `__ac_nonce=XXX; __ac_signature=XXX;`,
      // get `SESSDATA` cookie from https://www.bilibili.com/
      bilibili: `SESSDATA=XXX`,
      // get `SUB` cookie from https://m.weibo.cn/
      weibo: `SUB=XXX`,
    }
  },
  wecom: {
    enabled: true,
    corpID: 'WECOM_CORPID',
    secret: 'WECOM_SECRET',
    agentid: WECOM_agentID(e.g. 1000001),
  },
  accounts: [
    {
      enabled: true,
      slug: '向晚',
      showSlug: true,
      biliId: '672346917',
      biliLiveId: '22625025',
      weiboId: '7595051004',
      color: '#9ac8e2',
    },
    {
      enabled: true,
      slug: '贝拉',
      showSlug: true,
      biliId: '672353429',
      biliLiveId: '22632424',
      weiboId: '7594710405',
      color: '#db7d74',
    },
    {
      enabled: true,
      slug: '珈乐',
      showSlug: true,
      biliId: '351609538',
      biliLiveId: '22634198',
      weiboId: '7594393391',
      color: '#b8a6d9',
    },
    {
      enabled: true,
      slug: '嘉然',
      showSlug: true,
      biliId: '672328094',
      biliLiveId: '22637261',
      weiboId: '7595006312',
      color: '#e799b0',
    },
    {
      enabled: true,
      slug: '乃琳',
      showSlug: true,
      biliId: '672342685',
      biliLiveId: '22625027',
      weiboId: '7524943648',
      color: '#576690',
    },
    {
      enabled: true,
      slug: 'A-SOUL_Official',
      showSlug: true,
      biliId: '703007996',
      biliLiveId: '22632157',
      douyinId: 'MS4wLjABAAAAflgvVQ5O1K4RfgUu3k0A2erAZSK7RsdiqPAvxcObn93x2vk4SKk1eUb6l_D4MX-n',
      douyinLiveId: '1962143378',
      weiboId: '7519401668',
      color: '#fc966e',
    },
    {
      enabled: true,
      slug: '贾布加布',
      showSlug: true,
      biliId: '393396916',
    }
  ]
}
```

## FAQ

### Why this name?

这个项目的初衷是为了监控~~乐华娱乐首个~~虚拟偶像团体 [A-SOUL](https://zh.moegirl.org.cn/A-SOUL)的更新。~~你可以给五个姑娘点个关注吗？我给你磕头了咚咚咚~~

### 为什么没有并行执行检查？

大多数服务都有 API 限制或速率限制，并行执行检查只对少量帐户有意义。

## 开源许可

AGPL-3.0

