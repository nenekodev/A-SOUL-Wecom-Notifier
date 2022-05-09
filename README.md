![](https://s1.ax1x.com/2022/05/09/OJcCIf.gif)

# A-SOUL-Wecom-Notifier

Extract A-SOUL dynamics data from services and push updates to Wecom【企业微信】

A fork of https://github.com/sparanoid/a-soul

author: [sparanoid](https://github.com/sparanoid/)

[中文](https://github.com/nenekodev/A-SOUL-Wecom-Notifier/blob/main/README_zh.md)

## Features

- Modular components
- Monitor several services at the same time
- Support retry on failed connections
- Proxy support to avoid API rate limit
- Low memory footprint (~ 50 MB)
- ESM by default with minimal dependencies

## Supported Services (and plans)

- [x] bilibili
- [x] bilibili-live
- [x] douyin
- [x] douyin-live
- [x] weibo

## Supported Senders

- [x] Wecom
- [ ] Wechat Official Accounts

## System Requirements

- Node.js >= 16

## Usage

Make your own `config.js` file by following the instructions below or using the `config_template.js`, which should be located in root directory. And then

```bash
npm install

npm start
```

## Use it by Github Action

Because the main thread is a loop, Github will forcibly terminate the task six hours after it starts (Github Action have schedule limits: **you can not run continuously for more than 6 hours or at a frequency greater than once every 5 minutes**), so it will return a failed info, which is normal. 

you can set your own `action.yml` by referring my settings:

https://github.com/nenekodev/A-SOUL-Wecom-Notifier/blob/main/.github/workflows/A-SOUL_BOT.yml

If you don't want to see this warning, you can set it up as a single run by using `node ./ run --once -c config_template.js` and use an external trigger to fire it as often as you need (such as every minute):

https://github.com/nenekodev/A-SOUL-Wecom-Notifier/blob/main/.github/workflows/A-SOUL_BOT-RunOnce.yml

- UPDATE: cron schedule **may not start on time.** A solution here: [zh-SC] https://zhuanlan.zhihu.com/p/379365305 or you can try my another project: [Github-Actions-Trigger](https://github.com/nenekodev/Github-Actions-Trigger)


## Configurations

Minimal `config.js`:

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

Your full `config.js` file may look like:

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

The original intention of this project was to monitor updates of a Chinese VTuber group [A-SOUL](https://virtualyoutuber.fandom.com/wiki/A-soul).

### Why not executing checks in parallel

Most services have API limits or rate limits. Executing checks in parallel only make sense with small amount of accounts.

## License

AGPL-3.0

