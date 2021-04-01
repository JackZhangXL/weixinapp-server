const Router = require("@koa/router")
const koajwt = require('koa-jwt')
const jsonwebtoken = require('jsonwebtoken')
const util = require('util');
const WeixinAuth = require("../lib/koa2-weixin-auth")
const WXBizDataCrypt = require('../lib/WXBizDataCrypt')
const config = require("../config")
const User = require("../models/user-model")
const SessionKey = require("../models/session-key-model")
// const GoodsCarts = require("../models/goods-carts-model")
// const db = require("../models/mysql-db")
// const Address = require("../models/address-model")
// const Pay = require("./pay")

const router = new Router({ // 用前缀来自定义一个路由群组，后续的路由都是 /user/xxx 
  prefix: '/user'
})

router.use(async (ctx, next) => { // 自定义中间件：处理401：被koa-jwt挡住的请求，没有token或者token过期，会返回401
  try {
    await next()
  } catch (err) {
    console.log('401', err)
    if (err.status === 401) {
      ctx.status = 401
      ctx.body = '401，koa-jwt校验失败，未登录' // 访问 http://localhost:3000/user/home
    } else {
      throw err;
    }
  }
})

router.use(koajwt({ secret: config.jwtSecret }).unless({ // 自定义中间件，配置不需要验证token的页面
  path: [
    '/user/login', 
    '/user/weixin-login', // 将官方的koa2-weixin-auth源码fork下来，将api url地址改正确
    '/user/web-view'
  ]
}))

router.use(async (ctx, next) => { // 自定义中间件：验证token
  if (!ctx.url.includes('login') && !ctx.url.includes('web-view')) { // 例子页面中点击send按钮模拟验证二跳页
    try {
      let token = ctx.request.header.authorization
      token = token.split(' ')[1]
      let payload = await util.promisify(jsonwebtoken.verify)(token, config.jwtSecret) // 如果签名不对，这里会报错，走到catch分支
      let { openId, nickName, avatarUrl, uid } = payload
      ctx['user'] = { openId, nickName, avatarUrl, uid }
      await next()
    } catch (err) {
      console.log('err', err)
      throw err
    }
  } else {
    await next() // 路径不对的话，会返回404
  }
})

// // 测试用路径：/user/login
// // 访问 http://localhost:3000/user/login，返回400
// // 访问 http://localhost:3000/user/login?name=zxl&password=zxl，返回200
// router.get('/login', function (ctx) {
//   let { name, password } = ctx.request.query
//   if (name == 'zxl' && password == 'zxl') { // 正常情况下是将用户名和密码查数据库，这里为了模拟就写死
//     ctx.status = 200
//     ctx.body = {
//       code: 200,
//       msg: '登录成功',
//       token: "Bearer " + jsonwebtoken.sign( // 用户名密码验证通过就生成token
//         { name: name },
//         config.jwtSecret,
//         { expiresIn: '1d' }
//       )
//     }
//   } else {
//     ctx.status = 400
//     ctx.body = {
//       code: 400,
//       msg: '用户名密码错误'
//     }
//   }
// })

// 测试用路径：/user/home
// curl 'http://localhost:3000/user/login?name=zxl&password=zxl' 得到token：
// {"code":200,"msg":"Login Successful","token":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoienhsIiwiaWF0IjoxNjE2ODU4ODcwLCJleHAiOjE2MTY5NDUyNzB9.yBTYDznEMlRQJRK3yQcS56vAtUH6JhjaCdnx4DAmtiI"}
// curl -L -X GET -H "Authorization:Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoienhsIiwiaWF0IjoxNjE3MDA2NzI1LCJleHAiOjE2MTcwOTMxMjV9.d-1qgslfaRTRmrwABRCmYHA21qcMN46yPnUzBAbxDHc" "http://localhost:3000/user/home"
router.all('/home', async function (ctx) {
  let name = ctx.request.query.name || ''
  let user = ctx.user
  console.log("user", user);
  ctx.status = 200;
  ctx.body = {
    code: 200,
    msg: `ok, ${name}，${ctx.session.sessionKeyRecordId}`
  }
});

// 小程序加载的 web-view 页面
router.all('/web-view', async function (ctx) {
  const token = ctx.request.query.token
  ctx.session.sessionKeyRecordId = ~~ctx.session.sessionKeyRecordId + 1

  if (token) {
    ctx.cookies.set('Authorization', `Bearer ${token}`, { httpOnly: false }) // url 上的 token 写入 cookie
  }

  await ctx.render('index2', {
    title: 'web view from server',
    sessionKeyRecordId: ctx.session.sessionKeyRecordId,
    now: new Date()
  })
})

