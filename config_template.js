export default {
  loopInterval: 60 * 1000, // ms
  douyinBotThrottle: 24 * 3600 * 1000, // 24 hours, if latest post older than this value, do not send notifications
  douyinLiveBotThrottle: 1200 * 1000, // 20 mins
  bilibiliBotThrottle: 65 * 60 * 1000, // 65 mins, bilibili sometimes got limit rate for 60 mins.
  bilibiliLiveBotThrottle: 65 * 60 * 1000,
  weiboBotThrottle: 3600 * 1000,
  pluginOptions: {
    requestOptions: {
      timeout: {
        request: 3000
      },
    },
//  If you have defined cookies or wecom_secret and etc. in GitHub secrets DO NOT redifine below.
//     customCookies: {
//       // Nov 11, 2021
//       // Douyin main site now require `__ac_nonce` and `__ac_signature` to work as `__ac_nonce=XXX; __ac_signature=XXX;`
//       douyin: ``,
//       // get `SESSDATA` cookie from https://www.bilibili.com/ as `SESSDATA=XXX`
//       bilibili: ``,
//       // get `SUB` cookie from https://m.weibo.cn/ as `SUB=XXX`
//       weibo: ``,
//     }
  },
//   wecom: {
//     //'WECOM_CORPID'
//     corpID: '',
//     //'WECOM_SECRET'
//     secret: '',
//     //'WECOM_agentID(e.g. 1000001)'
//     agentid: '',
//   },
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
