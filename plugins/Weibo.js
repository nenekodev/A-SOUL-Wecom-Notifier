/*
Author: sparanoid(https://github.com/sparanoid)
Modified by nenekodev(https://github.com/nenekodev)

latest Update: 2022.4.6 19:50

The following changes has been made:
- Merge features in Utils.js
- Remove the verbose and JSON dump arguments
- Remove image and video parse
- Separate the function for Weibo fetching
- Add sendWecom function
- Improve the log function
*/

import got from 'got';
import merge from 'deepmerge';
import { log, timeAgo } from '../utils.js'
import sendWecom from './Wecom.js';

function stripHtml(string = '', withBr = true) {
  if (withBr) {
    return string.replace(/<br ?\/?>/gmi, '\n').replace(/(<([^>]+)>)/gmi, '');
  } else {
    return string.replace(/(<([^>]+)>)/gmi, '');
  }
}

function convertWeiboUrl(url) {
  const originalUrl = new URL(url);
  const { origin, pathname } = originalUrl;
  const path = pathname.replace(/^\/.*\//i, '');
  return `${origin}/mw2000/${path}`;
}

function headerOnDemand(cookie) {
  return {
    headers: {
      Cookie: cookie
    }
  }
}

// Fetch Weibo
export async function fetchWeibo (account, config, dbScope, textBody){
  const msgPrefix = account.showSlug ? `${account.slug}` : ``;

  const userOptions = {
    corpID: config.wecom.corpID,
    secret: config.wecom.secret,
  };

  const weiboRequestOptions = {
    ...config.pluginOptions?.requestOptions,
    ...headerOnDemand(config.pluginOptions.customCookies.weibo)
  };

  // Weibo container ID magic words:
  // 230283 + uid: home
  // 100505 + uid: profile
  // 107603 + uid: weibo
  // 231567 + uid: videos
  // 107803 + uid: photos
  account.weiboId && await got(`https://m.weibo.cn/api/container/getIndex?type=uid&value=${account.weiboId}&containerid=107603${account.weiboId}`, weiboRequestOptions).then(async resp => {
    const json = JSON.parse(resp.body);

    if (json?.ok === 1) {
      const currentTime = Date.now();
      const data = json.data;
      const cards = data?.cards;

      // Filter out unrelated cards to only keep statuses
      // card_type: 9 - normal Weibo statuses
      const statuses = cards.filter(card => { return card.card_type === 9 });

      if (statuses.length !== 0) {
        // At this point, we can get Weibo profile data from the statuses
        // This reduces one API request and can be helpful with rate limit
        // at better scale
        const user = statuses[0].mblog.user;

        const status = (
          // This is the last resort to get the latest status witht sticky status
          (statuses[0]?.mblog?.created_at && statuses[1]?.mblog?.created_at &&
          +new Date(statuses[0].mblog.created_at) < +new Date(statuses[1].mblog.created_at))
        ) ? statuses[1].mblog : statuses[0].mblog;
        const retweeted_status = status?.retweeted_status;

        const timestamp = +new Date(status.created_at);
        const id = status.bid;
        const visibility = status?.visible?.type;
        const editCount = status?.edit_count || 0;
        let text = status?.raw_text || stripHtml(status.text);

        if (status?.isLongText) {
          log(account, 'weibo got post too long, trying extended text...')
          await got(`https://m.weibo.cn/statuses/extend?id=${id}`, weiboRequestOptions).then(async resp => {
            const json = JSON.parse(resp.body);

            if (json?.ok === 1 && json?.data?.longTextContent) {
              text = stripHtml(json.data.longTextContent);
            } else {
              log(account, 'weibo extended info corrupted, using original text...');
            }
          });
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
          textBody.textcard.title = `${msgPrefix} · 更新微博昵称`;
          textBody.textcard.description = `新：${user.screen_name}\n旧：${dbScope?.weibo?.user?.screen_name}`;
          textBody.textcard.url = `https://weibo.com/${user.id}`;

          readyToSend = 1;

          log(account, `weibo user nickname updated: ${user.screen_name}`, 'success');
        }

        // If user description update
        if (user.description !== dbScope?.weibo?.user?.description && dbScope?.weibo?.user?.description) {
          textBody.textcard.title = `${msgPrefix} · 更新微博签名`;
          textBody.textcard.description = `新：${user.description}\n旧：${dbScope?.weibo?.user?.description}`;
          textBody.textcard.url = `https://weibo.com/${user.id}`;

          readyToSend = 1;

          log(account, `weibo user description updated: ${user.description}`, 'success');
        }

        // If user avatar update
        if (user.avatar_hd !== dbScope?.weibo?.user?.avatar_hd && dbScope?.weibo?.user?.avatar_hd) {
          textBody.textcard.title = `${msgPrefix} · 更新微博头像`;
          textBody.textcard.description = `旧：${dbScope?.weibo?.user?.avatar_hd}\n点击卡片查看`;
          textBody.textcard.url = `${dbScope?.weibo?.user?.avatar_hd}`;

          readyToSend = 1;

          log(account, `weibo user avatar updated: ${user.avatar_hd}`, 'success');
        }

        // If user cover background update
        if (user.cover_image_phone !== dbScope?.weibo?.user?.cover_image_phone && dbScope?.weibo?.user?.cover_image_phone) {
          textBody.textcard.title = `${msgPrefix} · 更新微博封面`;
          textBody.textcard.description = `旧：${dbScope?.weibo?.user?.cover_image_phone}\n点击卡片查看`;
          textBody.textcard.url = `${dbScope?.weibo?.user?.cover_image_phone}`;

          readyToSend = 1;

          log(account, `weibo user cover updated: ${user.cover_image_phone}`, 'success');
        }

        // If latest post is newer than the one in database
        if (id !== dbScope?.weibo?.latestStatus?.id && timestamp > dbScope?.weibo?.latestStatus?.timestampUnix) {
          textBody.textcard.title = `${msgPrefix} · 发布微博动态`;
          textBody.textcard.description = `${retweeted_status ? `转发` : `动态`}：${text}${retweeted_status ? `\n\n@${retweeted_status.user.screen_name}：${stripHtml(retweeted_status.text)}` : ''}`;
          textBody.textcard.url = `https://weibo.com/${user.id}/${id}`;

          log(account, `weibo got update: ${id} (${timeAgo(timestamp)})`, 'success');

          if ((currentTime - timestamp) >= config.weiboBotThrottle) {
            log(account, `weibo too old, notifications skipped`);
          } else {
            readyToSend = 1;
          }
        } else if (id !== dbScope?.weibo?.latestStatus?.id && timestamp < dbScope?.weibo?.latestStatus?.timestampUnix) {
          log(account, `weibo new post older than database. latest: ${id} (${timeAgo(timestamp)})`);
        } else {
          log(account, `weibo no update. latest: ${id} (${timeAgo(timestamp)})`);
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
        dbScope['weibo'] = dbStore;
      } else {
        log(account, 'weibo empty result, skipping...', 'error');
      }
    } else {
      log(account, 'weibo info corrupted, skipping...', 'error');
    }
  })
  .catch(err => {
    log(account, `weibo request error: ${err}`, 'error');
  });
}
