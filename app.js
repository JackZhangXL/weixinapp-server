const Koa = require('koa')
const middleware = require("./middleware")
const routers = require("./routers")
// const initDb = require("./models/init-db")

const app = new Koa();
middleware(app)
routers(app)
// initDb()
app.listen(3000)