// 开始微信登录
const weixinAuth = new WeixinAuth(config.miniProgram.appId, config.miniProgram.appSecret)
router.post("/weixin-login", async (ctx) => {
  let { 
    code, // 小程序登录时传递的参数
    userInfo, // 小程序登录时传递的参数
    encryptedData, // 小程序登录时传递的参数
    iv, // 小程序登录时传递的参数
    sessionKeyIsValid // 添加一个参数，sessionKeyIsValid，代表sessionKey是否还有效
  } = ctx.request.body

  console.log("sessionKeyIsValid", sessionKeyIsValid)

  let sessionKey
  if (sessionKeyIsValid) { // 如果客户端有token，则传来，解析
    console.log('weixin-login, has token from client')
    let token = ctx.request.header.authorization
    token = token.split(' ')[1]
    if (token) {
      let payload = await util.promisify(jsonwebtoken.verify)(token, config.jwtSecret).catch(err => {
        console.log('err', err);
      })
      console.log('payload', payload)
      if (payload) {
        sessionKey = payload.sessionKey
      }
    }
  }
  
  // 除了尝试从token中获取sessionKey，还可以从数据库中或服务器redis缓存中获取
  // 如果在db或redis中存储，可以与cookie结合起来使用，
  // 目前没有这样做，sessionKey仍然存在丢失的时候，又缺少一个wx.clearSession方法
  console.log("ctx.session.sessionKeyRecordId", ctx.session.sessionKeyRecordId);
  if (sessionKeyIsValid && !sessionKey && ctx.session.sessionKeyRecordId) {
    let sessionKeyRecordId = ctx.session.sessionKeyRecordId
    console.log("sessionKeyRecordId", sessionKeyRecordId);
    // 如果还不有找到历史上有效的sessionKey，从db中取一下
    let sesskonKeyRecordOld = await SessionKey.findOne({
      where: {
        id: ctx.session.sessionKeyRecordId
      }
    })
    if (sesskonKeyRecordOld) sessionKey = sesskonKeyRecordOld.sessionKey
    console.log("从db中查找sessionKey3", sessionKey);
  }

  if (!sessionKey) {
    const token = await weixinAuth.getAccessToken(code) // 通过微信接口：https://api.weixin.qq.com/sns/jscode2session 去取token
    console.log('weixin-login token', token)
    // {
    //   data: { 
    //     session_key: 'G/hkdglAE8T3PKnpr6lpSg==',
    //     expires_in: 7200,
    //     openid: 'omObr0CLULqt_AFnwefrpSnk0KE8',
    //     create_at: 1617246457260 
    //   } 
    // }
    sessionKey = token.data.session_key
  }

  const pc = new WXBizDataCrypt(config.miniProgram.appId, sessionKey)
  let decryptedUserInfo = pc.decryptData(encryptedData, iv) // 用encryptedData，iv和token里的session_key去解密
  console.log('解密后 decryptedUserInfo: ', decryptedUserInfo) 
  // { openId, nickName, gender, language, city, province, country, avatarUrl, watermark }

  // 将用户保存到db里
  let user = await User.findOne({ where: { openId: decryptedUserInfo.openId } })
  if (!user) { //如果用户没有查到，则创建
    let createRes = await User.create(decryptedUserInfo)
    console.log("createRes", createRes);
    if (createRes) user = createRes.dataValues
  }
  let sessionKeyRecord = await SessionKey.findOne({ where: { uid: user.id } })
  if (sessionKeyRecord) {
    await sessionKeyRecord.update({
      sessionKey: sessionKey
    })
  } else {
    let sessionKeyRecordCreateRes = await SessionKey.create({
      uid: user.id,
      sessionKey: sessionKey
    })
    sessionKeyRecord = sessionKeyRecordCreateRes.dataValues
    console.log("created record", sessionKeyRecord);
  }
  // ctx.cookies.set("sessionKeyRecordId", sessionKeyRecord.id)
  ctx.session.sessionKeyRecordId = sessionKeyRecord.id
  console.log("sessionKeyRecordId", sessionKeyRecord.id);

  // 对用户施加 jwt 签名
  let authorizationToken = jsonwebtoken.sign({
    uid: user.id,
    nickName: decryptedUserInfo.nickName,
    avatarUrl: decryptedUserInfo.avatarUrl,
    openId: decryptedUserInfo.openId,
    sessionKey: sessionKey
  },
    config.jwtSecret,
    { expiresIn: '3d' }
  )
  Object.assign(decryptedUserInfo, { authorizationToken }) // 微信客户端wx.login的success回调里会得到这个 jwt 签名，后续在webview的url上带上

  ctx.status = 200
  ctx.body = {
    code: 200,
    msg: 'ok',
    data: decryptedUserInfo
  }
})

// // get /user/my/carts
// router.get("/my/carts", async (ctx) => {
//   let { uid: user_id } = ctx.user
//   let res = await db.query(`SELECT (select d.content from goods_info as d where d.goods_id = a.goods_id and d.kind = 0 limit 1) as goods_image,
//   a.id,a.goods_sku_id,a.goods_id,a.num,b.goods_sku_desc,b.goods_attr_path,b.price,b.stock,c.goods_name,c.goods_desc 
//   FROM goods_carts as a 
//   left outer join goods_sku as b on a.goods_sku_id = b.id 
//   left outer join goods as c on a.goods_id = c.id 
//   where a.user_id = :user_id;`, { replacements: { user_id }, type: db.QueryTypes.SELECT })

