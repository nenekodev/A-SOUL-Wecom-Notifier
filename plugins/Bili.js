/*
Author: sparanoid(https://github.com/sparanoid)
Modified by nenekodev(https://github.com/nenekodev)

latest Update: 2022.3.12 0:24

The following changes has been made:
- Merge features in Utils.js
- Remove the verbose and JSON dump arguments
- Remove image and video parse
- Separate the function for BiliBili fetching
- Add sendWecom function
- Improve the log function
*/

import got from 'got';
import merge from 'deepmerge';
import { HttpsProxyAgent } from 'hpagent';
import { log, timeAgo } from '../utils.js'
import sendWecom from './Wecom.js';

// Fetch bilibili bio and live
export async function fetchBiliBio (account, config, dbScope, textBody){
  const msgPrefix = account.showSlug ? `${account.slug}` : ``;

  const userOptions = {
    corpID: config.wecom.corpID,
    secret: config.wecom.secret,
  };

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
        log(account, `data valid but content is corrupt. nickname === 'bilibili'`);
        return;
      }

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
          isWecomSent: dbScope?.bilibili_bio?.latestStream?.isWecomSent,
        },
      };

      let readyToSend = 0;

      // If user nickname update
      if (nickname !== 'bilibili' && nickname !== dbScope?.bilibili_bio?.nickname && dbScope?.bilibili_bio?.nickname) {
        textBody.textcard.title = `${msgPrefix} · 更新B站昵称`;
        textBody.textcard.description = `新：${nickname}\n旧：${dbScope?.bilibili_bio?.nickname}`;
        textBody.textcard.url = `https://space.bilibili.com/${uid}/dynamic`;
        
        readyToSend = 1;

        log(account, `bilibili-live user nickname updated: ${nickname}`, 'success');
      }

      // If user sign update
      if (nickname !== 'bilibili' && sign !== dbScope?.bilibili_bio?.sign && dbScope?.bilibili_bio) {
        textBody.textcard.title = `${msgPrefix} · 更新B站签名`;
        textBody.textcard.description = `新：${sign}\n旧：${dbScope?.bilibili_bio?.sign}`;
        textBody.textcard.url = `https://space.bilibili.com/${uid}/dynamic`;
        
        readyToSend = 1;

        log(account, `bilibili-live user sign updated: ${sign}`, 'success');
      }

      // If user avatar update
      if (nickname !== 'bilibili' && avatarHash?.pathname !== dbScope?.bilibili_bio?.avatar && dbScope?.bilibili_bio?.avatar) {
        textBody.textcard.title = `${msgPrefix} · 更新B站头像`;
        textBody.textcard.description = `旧：${dbScope?.bilibili_bio?.avatar}\n点击卡片查看`;
        textBody.textcard.url = `https://i1.hdslb.com/${dbScope?.bilibili_bio?.avatar}`;

        readyToSend = 1; 

        log(account, `bilibili-live user avatar updated: ${avatar}`, 'success');
      }

      // 1: live
      // 0: not live
      if (account.biliLiveId && room?.liveStatus === 1 ) {

        // Deprecated v1 API, may be changed in the future
        await got(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${liveId}`, {
          ...config.pluginOptions?.requestOptions,
          ...proxyOptions
        }).then(async resp => {
          const json = JSON.parse(resp.body);

          if (json?.code === 0) {
            const data = json.data;
            const timestamp = data.live_time * 1000;

            // Always returns -62170012800 when stream not start
            if (data.live_time > 0) {
              dbStore.latestStream.timestamp = new Date(timestamp);
              dbStore.latestStream.timestampUnix = timestamp;
              dbStore.latestStream.timeAgo = timeAgo(timestamp);
            }

            if (dbScope?.bilibili_bio?.latestStream?.isWecomSent) {
              log(account, `bilibili-live notification sent, skipping...`);
            } else if ((currentTime - timestamp) >= config.bilibiliLiveBotThrottle) {
              log(account, `bilibili-live too old, skipping...`);
            } else {
              textBody.textcard.title = `${msgPrefix} · B站开播：${liveTitle}`;
              textBody.textcard.description = `你关注的${msgPrefix}开播了，去看看叭：${liveRoom}`;
              textBody.textcard.url = liveRoom;                  

              readyToSend = 1;

              log(account, `bilibili-live started: ${liveTitle} (${timeAgo(timestamp)})`, 'success');

              // This function should be waited since we rely on the `isWecomSent` flag
              dbStore.latestStream.isWecomSent = true;
            }
          } else {
            log(account, `bilibili-live stream info corrupted, skipping...`, 'error');
          };
        })
        .catch(err => {
          log(account, `bilibili-live stream info request error: ${err?.response?.body || err}`, 'error');
        });
      } else {
        log(account, `bilibili-live not started yet`);
        dbStore.latestStream.isWecomSent = false;
      }

      if (readyToSend === 1) {

        await sendWecom(userOptions, merge({agentid: config.wecom.agentid,}, textBody))
        .then(resp => {
          readyToSend = 0;
        })
        .catch(err => {
          log(account, `Wecom post error: ${err?.response?.body || err}`, 'error');
        });
      }
      // Set new data to database
      dbScope['bilibili_bio'] = dbStore;
    } else {
      log(account, `bilibili-live user info corrupted, skipping...`, 'error');
    }
  })
  .catch(err => {
    log(account, `bilibili-live user info request error: ${err?.response?.body || err}`, 'error');
  });
}

// Fetch bilibili microblog (dynamics)
export async function fetchBiliBlog (account, config, dbScope, textBody){
  const msgPrefix = account.showSlug ? `${account.slug}` : ``;

  const userOptions = {
    corpID: config.wecom.corpID,
    secret: config.wecom.secret,
  };

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
            let repostType = '动态';
            let originDetails = '';
            // Column post
            if (originJson?.origin_image_urls) {
              repostType = '专栏';
              originDetails = `@${originJson.author.name}：${originJson.title}\n\n${originJson.summary}`;
            }

            // Text with gallery
            else if (originJson?.item?.description && originJson?.item?.pictures) {
              originDetails = `@${originJson.user.name}：${originJson?.item?.description}\n\n${extendedMeta}`
            }

            // Video
            else if (originJson?.duration && originJson?.videos) {
              repostType = '视频';
              originDetails = `@${originJson.owner.name}：${originJson.title}\n\n${originJson.desc}\n\n${originJson.short_link}`;
            }

            // Plain text
            else {
              originDetails = `@${originJson.user.uname}：${originJson.item.content}`;
            }

            textBody.textcard.title = `${msgPrefix} · 转发B站${repostType}`;
            textBody.textcard.description = `${cardJson?.item?.content.trim()}\n\n动态链接：https://t.bilibili.com/${dynamicId}\n\n${originDetails}`            
            textBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;

            log(account, `bilibili-mblog got forwarded post (${timeAgo(timestamp)})`, 'success');
          }

          // Gallery post (text post with images)
          else if (type === 2 && cardJson?.item?.pictures.length > 0) {
            textBody.textcard.title = `${msgPrefix} · 更新B站相册`;
            textBody.textcard.description = `${cardJson?.item?.description}${extendedMeta}\n\n动态链接：https://t.bilibili.com/${dynamicId}`;
            textBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;

            log(account, `bilibili-mblog got gallery post (${timeAgo(timestamp)})`, 'success');
          }

          // Text post
          else if (type === 4) {
            textBody.textcard.title = `${msgPrefix} · 更新B站动态`;
            textBody.textcard.description = `${cardJson?.item?.content.trim()}${extendedMeta}`;
            textBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;

            log(account, `bilibili-mblog got text post (${timeAgo(timestamp)})`, 'success');
          }

          // Video post
          else if (type === 8) {
            // dynamic: microblog text
            // desc: video description                
            textBody.textcard.title = `${msgPrefix} · 发布B站视频：${cardJson.title}`;
            textBody.textcard.description = `${cardJson.title}\n${cardJson.dynamic}\n${cardJson.desc}\n\n视频链接：${cardJson.short_link}`;
            textBody.textcard.url = `${cardJson.short_link}`;

            log(account, `bilibili-mblog got video post (${timeAgo(timestamp)})`, 'success');
          }

          // VC video post (think ticktok), TODO
          else if (type === 16) {
            log(account, `bilibili-mblog got vc video post (${timeAgo(timestamp)})`);
          }

          // Column post
          else if (type === 64) {
            textBody.textcard.title = `${msgPrefix} · 发布B站专栏：${cardJson.title}`;
            textBody.textcard.description = `${cardJson.title}\n\n${cardJson.summary}\n\n专栏链接：https://www.bilibili.com/read/cv${rid}`;
            textBody.textcard.url = `https://www.bilibili.com/read/cv${rid}`;

            log(account, `bilibili-mblog got column post (${timeAgo(timestamp)})`, 'success');
          }

          // Audio post, TODO
          else if (type === 256) {
            log(account, `bilibili-mblog got audio post (${timeAgo(timestamp)})`);
          }

          // General card link (calendar, etc.)
          // Share audio bookmark
          else if (type === 2048) {
            textBody.textcard.title = `${msgPrefix} · 更新B站动态`;
            textBody.textcard.description = `${cardJson?.vest?.content.trim()}\n${extendedMeta}`;
            textBody.textcard.url = `https://t.bilibili.com/${dynamicId}`;

            log(account, `bilibili-mblog got share audio bookmark (${timeAgo(timestamp)})`, 'success');
          }

          // Share video bookmark, TODO
          else if (type === 4300) {
            log(account, `bilibili-mblog got share video bookmark (${timeAgo(timestamp)})`);
          }

          // Others, TODO
          else {
            log(account, `bilibili-mblog got unkown type (${timeAgo(timestamp)})`);
          }

          if ((currentTime - timestamp) >= config.bilibiliBotThrottle) {
            log(account, `bilibili-mblog too old, notifications skipped`);
          } else {
            await sendWecom(userOptions, merge({agentid: config.wecom.agentid,}, textBody))
            .then(resp => {
              // log(`Wecom post bilibili-mblog success: message_id ${resp.result.message_id}`)
            })
            .catch(err => {
              log(account, `Wecom post bilibili-mblog error: ${err?.response?.body || err}`, 'error');
            });      
          }
        } else {
          log(account, `bilibili-mblog no update. latest: ${dynamicId} (${timeAgo(timestamp)})`);
        }

        // Set new data to database
        return dbScope['bilibili_mblog'] = dbStore;

      } else {
        log(account, 'bilibili-mblog empty result, skipping...', 'error');
      }
    } else {
      log(account, 'bilibili-mblog info corrupted, skipping...', 'error');
    }
  })
  .catch(err => {
    log(account, `bilibili-mblog request error: ${err?.response?.body || err}`, 'error');
  });
}