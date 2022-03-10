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

function cookieOnDemand(cookie) {
  return {
    cookies: cookie
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

      
      // // Fetch Douyin live
      // account.douyinLiveId && await dyExtract(`https://live.douyin.com/${account.douyinLiveId}`, {
      //   ...config.pluginOptions,
      //   ...cookieOnDemand(config.pluginOptions.customCookies.douyin)
      // }).then(async resp => {
      //   const json = resp?.initialState?.roomStore?.roomInfo;

      //   if (json) {
      //     const status = json?.room?.status;
      //     const id_str = json?.room?.id_str;

      //     if (status === 2) {
      //       argv.verbose && log(`douyin-live seems started, begin second check...`);

      //       await dyExtract(`https://webcast.amemv.com/webcast/reflow/${id_str}`, {...config.pluginOptions, ...cookieOnDemand(config.pluginOptions.customCookies.douyin)}).then(async resp => {
      //         const currentTime = Date.now();
      //         const json = resp?.['/webcast/reflow/:id'];

      //         if (json?.room) {
      //           argv.json && fs.writeFile(`db/${account.slug}-douyin-live.json`, JSON.stringify(json, null, 2), err => {
      //             if (err) return console.log(err);
      //           });

      //           const {
      //             id_str,
      //             title,
      //             cover,
      //             create_time,
      //             stream_url,
      //           } = json.room;

      //           const {
      //             nickname,
      //             web_rid,
      //             sec_uid,
      //             id,
      //             short_id,
      //             signature,
      //             avatar_large,
      //             authentication_info,
      //           } = json.room.owner;

      //           const liveCover = cover?.url_list?.[0];
      //           const timestamp = create_time * 1000;
      //           const streamUrl = Object.values(stream_url.hls_pull_url_map)[0];

      //           const dbStore = {
      //             nickname: nickname,
      //             uid: sec_uid,
      //             scrapedTime: new Date(currentTime),
      //             sign: signature,
      //             latestStream: {
      //               liveStatus: status,
      //               liveStarted: timestamp,
      //               liveRoom: id_str,
      //               liveTitle: title,
      //               liveCover: liveCover,
      //               isWecomSent: dbScope?.douyin_live?.latestStream?.isWecomSent,
      //             },
      //             streamFormats: stream_url.candidate_resolution,
      //             streamUrl: streamUrl,
      //           };

      //           if (json?.room?.status === 2) {
      //             console.log(`douyin-live started: ${title} (${timeAgo(timestamp)})`);

      //             wecomBody.textcard.title = `${msgPrefix}· 抖音开播：${title}`;
      //             wecomBody.textcard.description = `你关注的 ${msgPrefix}开播了，去看看叭：https://live.douyin.com/${account.douyinLiveId}`;
      //             wecomBody.textcard.url = `https://live.douyin.com/${account.douyinLiveId}`;

      //             if (dbScope?.douyin_live?.latestStream?.isWecomSent) {
      //               console.log(`douyin-live notification sent, skipping...`);
      //             } else if ((currentTime - timestamp) >= config.douyinLiveBotThrottle) {
      //               console.log(`douyin-live too old, notifications skipped`);
      //             } else {                    
      //               await sendWecom({}, wecomBody)
      //               .then(resp => {
      //                 dbStore.latestStream.isWecomSent = true;
      //               })
      //               .catch(err => {
      //                 console.log(`Wecom post douyin-live error: ${err?.response?.body || err}`);
      //               });  
      //             }
      //           } else {
      //             console.log(`douyin-live not started yet (2nd check)`);
      //             dbStore.latestStream.isWecomSent = false;
      //           }

      //           // Set new data to database
      //           dbScope['douyin_live'] = dbStore;
      //         } else {
      //           console.log(`douyin-live stream info corrupted, skipping...`);
      //         }
      //       });
      //     } else {
      //       // TODO: Simplify make sure isTgSent set to false if not current live on first check
      //       // Need better solution
      //       const dbStore = {
      //         latestStream: {
      //           isWecomSent: false,
      //         },
      //       }
      //       console.log(`douyin-live not started yet`);
      //       dbScope['douyin_live'] = dbStore;
      //     }
      //   } else {
      //     console.log(`douyin-live info corrupted, skipping...`);
      //   }
      // }).catch(err => {
      //   console.log(err);
      // });

      // // Fetch Douyin
      // account.douyinId && await dyExtract(`https://www.douyin.com/user/${account.douyinId}`, {
      //   ...config.pluginOptions,
      //   ...cookieOnDemand(config.pluginOptions.customCookies.douyin)
      // }).then(async resp => {
      //   const currentTime = Date.now();

      //   // Douyin trends to change object key regularly. (ie. C_10, C_12, C_14)
      //   // I need to find a static property to pin specific object
      //   let json = {};
      //   for (const obj in resp) {
      //     if (resp[obj].hasOwnProperty('uid')) {
      //       json = resp[obj];
      //     }
      //   }

      //   const userMeta = json?.user?.user;
      //   const posts = json?.post?.data;

      //   if (userMeta && posts?.length > 0) {
      //     const {
      //       uid,
      //       secUid,
      //       nickname,
      //       desc: sign,
      //       avatarUrl: avatar,
      //       followingCount: following,
      //       followerCount: followers,
      //     } = userMeta;

      //     argv.json && fs.writeFile(`db/${account.slug}-douyin.json`, JSON.stringify(json, null, 2), err => {
      //       if (err) return console.log(err);
      //     });

      //     // Sort all posts by `createTime` to avoid sticky (aka. 置顶) posts and get the latest one
      //     // const post = posts[i]; // Used to store in array and detect `isTop` in loop
      //     const post = posts.sort((a, b) => b.createTime - a.createTime)?.[0];

      //     // If latest post exists
      //     if (post) {
      //       const {
      //         awemeId: id,
      //         authorInfo: postAuthorMeta,
      //         desc: title,
      //         textExtra: tags,
      //         tag: postMeta,
      //         shareInfo: {
      //           shareUrl
      //         },
      //         stats,
      //       } = post;
      //       const timestamp = post.createTime * 1000;
      //       const cover = `https:${post?.video.dynamicCover}`;
      //       const videoUrl = `https:${post?.video?.playAddr[0].src}`;

      //       const dbStore = {
      //         nickname: nickname,
      //         uid: uid,
      //         scrapedTime: new Date(currentTime),
      //         sign: sign,
      //         following: following,
      //         followers: followers,
      //         latestPost: {
      //           id: id,
      //           title: title,
      //           timestamp: new Date(timestamp),
      //           timestampUnix: timestamp,
      //           timeAgo: timeAgo(timestamp),
      //           cover: cover,
      //           videoUrl: videoUrl,
      //           shareUrl: shareUrl,
      //         }
      //       };

      //       wecomBody.textcard.title = `${msgPrefix}· 发布抖音视频：${title}`;
      //       wecomBody.textcard.description = `${title}`;
      //       wecomBody.textcard.url = shareUrl;

      //       // Check if this is a new post compared to last scrap
      //       if (id !== dbScope?.douyin?.latestPost?.id && timestamp > dbScope?.douyin?.latestPost?.timestampUnix) {
      //         console.log(`douyin got update: ${id} (${timeAgo(timestamp)}) ${title}`);

      //         // Send bot message
      //         if ((currentTime - timestamp) >= config.douyinBotThrottle) {
      //           console.log(`douyin latest post too old, notifications skipped`);
      //         } else {
      //           await sendWecom({}, wecomBody)
      //           .catch(err => {
      //             console.log(`Wecom post douyin-live error: ${err?.response?.body || err}`);
      //           });
      //         }
      //       } else {
      //         console.log(`douyin no update. latest: ${id} (${timeAgo(timestamp)})`);
      //       }

      //       // Set new data to database
      //       dbScope['douyin'] = dbStore;
      //     }
      //   } else {
      //     console.log(`douyin scraped data corrupted, skipping...`);
      //   }
      // }).catch(err => {
      //   console.log(err);
      // });



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
