#!/usr/bin/env node

// Author: sparanoid(https://github.com/sparanoid)
// Modified by nenekodev(https://github.com/nenekodev)
import fs from 'fs';
import path from 'path';
import { setTimeout } from 'timers/promises';
import { setIntervalAsync } from 'set-interval-async/fixed/index.js';

import got from 'got';
import chalk from 'chalk';
import merge from 'deepmerge';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Low, JSONFile } from 'lowdb';
import { HttpsProxyAgent } from 'hpagent';
import { FormData } from 'formdata-node';

import { formatDate, stripHtml, convertWeiboUrl } from './utils.js';
import { timeAgo } from './utils/timeAgo.js';
import dyExtract from './plugins/Douyin.js';
import Wecom from './plugins/Wecom.js';

const argv = yargs(hideBin(process.argv))
  .command('run', 'Extract new posts from services', {
    once: {
      description: 'Only run once',
      type: 'boolean',
    },
    json: {
      description: 'Write JSON response to disk for debugging',
      type: 'boolean',
    }
  })
  .option('config', {
    alias: 'c',
    description: 'User configuration file',
    type: 'string',
  })
  .option('verbose', {
    description: 'Show verbose log',
    type: 'boolean',
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
// const userConfig = argv.config ? JSON.parse(fs.readFileSync(argv.config)) : {};

// Used by extractor-douyin
function cookieOnDemand(cookie) {
  return {
    cookies: cookie
  }
}

// Used by got directly
function headerOnDemand(cookie) {
  return {
    headers: {
      Cookie: cookie
    }
  }
}

async function sendWecom(userOptions, userContent) {
  const options = merge({
    corpID: config.wecom.corpID,
    secret: config.wecom.secret,
  }, userOptions);

  const contents = merge({
    agentid: config.wecom.agentid,
  }, userContent);

  try {
    const resp = await Wecom(options, contents);
    return resp;
  } catch (err) {
    console.log(err);
  }
}

async function main(config) {
  // Initial database
  const db = new Low(new JSONFile(path.join(path.resolve(), 'db/db.json')));
  console.log(`\n# Check loop started at ${formatDate(Date.now())} ------------`);

  for (let i = 0; i < config.accounts.length; i++) {
    const account = config.accounts[i];

    const logName = chalk.hex('#000').bgHex(account?.color ?? '#fff');
    const errColor = chalk.hex('#ff0000');

    function log(msg, type) {
      console.log(`${logName(account.slug)} ${msg}`);
    }

    // Only check enabled account
    if (account?.enabled) {
      // Set random request time to avoid request limit
      await setTimeout(1000 + Math.floor(Math.random() * 2000));
      argv.verbose && log(`is checking...`);

      // Read from database
      await db.read();
      db.data ||= {};
      argv.verbose && log(`db read`);

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

      // Append account slug in output (useful for multiple account in channel)
      const msgPrefix = account.showSlug ? `${account.slug} ` : ``;

      const wecomBody = {
        "textcard": {
          "title": "",
          "description": "",
          "url": ""
        }
      };

      // Fetch bilibili live
      account.biliId && await got(`https://api.bilibili.com/x/space/acc/info?mid=${account.biliId}`, {
        ...config.pluginOptions?.requestOptions,
        ...proxyOptions
      }).then(async resp => {
        const json = JSON.parse(resp.body);

        if (json?.code === 0) {
          const currentTime = Date.now();
          const data = json.data;
          const {
            live_room: room,
            mid: uid,
            name: nickname,
            sign,
            face: avatar,
          } = data;

          const {
            liveStatus,
            roundStatus, // 轮播状态
            roomid: liveId,
            url: liveRoom,
            title: liveTitle,
            cover: liveCover,
          } = room;

          // Avatar URL is not reliable, URL may change because of CDN
          const avatarHash = avatar && new URL(avatar);

          // Space API ocassionally returns a default name (bilibili). Skip processing when ocurrs
          if (nickname === 'bilibili') {
            log(`data valid but content is corrupt. nickname === 'bilibili'`);
            return;
          }

          argv.json && fs.writeFile(`db/${account.slug}-bilibili-user.json`, JSON.stringify(json, null, 2), err => {
            if (err) return console.log(err);
          });

          const dbStore = {
            nickname: nickname,
            uid: uid,
            scrapedTime: new Date(currentTime),
            avatar: avatarHash?.pathname,
            sign: sign,
            latestStream: {
              liveStatus: liveStatus,
              liveRoom: liveRoom,
              liveTitle: liveTitle,
              liveCover: liveCover,
              isWecomSent: dbScope?.bilibili_live?.latestStream?.isWecomSent,
            },
          };

          let readyToSend = 0;

          // If user nickname update
          if (nickname !== 'bilibili' && nickname !== dbScope?.bilibili_live?.nickname && dbScope?.bilibili_live?.nickname) {
            log(`bilibili-live user nickname updated: ${nickname}`);

            wecomBody.textcard.title = `${msgPrefix}· B站昵称更新`;
            wecomBody.textcard.description = `新：${nickname}\n旧：${dbScope?.bilibili_live?.nickname}`;
            wecomBody.textcard.url = `https://space.bilibili.com/${uid}/dynamic`;
            
            readyToSend = 1; 
          }

          // If user sign update
          if (nickname !== 'bilibili' && sign !== dbScope?.bilibili_live?.sign && dbScope?.bilibili_live) {
            log(`bilibili-live user sign updated: ${sign}`);

            wecomBody.textcard.title = `${msgPrefix}· B站签名更新`;
            wecomBody.textcard.description = `新：${sign}\n旧：${dbScope?.bilibili_live?.sign}`;
            wecomBody.textcard.url = `https://space.bilibili.com/${uid}/dynamic`;
            
            readyToSend = 1;
          }

          // If user avatar update
          if (nickname !== 'bilibili' && avatarHash?.pathname !== dbScope?.bilibili_live?.avatar && dbScope?.bilibili_live?.avatar) {
            log(`bilibili-live user avatar updated: ${avatar}`);

            wecomBody.textcard.title = `${msgPrefix}· B站头像更新`;
            wecomBody.textcard.description = `旧：${dbScope?.bilibili_live?.avatar}\n点击卡片查看`;
            wecomBody.textcard.url = `https://i1.hdslb.com/${dbScope?.bilibili_live?.avatar}`;

            readyToSend = 1; 
          }

          // 1: live
          // 0: not live
          if (room?.liveStatus === 1) {

            // Deprecated v1 API, may be changed in the future
            await got(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${liveId}`, {
              ...config.pluginOptions?.requestOptions,
              ...proxyOptions
            }).then(async resp => {
              const json = JSON.parse(resp.body);

              if (json?.code === 0) {
                const data = json.data;
                const timestamp = data.live_time * 1000;

                argv.json && fs.writeFile(`db/${account.slug}-bilibili-live.json`, JSON.stringify(json, null, 2), err => {
                  if (err) return console.log(err);
                });

                // Always returns -62170012800 when stream not start
                if (data.live_time > 0) {
                  dbStore.latestStream.timestamp = new Date(timestamp);
                  dbStore.latestStream.timestampUnix = timestamp;
                  dbStore.latestStream.timeAgo = timeAgo(timestamp);

                  log(`bilibili-live started: ${liveTitle} (${timeAgo(timestamp)})`);
                }

                if (dbScope?.bilibili_live?.latestStream?.isWecomSent) {
                  log(`bilibili-live notification sent, skipping...`);
                } else if ((currentTime - timestamp) >= config.bilibiliLiveBotThrottle) {
                  log(`bilibili-live too old, notifications skipped`);
                } else {
                  wecomBody.textcard.title = `${msgPrefix}· B站开播：${liveTitle}`;
                  wecomBody.textcard.description = `你关注的 ${msgPrefix}开播了，去看看叭：${liveRoom}`;
                  wecomBody.textcard.url = liveRoom;                  
                  // This function should be waited since we rely on the `isWecomSent` flag
                  dbStore.latestStream.isWecomSent = true;
                  readyToSend = 1;
                }
              } else {
                log('bilibili-live stream info corrupted, skipping...');
              };
            })
            .catch(err => {
              log(errColor(`bilibili-live stream info request error: ${err?.response?.body || err}`));
            });
          } else {
            log(`bilibili-live not started yet`);
            dbStore.latestStream.isWecomSent = false;
          }

          if (readyToSend === 1) {
            await sendWecom({}, wecomBody)
            .then(resp => {
              readyToSend = 0;
            })
            .catch(err => {
              log(`Wecom post error: ${err?.response?.body || err}`);
            });
          }
          // Set new data to database
          dbScope['bilibili_live'] = dbStore;
        } else {
          log('bilibili-live user info corrupted, skipping...');
        }
      })
      .catch(err => {
        log(errColor(`bilibili-live user info request error: ${err?.response?.body || err}`));
      });




      // Fetch bilibili microblog (dynamics)
      account.biliId && await got(`https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/space_history?host_uid=${account.biliId}&offset_dynamic_id=0&need_top=0&platform=web`, {
        ...config.pluginOptions?.requestOptions,
        ...proxyOptions
      }).then(async resp => {
        const json = JSON.parse(resp.body);

        if (json?.code === 0) {
          const currentTime = Date.now();
          const data = json.data;
          const cards = data?.cards;

          if (cards) {
            const card = cards[0];

            const cardMeta = card.desc;
            const cardJson = JSON.parse(card.card);
            const cardExtendedJson = card?.extension?.lbs && JSON.parse(card.extension.lbs) || null;
            const cardAddon = card?.display?.add_on_card_info?.[0] || null;
            let extendedMeta = '';

            const {
              uid,
              type,
              rid,
              orig_type: origType,
              dynamic_id_str: dynamicId,
              user_profile: user
            } = cardMeta;
            const timestamp = cardMeta.timestamp * 1000;

            argv.json && fs.writeFile(`db/${account.slug}-bilibili-mblog.json`, JSON.stringify(json, null, 2), err => {
              if (err) return console.log(err);
            });

            const dbStore = {
              scrapedTime: new Date(currentTime),
              user: user,
              latestDynamic: {
                id: dynamicId,
                type: type,
                timestamp: new Date(timestamp),
                timestampUnix: timestamp,
                timeAgo: timeAgo(timestamp),
              }
            };

            // If latest post is newer than the one in database
            if (dynamicId !== dbScope?.bilibili_mblog?.latestDynamic?.id && timestamp > dbScope?.bilibili_mblog?.latestDynamic?.timestampUnix) {
              // Check post type
              // https://www.mywiki.cn/dgck81lnn/index.php/%E5%93%94%E5%93%A9%E5%93%94%E5%93%A9API%E8%AF%A6%E8%A7%A3
              //
              // Forwarded post (think retweet)
              if (type === 1) {
                const originJson = JSON.parse(cardJson?.origin);

                // Column post
                if (originJson?.origin_image_urls) {
                  wecomBody.textcard.title = `${msgPrefix}· 转发B站专栏`;
                  wecomBody.textcard.description = `${cardJson?.item?.content.trim()}\n\n动态链接：https://t.bilibili.com/${dynamicId}\n\n@${originJson.author.name}：${originJson.title}\n\n${originJson.summary}`;
                  wecomBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;
                }

                // Text with gallery
                else if (originJson?.item?.description && originJson?.item?.pictures) {
                  wecomBody.textcard.title = `${msgPrefix}· 转发B站动态`;
                  wecomBody.textcard.description = `${cardJson?.item?.content.trim()}\n\n动态链接：https://t.bilibili.com/${dynamicId}\n\n@${originJson.user.name}：${originJson?.item?.description}${extendedMeta}`;
                  wecomBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;
                }

                // Video
                else if (originJson?.duration && originJson?.videos) {
                  wecomBody.textcard.title = `${msgPrefix}· 转发B站视频`;
                  wecomBody.textcard.description = `${cardJson?.item?.content.trim()}\n\n动态链接：https://t.bilibili.com/${dynamicId}\n\n@${originJson.owner.name}：${originJson.title}\n\n${originJson.desc}\n${originJson.short_link}`;
                  wecomBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;
                }

                // Plain text
                else {
                  wecomBody.textcard.title = `${msgPrefix}· 转发B站动态`;
                  wecomBody.textcard.description = `${cardJson?.item?.content.trim()}\n\n动态链接：https://t.bilibili.com/${dynamicId}\n\n@${originJson.user.uname}：${originJson.item.content}`;
                  wecomBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;
                }

                log(`bilibili-mblog got forwarded post (${timeAgo(timestamp)})`);
              }

              // Gallery post (text post with images)
              else if (type === 2 && cardJson?.item?.pictures.length > 0) {
                wecomBody.textcard.title = `${msgPrefix}· 更新B站相册`;
                wecomBody.textcard.description = `${cardJson?.item?.description}${extendedMeta}\n\n动态链接：https://t.bilibili.com/${dynamicId}`;
                wecomBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;

                log(`bilibili-mblog got gallery post (${timeAgo(timestamp)})`);
              }

              // Text post
              else if (type === 4) {
                wecomBody.textcard.title = `${msgPrefix}· 更新B站动态`;
                wecomBody.textcard.description = `${cardJson?.item?.content.trim()}${extendedMeta}`;
                wecomBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;
                log(`bilibili-mblog got text post (${timeAgo(timestamp)})`);
              }

              // Video post
              else if (type === 8) {
                // dynamic: microblog text
                // desc: video description                
                wecomBody.textcard.title = `${msgPrefix}· 发布B站视频：${cardJson.title}`;
                wecomBody.textcard.description = `${cardJson.title}\n${cardJson.dynamic}\n${cardJson.desc}\n\n视频链接：${cardJson.short_link}`;
                wecomBody.textcard.url = `${cardJson.short_link}`;

                log(`bilibili-mblog got video post (${timeAgo(timestamp)})`);
              }

              // VC video post (think ticktok)
              else if (type === 16) {
                log(`bilibili-mblog got vc video post (${timeAgo(timestamp)})`);
              }

              // Column post
              else if (type === 64) {
                wecomBody.textcard.title = `${msgPrefix}· 发布B站专栏：${cardJson.title}`;
                wecomBody.textcard.description = `${cardJson.title}\n\n${cardJson.summary}\n\n专栏链接：https://www.bilibili.com/read/cv${rid}`;
                wecomBody.textcard.url = `https://www.bilibili.com/read/cv${rid}`;

                log(`bilibili-mblog got column post (${timeAgo(timestamp)})`);
              }

              // Audio post
              else if (type === 256) {
                log(`bilibili-mblog got audio post (${timeAgo(timestamp)})`);
              }

              // General card link (calendar, etc.)
              // Share audio bookmark
              else if (type === 2048) {
                wecomBody.textcard.title = `${msgPrefix}· 更新B站动态`;
                wecomBody.textcard.description = `${cardJson?.vest?.content.trim()}${extendedMeta}`;
                wecomBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;

                log(`bilibili-mblog got share audio bookmark (${timeAgo(timestamp)})`);
              }

              // Share video bookmark
              else if (type === 4300) {
                log(`bilibili-mblog got share video bookmark (${timeAgo(timestamp)})`);
              }

              // Others
              else {
                log(`bilibili-mblog got unkown type (${timeAgo(timestamp)})`);
              }

              if ((currentTime - timestamp) >= config.bilibiliBotThrottle) {
                log(`bilibili-mblog too old, notifications skipped`);
              } else {
                await sendWecom({}, wecomBody)
                .then(resp => {
                  // log(`Wecom post bilibili-mblog success: message_id ${resp.result.message_id}`)
                })
                .catch(err => {
                  log(`Wecom post bilibili-mblog error: ${err?.response?.body || err}`);
                });      
              }
            } else if (dynamicId !== dbScope?.bilibili_mblog?.latestDynamic?.id && timestamp < dbScope?.bilibili_mblog?.latestDynamic?.timestampUnix) {
              log(`bilibili-mblog new post older than database. latest: ${dynamicId} (${timeAgo(timestamp)})`);
            } else {
              log(`bilibili-mblog no update. latest: ${dynamicId} (${timeAgo(timestamp)})`);
            }

            // Set new data to database
            dbScope['bilibili_mblog'] = dbStore;
          } else {
            log('bilibili-mblog empty result, skipping...');
          }
        } else {
          log('bilibili-mblog info corrupted, skipping...');
        }
      })
      .catch(err => {
        log(errColor(`bilibili-mblog request error: ${err?.response?.body || err}`));
      });




      // Fetch Douyin live
      account.douyinLiveId && await dyExtract(`https://live.douyin.com/${account.douyinLiveId}`, {
        ...config.pluginOptions,
        ...cookieOnDemand(config.pluginOptions.customCookies.douyin)
      }).then(async resp => {
        const json = resp?.initialState?.roomStore?.roomInfo;

        if (json) {
          const status = json?.room?.status;
          const id_str = json?.room?.id_str;

          if (status === 2) {
            argv.verbose && log(`douyin-live seems started, begin second check...`);

            await dyExtract(`https://webcast.amemv.com/webcast/reflow/${id_str}`, {...config.pluginOptions, ...cookieOnDemand(config.pluginOptions.customCookies.douyin)}).then(async resp => {
              const currentTime = Date.now();
              const json = resp?.['/webcast/reflow/:id'];

              if (json?.room) {
                argv.json && fs.writeFile(`db/${account.slug}-douyin-live.json`, JSON.stringify(json, null, 2), err => {
                  if (err) return console.log(err);
                });

                const {
                  id_str,
                  title,
                  cover,
                  create_time,
                  stream_url,
                } = json.room;

                const {
                  nickname,
                  web_rid,
                  sec_uid,
                  id,
                  short_id,
                  signature,
                  avatar_large,
                  authentication_info,
                } = json.room.owner;

                const liveCover = cover?.url_list?.[0];
                const timestamp = create_time * 1000;
                const streamUrl = Object.values(stream_url.hls_pull_url_map)[0];

                const dbStore = {
                  nickname: nickname,
                  uid: sec_uid,
                  scrapedTime: new Date(currentTime),
                  sign: signature,
                  latestStream: {
                    liveStatus: status,
                    liveStarted: timestamp,
                    liveRoom: id_str,
                    liveTitle: title,
                    liveCover: liveCover,
                    isWecomSent: dbScope?.douyin_live?.latestStream?.isWecomSent,
                  },
                  streamFormats: stream_url.candidate_resolution,
                  streamUrl: streamUrl,
                };

                if (json?.room?.status === 2) {
                  log(`douyin-live started: ${title} (${timeAgo(timestamp)})`);

                  wecomBody.textcard.title = `${msgPrefix}· 抖音开播：${title}`;
                  wecomBody.textcard.description = `你关注的 ${msgPrefix}开播了，去看看叭：https://live.douyin.com/${account.douyinLiveId}`;
                  wecomBody.textcard.url = `https://live.douyin.com/${account.douyinLiveId}`;

                  if (dbScope?.douyin_live?.latestStream?.isWecomSent) {
                    log(`douyin-live notification sent, skipping...`);
                  } else if ((currentTime - timestamp) >= config.douyinLiveBotThrottle) {
                    log(`douyin-live too old, notifications skipped`);
                  } else {                    
                    await sendWecom({}, wecomBody)
                    .then(resp => {
                      dbStore.latestStream.isWecomSent = true;
                    })
                    .catch(err => {
                      log(`Wecom post douyin-live error: ${err?.response?.body || err}`);
                    });  
                  }
                } else {
                  log(`douyin-live not started yet (2nd check)`);
                  dbStore.latestStream.isWecomSent = false;
                }

                // Set new data to database
                dbScope['douyin_live'] = dbStore;
              } else {
                log(`douyin-live stream info corrupted, skipping...`);
              }
            });
          } else {
            // TODO: Simplify make sure isTgSent set to false if not current live on first check
            // Need better solution
            const dbStore = {
              latestStream: {
                isWecomSent: false,
              },
            }
            log(`douyin-live not started yet`);
            dbScope['douyin_live'] = dbStore;
          }
        } else {
          log(`douyin-live info corrupted, skipping...`);
        }
      }).catch(err => {
        console.log(err);
      });

      // Fetch Douyin
      account.douyinId && await dyExtract(`https://www.douyin.com/user/${account.douyinId}`, {
        ...config.pluginOptions,
        ...cookieOnDemand(config.pluginOptions.customCookies.douyin)
      }).then(async resp => {
        const currentTime = Date.now();

        // Douyin trends to change object key regularly. (ie. C_10, C_12, C_14)
        // I need to find a static property to pin specific object
        let json = {};
        for (const obj in resp) {
          if (resp[obj].hasOwnProperty('uid')) {
            json = resp[obj];
          }
        }

        const userMeta = json?.user?.user;
        const posts = json?.post?.data;

        if (userMeta && posts?.length > 0) {
          const {
            uid,
            secUid,
            nickname,
            desc: sign,
            avatarUrl: avatar,
            followingCount: following,
            followerCount: followers,
          } = userMeta;

          argv.json && fs.writeFile(`db/${account.slug}-douyin.json`, JSON.stringify(json, null, 2), err => {
            if (err) return console.log(err);
          });

          // Sort all posts by `createTime` to avoid sticky (aka. 置顶) posts and get the latest one
          // const post = posts[i]; // Used to store in array and detect `isTop` in loop
          const post = posts.sort((a, b) => b.createTime - a.createTime)?.[0];

          // If latest post exists
          if (post) {
            const {
              awemeId: id,
              authorInfo: postAuthorMeta,
              desc: title,
              textExtra: tags,
              tag: postMeta,
              shareInfo: {
                shareUrl
              },
              stats,
            } = post;
            const timestamp = post.createTime * 1000;
            const cover = `https:${post?.video.dynamicCover}`;
            const videoUrl = `https:${post?.video?.playAddr[0].src}`;

            const dbStore = {
              nickname: nickname,
              uid: uid,
              scrapedTime: new Date(currentTime),
              sign: sign,
              following: following,
              followers: followers,
              latestPost: {
                id: id,
                title: title,
                timestamp: new Date(timestamp),
                timestampUnix: timestamp,
                timeAgo: timeAgo(timestamp),
                cover: cover,
                videoUrl: videoUrl,
                shareUrl: shareUrl,
              }
            };

            wecomBody.textcard.title = `${msgPrefix}· 发布抖音视频：${title}`;
            wecomBody.textcard.description = `${title}`;
            wecomBody.textcard.url = shareUrl;

            // Check if this is a new post compared to last scrap
            if (id !== dbScope?.douyin?.latestPost?.id && timestamp > dbScope?.douyin?.latestPost?.timestampUnix) {
              log(`douyin got update: ${id} (${timeAgo(timestamp)}) ${title}`);

              // Send bot message
              if ((currentTime - timestamp) >= config.douyinBotThrottle) {
                log(`douyin latest post too old, notifications skipped`);
              } else {
                await sendWecom({}, wecomBody)
                .catch(err => {
                  log(`Wecom post douyin-live error: ${err?.response?.body || err}`);
                });
              }
            } else {
              log(`douyin no update. latest: ${id} (${timeAgo(timestamp)})`);
            }

            // Set new data to database
            dbScope['douyin'] = dbStore;
          }
        } else {
          log(`douyin scraped data corrupted, skipping...`);
        }
      }).catch(err => {
        console.log(err);
      });



      //Fetch Weibo
      const weiboRequestOptions = {...config.pluginOptions?.requestOptions, ...headerOnDemand(config.pluginOptions.customCookies.weibo)};

      account.weiboId && await got(`https://m.weibo.cn/profile/info?uid=${account.weiboId}`, weiboRequestOptions).then(async resp => {
        const json = JSON.parse(resp.body);

        if (json?.ok === 1) {
          const currentTime = Date.now();
          const data = json.data;
          const user = data?.user;
          const statuses = data?.statuses;

          if (statuses.length !== 0) {
            // Exclude sticky status when: it is sticky and is older than the first [1] status
            const status = (
              statuses[0]?.isTop === 1 &&
              statuses[0]?.created_at &&
              statuses[1]?.created_at &&
              +new Date(statuses[0].created_at) < +new Date(statuses[1].created_at)
            ) ? statuses[1] : statuses[0];
            const retweeted_status = status?.retweeted_status;

            const timestamp = +new Date(status.created_at);
            const id = status.bid;
            const visibility = status?.visible?.type;
            const editCount = status?.edit_count || 0;
            let text = status?.raw_text || stripHtml(status.text);

            if (status?.isLongText) {
              log('weibo got post too long, trying extended text...')
              await got(`https://m.weibo.cn/statuses/extend?id=${id}`, weiboRequestOptions).then(async resp => {
                const json = JSON.parse(resp.body);

                if (json?.ok === 1 && json?.data?.longTextContent) {
                  text = stripHtml(json.data.longTextContent);
                } else {
                  log('weibo extended info corrupted, using original text...');
                }
              });
            }


            argv.json && fs.writeFile(`db/${account.slug}-weibo.json`, JSON.stringify(json, null, 2), err => {
              if (err) return console.log(err);
            });

            const visibilityMap = {
              1: `自己可见`,
              6: `好友圈可见`,
              10: `粉丝可见`
            }

            const dbStore = {
              scrapedTime: new Date(currentTime),
              scrapedTimeUnix: +new Date(currentTime),
              user: user,
              latestStatus: {
                id: id,
                text: text,
                visibility: visibility,
                editCount: editCount,
                timestamp: new Date(timestamp),
                timestampUnix: timestamp,
                timeAgo: timeAgo(timestamp),
              }
            };

            let readyToSend = 0;

            // If user nickname update
            if (user.screen_name !== dbScope?.weibo?.user?.screen_name && dbScope?.weibo?.user?.screen_name) {
              log(`weibo user nickname updated: ${user.screen_name}`);

              wecomBody.textcard.title = `${msgPrefix}· 微博昵称更新`;
              wecomBody.textcard.description = `新：${user.screen_name}\n旧：${dbScope?.weibo?.user?.screen_name}`;
              wecomBody.textcard.url = `https://weibo.com/${user.id}`;

              readyToSend = 1;
            }

            // If user description update
            if (user.description !== dbScope?.weibo?.user?.description && dbScope?.weibo?.user?.description) {
              log(`weibo user sign updated: ${user.description}`);

              wecomBody.textcard.title = `${msgPrefix}· 微博签名更新`;
              wecomBody.textcard.description = `新：${user.description}\n旧：${dbScope?.weibo?.user?.description}`;
              wecomBody.textcard.url = `https://weibo.com/${user.id}`;

              readyToSend = 1;
            }

            // If user avatar update
            if (user.avatar_hd !== dbScope?.weibo?.user?.avatar_hd && dbScope?.weibo?.user?.avatar_hd) {
              log(`weibo user avatar updated: ${user.avatar_hd}`);

              wecomBody.textcard.title = `${msgPrefix}· 微博头像更新`;
              wecomBody.textcard.description = `旧：${dbScope?.weibo?.user?.avatar_hd}\n点击卡片查看`;
              wecomBody.textcard.url = `${dbScope?.weibo?.user?.avatar_hd}`;

              readyToSend = 1;
            }

            // If user cover background update
            if (user.cover_image_phone !== dbScope?.weibo?.user?.cover_image_phone && dbScope?.weibo?.user?.cover_image_phone) {
              log(`weibo user cover updated: ${user.cover_image_phone}`);

              wecomBody.textcard.title = `${msgPrefix}· 微博封面更新`;
              wecomBody.textcard.description = `旧：${dbScope?.weibo?.user?.cover_image_phone}\n点击卡片查看`;
              wecomBody.textcard.url = `${dbScope?.weibo?.user?.cover_image_phone}`;

              readyToSend = 1;
            }

            // If latest post is newer than the one in database
            if (id !== dbScope?.weibo?.latestStatus?.id && timestamp > dbScope?.weibo?.latestStatus?.timestampUnix) {
              log(`weibo got update: ${id} (${timeAgo(timestamp)})`);

              wecomBody.textcard.title = `${msgPrefix}· 发布微博动态`;
              wecomBody.textcard.description = `${visibilityMap[visibility] || ''}${retweeted_status ? `转发` : `动态`}：${text}${retweeted_status ? `\n\n@${retweeted_status.user.screen_name}：${stripHtml(retweeted_status.text)}` : ''}`;
              wecomBody.textcard.url = `https://weibo.com/${user.id}/${id}`;

              if ((currentTime - timestamp) >= config.weiboBotThrottle) {
                log(`weibo too old, notifications skipped`);
              } else {
                readyToSend = 1;
              }
            } else if (id !== dbScope?.weibo?.latestStatus?.id && timestamp < dbScope?.weibo?.latestStatus?.timestampUnix) {
              log(`weibo new post older than database. latest: ${id} (${timeAgo(timestamp)})`);

            } else {
              log(`weibo no update. latest: ${id} (${timeAgo(timestamp)})`);
            }

            if (readyToSend === 1) {
              await sendWecom({}, wecomBody)
              .then(resp => {
                readyToSend = 0;
              })
              .catch(err => {
                log(`Wecom post error: ${err?.response?.body || err}`);
              });
            }

            // Set new data to database
            dbScope['weibo'] = dbStore;
          } else {
            log('weibo empty result, skipping...');
          }
        } else {
          log('weibo info corrupted, skipping...');
        }
      })
      .catch(err => {
        log(`weibo request error: ${err}`);
      });


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
