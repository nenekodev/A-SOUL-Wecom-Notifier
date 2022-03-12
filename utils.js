/*
Author: sparanoid(https://github.com/sparanoid)
Modified by nenekodev(https://github.com/nenekodev)

latest Update: 2022.3.11 0:11

The following changes has been made:
- Merge features in Utils.js and index.js
- Improve the log function
*/

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