import got from 'got';
import merge from 'deepmerge';
import jsdom from 'jsdom';
import { log, timeAgo } from '../utils.js'
import sendWecom from './Wecom.js';

const { JSDOM } = jsdom;

async function dyExtract(url, options = {}) {
  const parsedUrl = new URL(url);

  const mobileUserAgent = options?.mobileUserAgent || 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1';
  const desktopUserAgent = options?.desktopUserAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36';
  const requestOptions = options?.requestOptions || {};
  const cookieOptions = options?.customCookies.douyin || '';

  try {
    // Douyin videos need desktop UA to work:
    // macOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
    //
    // Douyin Live streams need mobile UA to work:
    // Android: 'Mozilla/5.0 (Linux; Android 6.0.1; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Mobile Safari/537.36'
    // Telegram In-App Browser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
    const reqUserAgent =
      parsedUrl.hostname === 'live.douyin.com' ||
      parsedUrl.hostname === 'webcast.amemv.com' ?
      mobileUserAgent : desktopUserAgent;

    const resp = await got(url, {
      headers: {
        'user-agent': reqUserAgent,
        cookie: cookieOptions,
      },
      ...requestOptions
    });

    const dom = new JSDOM(resp.body);
    const renderedData = dom.window.document.querySelector('#RENDER_DATA');
    const renderedLiveData = dom.window.document.querySelectorAll('script');

    // If Douyin main site
    if (renderedData) {
      const decodeJson = decodeURIComponent(renderedData.textContent);
      return JSON.parse(decodeJson);
    }

    else if (renderedLiveData) {

      for (let i = 0; i < renderedLiveData.length; i++) {
        const script = renderedLiveData[i];
        const regex = /^(window\.__INIT_PROPS__ ?= ?)(?<content>{.*)/gm;
        const match = regex.exec(script?.textContent);

        if (match?.groups?.content) {
          return JSON.parse(match?.groups?.content);
        }
      }
    }

    else {
      console.log('No rendered data found!');
    }

  } catch (err) {
    console.log(err);
  }
}

// Fetch Douyin live
export async function fetchDouyinLive (account, config, dbScope, textBody){
  const msgPrefix = account.showSlug ? `${account.slug}` : ``;

  const userOptions = {
    corpID: config.wecom.corpID,
    secret: config.wecom.secret,
  };

  account.douyinLiveId && await dyExtract(`https://live.douyin.com/${account.douyinLiveId}`, {
    ...config.pluginOptions
  }).then(async resp => {
    const json = resp?.initialState?.roomStore?.roomInfo;

    if (json) {
      const status = json?.room?.status;
      const id_str = json?.room?.id_str;

      if (status === 2) {
        await dyExtract(`https://webcast.amemv.com/webcast/reflow/${id_str}`, {
          ...config.pluginOptions
        }).then(async resp => {
          const currentTime = Date.now();
          const json = resp?.['/webcast/reflow/:id'];

          if (json?.room) {
            
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
              log(account, `douyin-live started: ${title} (${timeAgo(timestamp)})`, 'success');

              textBody.textcard.title = `${msgPrefix} · 抖音开播：${title}`;
              textBody.textcard.description = `你关注的${msgPrefix}开播了，去看看叭：https://live.douyin.com/${account.douyinLiveId}`;
              textBody.textcard.url = `https://live.douyin.com/${account.douyinLiveId}`;

              if (dbScope?.douyin_live?.latestStream?.isWecomSent) {
                log(account, `douyin-live notification sent, skipping...`);
              } else if ((currentTime - timestamp) >= config.douyinLiveBotThrottle) {
                log(account, `douyin-live too old, notifications skipped`);
              } else {
                await sendWecom(userOptions, merge({agentid: config.wecom.agentid,}, textBody))
                .then(resp => {
                  dbStore.latestStream.isWecomSent = true;
                })
                .catch(err => {
                  log(account, `Wecom post douyin-live error: ${err?.response?.body || err}`, 'error');
                });  
              }
            } else {
              log(account, `douyin-live not started yet (2nd check)`);
              dbStore.latestStream.isWecomSent = false;
            }

            // Set new data to database
            dbScope['douyin_live'] = dbStore;
          } else {
            log(account, `douyin-live stream info corrupted, skipping...`, 'error');
          }
        });
      } else {
        // TODO: Simplify make sure isWecomSent set to false if not current live on first check
        // Need better solution
        const dbStore = {
          latestStream: {
            isWecomSent: false,
          },
        }
        log(account, `douyin-live not started yet`);
        dbScope['douyin_live'] = dbStore;
      }
    } else {
      log(account, `douyin-live info corrupted, skipping...`, 'error');
    }
  }).catch(err => {
    log(account, `douyin-live user info request error: ${err}`, 'error');
  });
}

// Fetch Douyin
export async function fetchDouyin (account, config, dbScope, textBody){
  const msgPrefix = account.showSlug ? `${account.slug}` : ``;

  const userOptions = {
    corpID: config.wecom.corpID,
    secret: config.wecom.secret,
  };

  account.douyinId && await dyExtract(`https://www.douyin.com/user/${account.douyinId}`, {
    ...config.pluginOptions
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

        textBody.textcard.title = `${msgPrefix} · 发布抖音视频：${title}`;
        textBody.textcard.description = `${title}`;
        textBody.textcard.url = shareUrl;

        // Check if this is a new post compared to last scrap
        if (id !== dbScope?.douyin?.latestPost?.id && timestamp > dbScope?.douyin?.latestPost?.timestampUnix) {
          log(account, `douyin got update: ${id} (${timeAgo(timestamp)}) ${title}`, 'success');

          // Send bot message
          if ((currentTime - timestamp) >= config.douyinBotThrottle) {
            log(account, `douyin latest post too old, notifications skipped`);
          } else {
            await sendWecom(userOptions, merge({agentid: config.wecom.agentid,}, textBody))
            .catch(err => {
              log(account, `Wecom post douyin-live error: ${err?.response?.body || err}`, 'error');
            });
          }
        } else {
          log(account, `douyin no update. latest: ${id} (${timeAgo(timestamp)})`);
        }

        // Set new data to database
        dbScope['douyin'] = dbStore;
      }
    } else {
      log(account, `douyin scraped data corrupted, skipping...`, 'error');
    }
  }).catch(err => {
    log(account, `douyin request error: ${err}`, 'error');
  });
}