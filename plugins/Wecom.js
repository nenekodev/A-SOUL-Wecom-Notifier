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

async function send(userOptions = {}, userBody = {}) {
  const options = merge({
    apiBase: `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=`,
    corpID: process.env.WECOM_CORPID,
    secret: process.env.WECOM_SECRET,
  }, userOptions);

  access_token = await getToken(`${options.corpID}`, `${options.secret}`);

  const body = merge({
    "agentid": process.env.WECOM_AGENTID,
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

export default send;
