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
import { fetchDouyinLive, fetchDouyin } from './plugins/Douyin.js';

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
      // 


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
