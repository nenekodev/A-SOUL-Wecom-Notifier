#!/usr/bin/env node

// Author: sparanoid(https://github.com/sparanoid)
// Modified by nenekodev(https://github.com/nenekodev)
import fs from 'fs';
import path from 'path';
import { setTimeout } from 'timers/promises';
import { setIntervalAsync } from 'set-interval-async/fixed/index.js';

import got from 'got';
import merge from 'deepmerge';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Low, JSONFile } from 'lowdb';
import { HttpsProxyAgent } from 'hpagent';
import { FormData } from 'formdata-node';

import { formatDate, stripHtml, convertWeiboUrl } from './utils.js';

import { fetchBiliBio, fetchBiliBlog } from './plugins/Bili.js';
import { fetchDouyinLive, fetchDouyin, dyExtract } from './plugins/Douyin.js';

const argv = yargs(hideBin(process.argv))
  .command('run', 'Extract new posts from services', {
    once: {
      description: 'Only run once',
      type: 'boolean',
    }
  })
  .option('config', {
    alias: 'c',
    description: 'User configuration file',
    type: 'string',
  })
  .help()
  .alias('help', 'h')
  .argv;

async function generateConfig() {
  console.log(`cwd`, process.cwd());

  const userConfig = argv.config ? await import(`${process.cwd()}/${argv.config}`) : { default: {}};
  const defaultConfig = {
    loopInterval: 60 * 1000, // n seconds
    douyinBotThrottle: 24 * 3600 * 1000, // 24 hours, if latest post older than this value, do not send notifications
    douyinLiveBotThrottle: 1200 * 1000, // 20 mins
    bilibiliBotThrottle: 65 * 60 * 1000, // 65 mins, bilibili sometimes got limit rate for 60 mins.
    bilibiliLiveBotThrottle: 65 * 60 * 1000,
    weiboBotThrottle: 3600 * 1000,
    rateLimitProxy: '',
    pluginOptions: {
      requestOptions: {
        timeout: {
          request: 10000
        }
      },
      customCookies: {
        // Nov 11, 2021
        // Douyin main site now require `__ac_nonce` and `__ac_signature` to work
        douyin: process.env.DOUYIN_COOKIE,
        // get `SESSDATA` cookie from https://www.bilibili.com/
        bilibili: process.env.BILI_COOKIE,
        // get `SUB` cookie from https://m.weibo.cn/
        weibo: process.env.WEIBO_COOKIE,
      }
    },    
    wecom: {
      corpID: process.env.WECOM_CORPID,
      secret: process.env.WECOM_SECRET,
      agentid: process.env.WECOM_AGENTID,
    },
    accounts: []
  };

  return merge(defaultConfig, userConfig.default);
}

// Merge default configs and user configs
const config = await generateConfig();

// Used by extractor-douyin


// Used by got directly
function headerOnDemand(cookie) {
  return {
    headers: {
      Cookie: cookie
    }
  }
}

