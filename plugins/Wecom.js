/*
Author: nenekodev(https://github.com/nenekodev)\

latest Update: 2022.3.10 21:57
*/

import got from 'got';
import fetch from 'node-fetch';
import merge from 'deepmerge';

let access_token = null;

function getToken(corpID, secret) {
  return new Promise((resolve, reject) => {
    got.post('https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=' + corpID + '&corpsecret=' + secret)
    .then(resp => {
      access_token = JSON.parse(resp.body).access_token;
      resolve(access_token);
    });
  })
}

export async function sendWecom(userOptions = {}, userBody = {}) {
  const options = merge({
    apiBase: `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=`,
  }, userOptions);

  access_token = await getToken(`${options.corpID}`, `${options.secret}`);

  const body = merge({
    "touser": "@all",
    "msgtype": "textcard",
    "enable_id_trans": 0,
    "enable_duplicate_check": 0,
    "duplicate_check_interval":600
  }, userBody);

  const payload = {
    json: body,
  }
  
  try {
    const resp = await got.post(`${options.apiBase}`+ access_token, payload);
    return resp;
  } catch (err) {
    console.log(err);
  }
}

export default sendWecom;