//   // 使用循环查询找到匹配的规格
//   if (res) {
//     for (let j = 0; j < res.length; j++) {
//       let item = res[j]
//       let goods_attr_path = item.goods_attr_path
//       let attr_values = await db.query("select id,attr_value from goods_attr_value where find_in_set(id,:attr_value_ids)", { replacements: { attr_value_ids: goods_attr_path.join(',') }, type: db.QueryTypes.SELECT })
//       item.attr_values = attr_values
//       item.sku_desc = goods_attr_path.map(attr_value_id => {
//         return attr_values.find(item => item.id == attr_value_id).attr_value
//       }).join(' ')
//     }
//   }

//   ctx.status = 200
//   ctx.body = {
//     code: 200,
//     msg: 'ok',
//     data: res
//   }
// })

// // put /user/my/carts/:id
// router.put("/my/carts/:id", async (ctx) => {
//   let id = Number(ctx.params.id)
//   let { num } = ctx.request.body

//   let hasExistRes = await GoodsCarts.findOne({
//     where: {
//       id
//     }
//   })
//   if (hasExistRes) {
//     let res = await GoodsCarts.update({
//       num
//     }, {
//       where: {
//         id
//       }
//     })
//     ctx.status = 200
//     ctx.body = {
//       code: 200,
//       msg: res[0] > 0 ? 'ok' : '',
//       data: res
//     }
//   } else {
//     ctx.status = 200
//     ctx.body = {
//       code: 200,
//       msg: '',
//       data: res
//     }
//   }
// })

// // delete /user/my/carts
// router.delete("/my/carts", async (ctx) => {
//   console.log('ctx.request.body ', ctx.request.body);
//   let { ids } = ctx.request.body
//   // desctroy返回的不是数据，而是成功删除的数目
//   let res = await GoodsCarts.destroy({
//     where: {
//       id: ids
//     }
//   })
//   ctx.status = 200
//   ctx.body = {
//     code: 200,
//     msg: res > 0 ? 'ok' : '',
//     data: res
//   }
// })

// // post /user/my/carts
// router.post("/my/carts", async (ctx) => {
//   let { uid: user_id } = ctx.user
//   console.log('ctx.request.body', ctx.request.body);
//   let { goods_id, goods_sku_id, goods_sku_desc } = ctx.request.body
//   let num = 1

//   let hasExistRes = await GoodsCarts.findOne({
//     where: {
//       user_id,
//       goods_id,
//       goods_sku_id,
//     }
//   })
//   if (hasExistRes) {
//     let res = await GoodsCarts.update({
//       num: hasExistRes.num + 1
//     }, {
//       where: {
//         user_id,
//         goods_id,
//         goods_sku_id,
//       }
//     })
//     ctx.status = 200
//     ctx.body = {
//       code: 200,
//       msg: res[0] > 0 ? 'ok' : '',
//       data: res
//     }
//   } else {
//     // 返回成功添加的对象
//     let res = await GoodsCarts.create({
//       user_id,
//       goods_id,
//       goods_sku_id,
//       goods_sku_desc,
//       num
//     })
//     ctx.status = 200
//     ctx.body = {
//       code: 200,
//       msg: res ? 'ok' : '',
//       data: res
//     }
//   }
// })

// // get /user/my/address
// router.get("/my/address", async (ctx) => {
//   let { uid: userId } = ctx.user
//   let addressList = await Address.findAll({
//     where: {
//       "user_id": userId,
//     }
//   })

//   ctx.status = 200
//   ctx.body = {
//     code: 200,
//     msg: 'ok',
//     data: addressList
//   }
// })

// // post /user/my/address
// router.post("/my/address", async (ctx) => {
//   let res = null
//   let { uid: userId } = ctx.user
//   let { userName, telNumber, region, detailInfo } = ctx.request.body
//   let hasExistRes = await Address.findOne({
//     where: {
//       "tel_number": telNumber
//     }
//   })

//   if (!hasExistRes) {
//     res = await Address.create({
//       userId,
//       userName,
//       telNumber,
//       region,
//       detailInfo
//     })
//   }

//   ctx.status = 200
//   ctx.body = {
//     code: 200,
//     msg: res ? 'ok' : '',
//     data: res
//   }
// })

// // put /user/my/address
// router.put("/my/address", async (ctx) => {
//   // let {uid:userId} = ctx.user
//   let { id, userName, telNumber, region, detailInfo } = ctx.request.body

//   let res = await Address.update({
//     userName,
//     telNumber,
//     region,
//     detailInfo
//   }, {
//     where: {
//       id
//     }
//   }
//   )

//   ctx.status = 200
//   ctx.body = {
//     code: 200,
//     msg: res[0] > 0 ? 'ok' : '',
//     data: res
//   }
// })

// // delete /user/my/address/:id
// router.delete('/my/address/:id', async ctx=>{
//   let {id} = ctx.params
//   let {uid:userId} = ctx.user
//   let res = await Address.destroy({
//     where:{
//       id,
//       userId //user_id=?
//     }
//   })
//   ctx.status = 200
//   ctx.body = {
//     code: 200,
//     msg: res > 0 ? 'ok' : '',
//     data: res
//   }
// })

// Pay.init(router)

module.exports = router