import chalk from 'chalk';

import { formatDistanceToNowStrict } from 'date-fns';

export function timeAgo(timestamp, suffix = true) {
  return formatDistanceToNowStrict(new Date(timestamp), {
    addSuffix: suffix,
  });
}

export function formatDate(timestamp) {
  let date = timestamp.toString().length === 10 ? new Date(+timestamp * 1000) : new Date(+timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export function stripHtml(string = '', withBr = true) {
  if (withBr) {
    return string.replace(/<br ?\/?>/gmi, '\n').replace(/(<([^>]+)>)/gmi, '');
  } else {
    return string.replace(/(<([^>]+)>)/gmi, '');
  }
}

export function convertWeiboUrl(url) {
  const originalUrl = new URL(url);
  const { origin, pathname } = originalUrl;
  const path = pathname.replace(/^\/.*\//i, '');
  return `${origin}/mw2000/${path}`;
}

export function log(account, msg, type = 'normal') {
  const logName = chalk.hex('#000').bgHex(account?.color ?? '#fff');
  let textColor = chalk.hex('#fff');
  if (type == 'error'){
    textColor = chalk.hex('#ff0000');
  }else if (type == 'success'){
    textColor = chalk.hex('#00ff00');
  }
  console.log(`${logName(account.slug)} ${textColor(msg)}`);
}