async function main(config) {
  // Initial database
  const db = new Low(new JSONFile(path.join(path.resolve(), 'db/db.json')));
  console.log(`\n# Check loop started at ${formatDate(Date.now())} ------------`);

  for (let i = 0; i < config.accounts.length; i++) {
    const account = config.accounts[i];

    // Only check enabled account
    if (account?.enabled) {
      // Set random request time to avoid request limit
      await setTimeout(1000 + Math.floor(Math.random() * 2000));

      // Read from database
      await db.read();
      db.data ||= {};

      // Initial database structure
      db.data[account.slug] ||= {};
      const dbScope = db.data[account.slug];

      // Initialize proxy randomly to avoid bilibili rate limit
      // .5 - 50% true
      const proxyOptions = config?.rateLimitProxy && Math.random() < .5 ? {
        agent: {
          https: new HttpsProxyAgent({
            keepAlive: false,
            keepAliveMsecs: 1000,
            maxSockets: 256,
            maxFreeSockets: 256,
            scheduling: 'lifo',
            proxy: config.rateLimitProxy
          })
        }
      } : {};

      const wecomBody = {
        "textcard": {
          "title": "",
          "description": "",
          "url": ""
        }
      };

      // Fetch bilibili bio and live
      await fetchBiliBio(account, config, dbScope, proxyOptions, wecomBody);
      // Fetch bilibili microblog (dynamics)
      await fetchBiliBlog(account, config, dbScope, proxyOptions, wecomBody);
      // Fetch Douyin live
      await fetchDouyinLive(account, config, dbScope, wecomBody);
      // Fetch Douyin
      await fetchDouyin(account, config, dbScope, wecomBody);

      // //Fetch Weibo
      // const weiboRequestOptions = {...config.pluginOptions?.requestOptions, ...headerOnDemand(config.pluginOptions.customCookies.weibo)};

      // account.weiboId && await got(`https://m.weibo.cn/profile/info?uid=${account.weiboId}`, weiboRequestOptions).then(async resp => {
      //   const json = JSON.parse(resp.body);

      //   if (json?.ok === 1) {
      //     const currentTime = Date.now();
      //     const data = json.data;
      //     const user = data?.user;
      //     const statuses = data?.statuses;

      //     if (statuses.length !== 0) {
      //       // Exclude sticky status when: it is sticky and is older than the first [1] status
      //       const status = (
      //         statuses[0]?.isTop === 1 &&
      //         statuses[0]?.created_at &&
      //         statuses[1]?.created_at &&
      //         +new Date(statuses[0].created_at) < +new Date(statuses[1].created_at)
      //       ) ? statuses[1] : statuses[0];
      //       const retweeted_status = status?.retweeted_status;

      //       const timestamp = +new Date(status.created_at);
      //       const id = status.bid;
      //       const visibility = status?.visible?.type;
      //       const editCount = status?.edit_count || 0;
      //       let text = status?.raw_text || stripHtml(status.text);

      //       if (status?.isLongText) {
      //         log('weibo got post too long, trying extended text...')
      //         await got(`https://m.weibo.cn/statuses/extend?id=${id}`, weiboRequestOptions).then(async resp => {
      //           const json = JSON.parse(resp.body);

      //           if (json?.ok === 1 && json?.data?.longTextContent) {
      //             text = stripHtml(json.data.longTextContent);
      //           } else {
      //             log('weibo extended info corrupted, using original text...');
      //           }
      //         });
      //       }


      //       argv.json && fs.writeFile(`db/${account.slug}-weibo.json`, JSON.stringify(json, null, 2), err => {
      //         if (err) return console.log(err);
      //       });

      //       const visibilityMap = {
      //         1: `自己可见`,
      //         6: `好友圈可见`,
      //         10: `粉丝可见`
      //       }

      //       const dbStore = {
      //         scrapedTime: new Date(currentTime),
      //         scrapedTimeUnix: +new Date(currentTime),
      //         user: user,
      //         latestStatus: {
      //           id: id,
      //           text: text,
      //           visibility: visibility,
      //           editCount: editCount,
      //           timestamp: new Date(timestamp),
      //           timestampUnix: timestamp,
      //           timeAgo: timeAgo(timestamp),
      //         }
      //       };

      //       let readyToSend = 0;

      //       // If user nickname update
      //       if (user.screen_name !== dbScope?.weibo?.user?.screen_name && dbScope?.weibo?.user?.screen_name) {
      //         log(`weibo user nickname updated: ${user.screen_name}`);

      //         wecomBody.textcard.title = `${msgPrefix}· 微博昵称更新`;
      //         wecomBody.textcard.description = `新：${user.screen_name}\n旧：${dbScope?.weibo?.user?.screen_name}`;
      //         wecomBody.textcard.url = `https://weibo.com/${user.id}`;

      //         readyToSend = 1;
      //       }

      //       // If user description update
      //       if (user.description !== dbScope?.weibo?.user?.description && dbScope?.weibo?.user?.description) {
      //         log(`weibo user sign updated: ${user.description}`);

      //         wecomBody.textcard.title = `${msgPrefix}· 微博签名更新`;
      //         wecomBody.textcard.description = `新：${user.description}\n旧：${dbScope?.weibo?.user?.description}`;
      //         wecomBody.textcard.url = `https://weibo.com/${user.id}`;

      //         readyToSend = 1;
      //       }

      //       // If user avatar update
      //       if (user.avatar_hd !== dbScope?.weibo?.user?.avatar_hd && dbScope?.weibo?.user?.avatar_hd) {
      //         log(`weibo user avatar updated: ${user.avatar_hd}`);

      //         wecomBody.textcard.title = `${msgPrefix}· 微博头像更新`;
      //         wecomBody.textcard.description = `旧：${dbScope?.weibo?.user?.avatar_hd}\n点击卡片查看`;
      //         wecomBody.textcard.url = `${dbScope?.weibo?.user?.avatar_hd}`;

      //         readyToSend = 1;
      //       }

      //       // If user cover background update
      //       if (user.cover_image_phone !== dbScope?.weibo?.user?.cover_image_phone && dbScope?.weibo?.user?.cover_image_phone) {
      //         log(`weibo user cover updated: ${user.cover_image_phone}`);

      //         wecomBody.textcard.title = `${msgPrefix}· 微博封面更新`;
      //         wecomBody.textcard.description = `旧：${dbScope?.weibo?.user?.cover_image_phone}\n点击卡片查看`;
      //         wecomBody.textcard.url = `${dbScope?.weibo?.user?.cover_image_phone}`;

      //         readyToSend = 1;
      //       }

      //       // If latest post is newer than the one in database
      //       if (id !== dbScope?.weibo?.latestStatus?.id && timestamp > dbScope?.weibo?.latestStatus?.timestampUnix) {
      //         log(`weibo got update: ${id} (${timeAgo(timestamp)})`);

      //         wecomBody.textcard.title = `${msgPrefix}· 发布微博动态`;
      //         wecomBody.textcard.description = `${visibilityMap[visibility] || ''}${retweeted_status ? `转发` : `动态`}：${text}${retweeted_status ? `\n\n@${retweeted_status.user.screen_name}：${stripHtml(retweeted_status.text)}` : ''}`;
      //         wecomBody.textcard.url = `https://weibo.com/${user.id}/${id}`;

      //         if ((currentTime - timestamp) >= config.weiboBotThrottle) {
      //           log(`weibo too old, notifications skipped`);
      //         } else {
      //           readyToSend = 1;
      //         }
      //       } else if (id !== dbScope?.weibo?.latestStatus?.id && timestamp < dbScope?.weibo?.latestStatus?.timestampUnix) {
      //         log(`weibo new post older than database. latest: ${id} (${timeAgo(timestamp)})`);

      //       } else {
      //         log(`weibo no update. latest: ${id} (${timeAgo(timestamp)})`);
      //       }

      //       if (readyToSend === 1) {
      //         await sendWecom({}, wecomBody)
      //         .then(resp => {
      //           readyToSend = 0;
      //         })
      //         .catch(err => {
      //           log(`Wecom post error: ${err?.response?.body || err}`);
      //         });
      //       }

      //       // Set new data to database
      //       dbScope['weibo'] = dbStore;
      //     } else {
      //       log('weibo empty result, skipping...');
      //     }
      //   } else {
      //     log('weibo info corrupted, skipping...');
      //   }
      // })
      // .catch(err => {
      //   log(`weibo request error: ${err}`);
      // });


      // Write new data to database
      await db.write();
      argv.verbose && log(`global db saved`);
    }
  }

  argv.verbose && console.log('# Check loop ended');
}

if (argv._.includes('run')) {
  // Create database directory if not exists
  !fs.existsSync('db') && fs.mkdirSync('db');

  // Output configs for reference
  argv.verbose && console.log('Current configs', config);

  // Execute on run
  await main(config);

  if (!argv.once) {
    // Loop over interval
    setIntervalAsync(async () => {
      argv.verbose && console.log('interval started');
      await main(config);
      argv.verbose && console.log('interval ended');
    }, config.loopInterval);
  }
}

process.on('SIGINT', () => {
  process.exit();
});
