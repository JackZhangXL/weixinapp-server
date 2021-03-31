const path = require('path')
const logger = require('koa-logger')
const koaBody = require('koa-body')
const serve = require('koa-static-server')
const session = require('koa-session')
const store = require('koa-session-local')
const render = require('koa-art-template')
const htmlMinifier = require('html-minifier')
const dateFormat = require("../lib/date-format")

module.exports = app => {
  app.use(logger())
  app.use(koaBody({ // query参数可以直接用 ctx.request.query 获取，但post请求的body无法直接用用 ctx.request.body 获取，需要koa-body中间件才可以
    multipart: true,
    strict: false,
  }))

  app.use(serve({
    rootDir: 'static',
    rootPath: '/static'
  }))

  render(app, {
    root: path.join(__dirname, '../views'),
    minimize: true,
    htmlMinifier: htmlMinifier,
    htmlMinifierOptions: {
      collapseWhitespace: true,
      minifyCSS: true,
      minifyJS: true,
      ignoreCustomFragments: []
    },
    escape: true,
    extname: '.html',
    debug: process.env.NODE_ENV !== 'production',
    imports:{
      dateFormat
    },
  })

  // app.use(async (ctx, next) => { // 自定义中间件：打印出执行时间
  //   await next()
  //   const rt = ctx.response.get('X-Response-Time')
  //   console.log(`执行时间：${ctx.method} ${ctx.url} - ${rt}`)
  // })

  // app.use(async (ctx, next) => { // 自定义中间件：统计执行时间
  //   const start = Date.now()
  //   await next()
  //   const ms = Date.now() - start
  //   ctx.set('X-Response-Time', `${ms}ms`)
  // })

  // 测试用
  // koa-session会自动将生成的sessionid写入cookie里，也可以将session存储在外部store里，需要配合koa-session-local一起使用
  app.keys = ['koakeys'] // 加密cookie时的密钥
  const CONFIG = {
    store: new store(), // 生成的 session 存在外部store里
    key: 'koa.sess', // cookie的key，koa-session会自动将session写入cookie里
    maxAge: 86400000,
    autoCommit: true,
    overwrite: true,
    httpOnly: false, // true时，客户端js将无法读取到cookie信息，调试时设成 false
    signed: true, // true时，需要对app.keys赋值，否则会报错。false 时，app.keys 不赋值没有关系
                  // true时，会在cookie里加上sha256的签名，生成一个类似koa:sess.sig，防止cookie被篡改
    rolling: false,
    renew: false,
    secure: false, // 本地没有开启https，调试时会遇到：Error: Cannot send secure cookie over unencrypted connection，所以调试时设成 false
    sameSite: null,
  }
  app.use(session(CONFIG, app))

  // // 测试用 访问 http://localhost:3000/ 观察cookie里保存的session
  // app.use(async function (ctx, next) { // 自定义读写cookie的中间件
  //   const n = ~~ctx.cookies.get('view') + 1
  //   ctx.cookies.set('view', n, {httpOnly:false}) // httpOnly:false后，客户端js才能取出cookie
  //   await next()
  // })
}

